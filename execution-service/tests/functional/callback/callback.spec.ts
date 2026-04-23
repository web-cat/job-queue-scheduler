import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Job from '#models/job'
import JobResult from '#models/job_result'
import CallbackLog from '#models/callback_log'
import SystemSetting from '#models/system_setting'
import callbackService from '#services/callback_service'
import jobLifecycleService from '#services/job_lifecycle_service'
import {
  cleanDatabase,
  createTestImageConfig,
  createTestJob,
  TEST_TAG_PREFIX,
} from '#tests/helpers/test_utils'

/**
 * Functional callback tests covering the end-to-end webhook delivery path:
 *
 *   markCompleted(job with callback_url)  →  POST fires  →  result_delivered flipped
 *                                               ↘ on failure, callback_log rows accumulate
 *   retryPendingCallbacks()               →  respects SystemSetting 'callback_retry_max'
 *
 * Unit tests under tests/unit/callback_service.spec.ts already cover the
 * low-level behaviour of deliverResult(). These functional tests focus on
 * the integration path where lifecycle + retry loop invoke the service
 * via a real fetch mock.
 */

const CALLBACK_TAG = `${TEST_TAG_PREFIX}callback`

interface MockResponse {
  ok: boolean
  status: number
  body?: string
}

/**
 * Replace globalThis.fetch with a controllable fake. Returns the captured
 * call log and a restore() to put the original back.
 *
 * If `response` is null the mocked fetch throws (simulates a network error).
 */
function mockFetch(response: MockResponse | null) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const bodyText = init?.body ? String(init.body) : ''
    let parsedBody: unknown = bodyText
    try {
      parsedBody = JSON.parse(bodyText)
    } catch {
      /* leave raw */
    }
    calls.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: parsedBody,
    })

    if (response === null) {
      throw new Error('ECONNREFUSED')
    }

    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    } as Response
  }

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`)
}

test.group('Callback: triggered from markCompleted', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
    await SystemSetting.query().where('key', 'callback_retry_max').delete()
  })

  test('POSTs the result payload when job has a callback_url and succeeds', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: CALLBACK_TAG })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      callbackUrl: 'https://example.com/webhook/success',
    })

    const mock = mockFetch({ ok: true, status: 200, body: 'ok' })
    try {
      await jobLifecycleService.markCompleted(
        job.jobId,
        { correctness_score: 95, tool_score: 93, exit_code: 0, runtime_ms: 1500 },
        1.5
      )

      // markCompleted fires the callback without awaiting it.
      await waitFor(async () => {
        const refreshed = await Job.findOrFail(job.jobId)
        return refreshed.resultDelivered === true
      })
    } finally {
      mock.restore()
    }

    assert.lengthOf(mock.calls, 1)
    assert.equal(mock.calls[0].method, 'POST')
    assert.equal(mock.calls[0].url, 'https://example.com/webhook/success')

    const body = mock.calls[0].body as Record<string, unknown>
    assert.equal(body.job_id, job.jobId)
    assert.equal(body.submission_id, job.submissionId)
    assert.equal(body.status, 'completed')
    assert.equal(body.correctness_score, 95)
    assert.equal(body.tool_score, 93)
    assert.equal(body.exit_code, 0)
    assert.equal(body.runtime_ms, 1500)

    const log = await CallbackLog.findByOrFail('job_id', job.jobId)
    assert.isTrue(log.success)
    assert.equal(log.responseCode, 200)
    assert.equal(log.attemptNumber, 1)

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isTrue(finalJob.resultDelivered)
  })

  test('does not POST when callback_url is null', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${CALLBACK_TAG}-none` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      callbackUrl: null,
    })

    const mock = mockFetch({ ok: true, status: 200 })
    try {
      await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, 5)
      // Give any stray microtasks a chance to run, then assert zero calls.
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      mock.restore()
    }

    assert.lengthOf(mock.calls, 0)

    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 0)

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isFalse(finalJob.resultDelivered)
  })

  test('logs a failed attempt when the endpoint returns 500', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${CALLBACK_TAG}-5xx` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      callbackUrl: 'https://example.com/webhook/oops',
    })

    const mock = mockFetch({ ok: false, status: 500, body: 'internal server error' })
    try {
      await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, 3)
      await waitFor(async () => {
        const logs = await CallbackLog.query().where('job_id', job.jobId)
        return logs.length >= 1
      })
    } finally {
      mock.restore()
    }

    const log = await CallbackLog.findByOrFail('job_id', job.jobId)
    assert.isFalse(log.success)
    assert.equal(log.responseCode, 500)
    assert.equal(log.attemptNumber, 1)
    assert.include(log.responseBody ?? '', 'internal server error')

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isFalse(finalJob.resultDelivered)
  })

  test('logs a failed attempt with null response_code on network error', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${CALLBACK_TAG}-netfail` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      callbackUrl: 'https://example.com/webhook/unreachable',
    })

    const mock = mockFetch(null)
    try {
      await jobLifecycleService.markCompleted(job.jobId, { exit_code: 1 }, 2)
      await waitFor(async () => {
        const logs = await CallbackLog.query().where('job_id', job.jobId)
        return logs.length >= 1
      })
    } finally {
      mock.restore()
    }

    const log = await CallbackLog.findByOrFail('job_id', job.jobId)
    assert.isFalse(log.success)
    assert.isNull(log.responseCode)
    assert.include(log.responseBody ?? '', 'ECONNREFUSED')

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isFalse(finalJob.resultDelivered)
  })
})

