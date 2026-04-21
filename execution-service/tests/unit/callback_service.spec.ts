import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import CallbackLog from '#models/callback_log'
import SystemSetting from '#models/system_setting'
import callbackService from '#services/callback_service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createImageConfig() {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:callback',
    displayName: null,
    timeoutSeconds: 30,
    memoryLimitMb: 512,
    cpuLimitMillicores: 1000,
    maxRetries: 0,
    defaultPriority: 5,
    defaultEstimatedRuntime: 15,
    isActive: true,
    totalCompletedJobs: 0,
    avgRuntimeSeconds: null,
  })
}

async function createJob(imageConfigId: number, overrides: Partial<InstanceType<typeof Job>> = {}) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: 'test/grader:callback',
    status: 'completed',
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 15,
    retryCount: 0,
    submittedAt: DateTime.now(),
    completedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

async function createJobResult(jobId: number) {
  return JobResult.create({
    jobId,
    correctnessScore: 85,
    toolScore: 90,
    comments: 'Looks good',
    commentFormat: 0,
    testOutput: '5/5 tests passed',
    exitCode: 0,
    runtimeMs: 12300,
  })
}

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  ok: boolean
  status: number
  body?: string
}

/**
 * Replaces globalThis.fetch with a controlled fake.
 * Returns a restore function and a `calls` array with every captured call.
 */
function mockFetch(response: MockResponse | null = null) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const bodyText = init?.body ? String(init.body) : ''
    let parsedBody: unknown = bodyText
    try {
      parsedBody = JSON.parse(bodyText)
    } catch {
      /* leave as string */
    }
    calls.push({ url: String(input), init: init ?? {}, body: parsedBody })

    if (response === null) {
      throw new Error('ECONNREFUSED')
    }

    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? '',
    } as Response
  }

  const restore = () => {
    globalThis.fetch = originalFetch
  }

  return { calls, restore }
}

// ---------------------------------------------------------------------------
// deliverResult tests
// ---------------------------------------------------------------------------

test.group('CallbackService — deliverResult', (group) => {
  group.each.setup(async () => {
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
    await db.from('system_settings').where('key', 'callback_retry_max').delete()
  })

  test('skips silently when job has no callback_url', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: null })
    await createJobResult(job.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 0)
  })

  test('skips when result_delivered is already true', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, {
      callbackUrl: 'https://example.com/webhook',
      resultDelivered: true,
    })
    await createJobResult(job.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
  })

  test('skips when job_result does not exist yet', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    // No job result

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
  })

  test('POSTs correct payload to callback_url', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    const result = await createJobResult(job.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    assert.lengthOf(calls, 1)
    assert.equal(calls[0].url, 'https://example.com/webhook')

    const body = calls[0].body as Record<string, unknown>
    assert.equal(body.job_id, job.jobId)
    assert.equal(body.submission_id, job.submissionId)
    assert.equal(body.status, 'completed')
    assert.equal(body.correctness_score, result.correctnessScore)
    assert.equal(body.tool_score, result.toolScore)
    assert.equal(body.exit_code, result.exitCode)
    assert.equal(body.runtime_ms, result.runtimeMs)
  })

  test('sets result_delivered = true on 2xx response', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore } = mockFetch({ ok: true, status: 201 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    const updated = await Job.findOrFail(job.jobId)
    assert.isTrue(updated.resultDelivered)
  })

  test('logs attempt with success=true on 2xx response', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore } = mockFetch({ ok: true, status: 200, body: 'ok' })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].responseCode, 200)
    assert.isTrue(logs[0].success)
    assert.equal(logs[0].attemptNumber, 1)
    assert.equal(logs[0].url, 'https://example.com/webhook')
  })

  test('does not set result_delivered on non-2xx response', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore } = mockFetch({ ok: false, status: 500, body: 'Internal Server Error' })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    const updated = await Job.findOrFail(job.jobId)
    assert.isFalse(updated.resultDelivered)

    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].responseCode, 500)
    assert.isFalse(logs[0].success)
  })

  test('logs attempt with null response_code and success=false on network error', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore } = mockFetch(null) // null triggers ECONNREFUSED
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      restore()
    }

    const updated = await Job.findOrFail(job.jobId)
    assert.isFalse(updated.resultDelivered)

    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 1)
    assert.isNull(logs[0].responseCode)
    assert.isFalse(logs[0].success)
    assert.include(logs[0].responseBody!, 'ECONNREFUSED')
  })

  test('increments attempt_number on each call', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore: r1 } = mockFetch({ ok: false, status: 503 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      r1()
    }

    const { restore: r2 } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      r2()
    }

    const logs = await CallbackLog.query().where('job_id', job.jobId).orderBy('attempt_number')
    assert.lengthOf(logs, 2)
    assert.equal(logs[0].attemptNumber, 1)
    assert.isFalse(logs[0].success)
    assert.equal(logs[1].attemptNumber, 2)
    assert.isTrue(logs[1].success)
  })

  test('does not call fetch again after result_delivered is set', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    const { restore: r1 } = mockFetch({ ok: true, status: 200 })
    await callbackService.deliverResult(job.jobId)
    r1()

    const { calls, restore: r2 } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.deliverResult(job.jobId)
    } finally {
      r2()
    }

    assert.lengthOf(calls, 0)
    const logs = await CallbackLog.query().where('job_id', job.jobId)
    assert.lengthOf(logs, 1)
  })
})

