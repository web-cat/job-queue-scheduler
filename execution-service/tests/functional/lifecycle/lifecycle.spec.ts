import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import jobLifecycleService from '#services/job_lifecycle_service'
import { SchedulerService } from '#services/scheduler_service'
import {
  cleanDatabase,
  createTestImageConfig,
  createTestJob,
  TEST_TAG_PREFIX,
} from '#tests/helpers/test_utils'

/**
 * Functional lifecycle tests covering the full state machine:
 *
 *   HTTP submit → HRRN dequeue → markCompleted → job_results + rolling avg
 *                                ↘ markFailed  → pending (under retries) or failed (at max)
 *
 * Unit coverage for markCompleted / markFailed already exists under
 * tests/unit/job_lifecycle_service.spec.ts. This suite exercises the
 * transitions in sequence against the real scheduler + real HTTP API so
 * that regressions in the wiring (not just the individual service methods)
 * are caught.
 */

const LIFECYCLE_TAG = `${TEST_TAG_PREFIX}lifecycle`

test.group('Lifecycle: full submit → dequeue → complete flow', (group) => {
  let tmpBase: string
  let previousSubmissionsPath: string | undefined

  group.setup(async () => {
    tmpBase = path.join(
      tmpdir(),
      `lifecycle-func-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(tmpBase, { recursive: true })
    previousSubmissionsPath = process.env.SUBMISSIONS_PATH
    process.env.SUBMISSIONS_PATH = tmpBase
  })

  group.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    if (previousSubmissionsPath === undefined) delete process.env.SUBMISSIONS_PATH
    else process.env.SUBMISSIONS_PATH = previousSubmissionsPath
  })

  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('submit → scheduler dequeues → markCompleted → results + rolling avg update', async ({
    client,
    assert,
  }) => {
    // Seed an image config that the HTTP submit endpoint can resolve.
    await createTestImageConfig({
      dockerImageTag: LIFECYCLE_TAG,
      defaultEstimatedRuntime: 20,
      maxRetries: 0,
    })

    // 1. Submit via HTTP with a real file upload.
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')
    const submitRes = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', LIFECYCLE_TAG)
      .field('submission_id', 970001)
      .file('files', fixturePath)

    submitRes.assertStatus(201)
    const submitBody = submitRes.body() as any
    const jobId = Number(submitBody.data.job_id)
    assert.equal(submitBody.data.status, 'pending')
    assert.equal(submitBody.data.queue_position, 1)

    // 2. Scheduler picks it up and atomically marks processing.
    const scheduler = new SchedulerService()
    const claimed = await scheduler.dequeueNext('lifecycle-worker')
    assert.isNotNull(claimed)
    assert.equal(claimed!.jobId, jobId)
    assert.equal(claimed!.status, 'processing')
    assert.isNotNull(claimed!.startedAt)
    assert.equal(claimed!.workerPodName, 'lifecycle-worker')

    // 3. markCompleted writes the job_result row and transitions job state.
    const updated = await jobLifecycleService.markCompleted(
      jobId,
      {
        correctness_score: 92,
        tool_score: 88,
        comments: 'Good job',
        comment_format: 0,
        test_output: '10/10 passed',
        exit_code: 0,
        runtime_ms: 18500,
      },
      18.5
    )
    assert.isNotNull(updated)

    // 4. Job + JobResult reflect the transition.
    const finalJob = await Job.findOrFail(jobId)
    assert.equal(finalJob.status, 'completed')
    assert.isNotNull(finalJob.completedAt)
    assert.approximately(finalJob.actualRuntime!, 18.5, 0.01)

    const result = await JobResult.findByOrFail('job_id', jobId)
    assert.equal(result.correctnessScore, 92)
    assert.equal(result.toolScore, 88)
    assert.equal(result.exitCode, 0)
    assert.equal(result.runtimeMs, 18500)

    // 5. image_configs rolling average now reflects this first completion.
    const cfgAfter = await ImageConfig.findByOrFail('docker_image_tag', LIFECYCLE_TAG)
    assert.equal(cfgAfter.totalCompletedJobs, 1)
    assert.approximately(cfgAfter.avgRuntimeSeconds!, 18.5, 0.01)
  })
})

test.group('Lifecycle: rolling average over multiple completions', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('avg_runtime_seconds is a true running mean over 3 completions', async ({ assert }) => {
    const cfg = await createTestImageConfig({
      dockerImageTag: `${LIFECYCLE_TAG}-rolling`,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const runtimes = [10, 20, 30]
    for (const runtime of runtimes) {
      const job = await createTestJob({
        imageConfigId: cfg.id,
        dockerImageTag: cfg.dockerImageTag,
        status: 'processing',
        workerPodName: 'rolling-worker',
      })
      await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, runtime)
    }

    const updated = await ImageConfig.findOrFail(cfg.id)
    assert.equal(updated.totalCompletedJobs, 3)
    // (10 + 20 + 30) / 3 = 20
    assert.approximately(updated.avgRuntimeSeconds!, 20, 0.01)
  })
})

test.group('Lifecycle: markFailed retry semantics', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('first failure under maxRetries requeues the job and clears worker fields', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({
      dockerImageTag: `${LIFECYCLE_TAG}-retry`,
      maxRetries: 2,
    })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      startedAt: DateTime.now().minus({ seconds: 30 }),
      workerPodName: 'retry-worker',
    })

    await jobLifecycleService.markFailed(job.jobId, 'pod OOMKilled')

    const refreshed = await Job.findOrFail(job.jobId)
    assert.equal(refreshed.status, 'pending')
    assert.equal(refreshed.retryCount, 1)
    assert.isNull(refreshed.workerPodName)
    assert.isNull(refreshed.startedAt)
    // Transient errorMessage is not persisted on retry (only on final failure).
  })

  test('re-queued job can be dequeued again by the scheduler', async ({ assert }) => {
    const cfg = await createTestImageConfig({
      dockerImageTag: `${LIFECYCLE_TAG}-retry-dequeue`,
      maxRetries: 2,
    })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      startedAt: DateTime.now().minus({ seconds: 45 }),
      workerPodName: 'first-worker',
      // Tiny submittedAt offset so HRRN score is stable.
      submittedAt: DateTime.now().minus({ seconds: 60 }),
      estimatedRuntime: 10,
    })

    await jobLifecycleService.markFailed(job.jobId, 'pod crashed')

    const scheduler = new SchedulerService()
    const reclaimed = await scheduler.dequeueNext('second-worker')

    assert.isNotNull(reclaimed)
    assert.equal(reclaimed!.jobId, job.jobId)
    assert.equal(reclaimed!.status, 'processing')
    assert.equal(reclaimed!.workerPodName, 'second-worker')
    assert.equal(reclaimed!.retryCount, 1)
  })

  test('failure at max retries marks job permanently failed and records error', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({
      dockerImageTag: `${LIFECYCLE_TAG}-exhausted`,
      maxRetries: 2,
    })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      retryCount: 2,
      workerPodName: 'terminal-worker',
    })

    await jobLifecycleService.markFailed(job.jobId, 'final crash')

    const refreshed = await Job.findOrFail(job.jobId)
    assert.equal(refreshed.status, 'failed')
    assert.equal(refreshed.retryCount, 2)
    assert.equal(refreshed.errorMessage, 'final crash')
    assert.isNotNull(refreshed.completedAt)
  })

  test('markFailed is a no-op on an already-completed job', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${LIFECYCLE_TAG}-no-double` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'completed',
      completedAt: DateTime.now(),
    })

    const result = await jobLifecycleService.markFailed(job.jobId, 'late failure')
    assert.isNull(result)

    const unchanged = await Job.findOrFail(job.jobId)
    assert.equal(unchanged.status, 'completed')
    assert.isNull(unchanged.errorMessage)
  })
})

test.group('Lifecycle: getJob shape depends on status', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('pending job exposes queue_position and estimated_wait_seconds, not result', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${LIFECYCLE_TAG}-shape-pending` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'pending',
    })

    const view = (await jobLifecycleService.getJob(job.jobId)) as any
    assert.equal(view.status, 'pending')
    assert.equal(view.queue_position, 1)
    assert.isNumber(view.estimated_wait_seconds)
    assert.isNull(view.result)
  })

  test('completed job exposes result and null queue fields', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${LIFECYCLE_TAG}-shape-completed` })
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'processing',
      workerPodName: 'shape-worker',
    })

    await jobLifecycleService.markCompleted(
      job.jobId,
      { correctness_score: 77, tool_score: 80, exit_code: 0, runtime_ms: 9000 },
      9
    )

    const view = (await jobLifecycleService.getJob(job.jobId)) as any
    assert.equal(view.status, 'completed')
    assert.isNull(view.queue_position)
    assert.isNull(view.estimated_wait_seconds)
    assert.isNotNull(view.result)
    assert.equal(view.result.correctness_score, 77)
    assert.equal(view.result.tool_score, 80)
    assert.equal(view.result.runtime_ms, 9000)
  })
})