test.group('Callback: retry loop respects max attempts', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
    await SystemSetting.query().where('key', 'callback_retry_max').delete()
  })

  test('retryPendingCallbacks stops retrying once callback_retry_max attempts are logged', async ({
    assert,
  }) => {
    await SystemSetting.create({
      key: 'callback_retry_max',
      value: '2',
      description: null,
    })

    const cfg = await createTestImageConfig({ dockerImageTag: `${CALLBACK_TAG}-retry-cap` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'completed',
      completedAt: DateTime.now(),
      callbackUrl: 'https://example.com/webhook/retry',
      resultDelivered: false,
    })

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 70,
      toolScore: 72,
      comments: 'retry subject',
      commentFormat: 0,
      testOutput: '',
      exitCode: 0,
      runtimeMs: 5000,
    })

    // Every call returns 503 so the webhook never succeeds. With max=2
    // we expect exactly 2 calls across unlimited retryPendingCallbacks
    // invocations.
    const mock = mockFetch({ ok: false, status: 503 })
    try {
      await callbackService.retryPendingCallbacks()
      await callbackService.retryPendingCallbacks()
      // Third call has nothing left to try — attempt cap reached.
      await callbackService.retryPendingCallbacks()
    } finally {
      mock.restore()
    }

    assert.lengthOf(mock.calls, 2)
    const logs = await CallbackLog.query().where('job_id', job.jobId).orderBy('attempt_number')
    assert.lengthOf(logs, 2)
    assert.equal(logs[0].attemptNumber, 1)
    assert.equal(logs[1].attemptNumber, 2)
    assert.isFalse(logs[0].success)
    assert.isFalse(logs[1].success)

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isFalse(finalJob.resultDelivered)
  })

  test('retryPendingCallbacks marks result_delivered and stops on a successful retry', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${CALLBACK_TAG}-retry-success` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'completed',
      completedAt: DateTime.now(),
      callbackUrl: 'https://example.com/webhook/eventually-ok',
      resultDelivered: false,
    })
    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 80,
      toolScore: 85,
      comments: 'eventually ok',
      commentFormat: 0,
      testOutput: '',
      exitCode: 0,
      runtimeMs: 7000,
    })

    // First retry fails (503), second succeeds (200).
    const first = mockFetch({ ok: false, status: 503 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      first.restore()
    }

    const second = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      second.restore()
    }

    // A third retry loop should be a no-op now that result_delivered=true.
    const third = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      third.restore()
    }

    assert.lengthOf(first.calls, 1)
    assert.lengthOf(second.calls, 1)
    assert.lengthOf(third.calls, 0)

    const logs = await CallbackLog.query().where('job_id', job.jobId).orderBy('attempt_number')
    assert.lengthOf(logs, 2)
    assert.isFalse(logs[0].success)
    assert.isTrue(logs[1].success)

    const finalJob = await Job.findOrFail(job.jobId)
    assert.isTrue(finalJob.resultDelivered)
  })
})