// ---------------------------------------------------------------------------
// retryPendingCallbacks tests
// ---------------------------------------------------------------------------

test.group('CallbackService — retryPendingCallbacks', (group) => {
  group.each.setup(async () => {
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
    await db.from('system_settings').where('key', 'callback_retry_max').delete()
  })

  test('delivers for all completed jobs with pending callbacks', async ({ assert }) => {
    const cfg = await createImageConfig()
    const jobA = await createJob(cfg.id, { callbackUrl: 'https://example.com/a' })
    await createJobResult(jobA.jobId)
    const jobB = await createJob(cfg.id, { callbackUrl: 'https://example.com/b' })
    await createJobResult(jobB.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 2)
    const updatedA = await Job.findOrFail(jobA.jobId)
    const updatedB = await Job.findOrFail(jobB.jobId)
    assert.isTrue(updatedA.resultDelivered)
    assert.isTrue(updatedB.resultDelivered)
  })

  test('skips jobs already delivered', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, {
      callbackUrl: 'https://example.com/webhook',
      resultDelivered: true,
    })
    await createJobResult(job.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
  })

  test('skips jobs without callback_url', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: null })
    await createJobResult(job.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
  })

  test('stops retrying after callback_retry_max attempts', async ({ assert }) => {
    await SystemSetting.create({ key: 'callback_retry_max', value: '2' })

    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    // Simulate 2 prior failed attempts
    for (let i = 1; i <= 2; i++) {
      await CallbackLog.create({
        jobId: job.jobId,
        url: 'https://example.com/webhook',
        attemptNumber: i,
        responseCode: 500,
        responseBody: 'err',
        success: false,
        attemptedAt: DateTime.now(),
      })
    }

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
    const updated = await Job.findOrFail(job.jobId)
    assert.isFalse(updated.resultDelivered)
  })

  test('retries a job with fewer than callback_retry_max failures', async ({ assert }) => {
    await SystemSetting.create({ key: 'callback_retry_max', value: '3' })

    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { callbackUrl: 'https://example.com/webhook' })
    await createJobResult(job.jobId)

    await CallbackLog.create({
      jobId: job.jobId,
      url: 'https://example.com/webhook',
      attemptNumber: 1,
      responseCode: 503,
      responseBody: 'unavailable',
      success: false,
      attemptedAt: DateTime.now(),
    })

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 1)
    const updated = await Job.findOrFail(job.jobId)
    assert.isTrue(updated.resultDelivered)
  })

  test('handles empty queue without errors', async ({ assert }) => {
    await assert.doesNotRejects(() => callbackService.retryPendingCallbacks())
  })

  test('skips jobs with status other than completed', async ({ assert }) => {
    const cfg = await createImageConfig()
    const pendingJob = await createJob(cfg.id, {
      status: 'pending',
      callbackUrl: 'https://example.com/webhook',
    })
    await createJobResult(pendingJob.jobId)

    const { calls, restore } = mockFetch({ ok: true, status: 200 })
    try {
      await callbackService.retryPendingCallbacks()
    } finally {
      restore()
    }

    assert.lengthOf(calls, 0)
  })
})
