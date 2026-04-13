import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import jobLifecycleService from '#services/job_lifecycle_service'

async function createImageConfig(overrides: Partial<InstanceType<typeof ImageConfig>> = {}) {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:lifecycle',
    displayName: null,
    timeoutSeconds: 30,
    memoryLimitMb: 512,
    cpuLimitMillicores: 1000,
    maxRetries: 2,
    defaultPriority: 5,
    defaultEstimatedRuntime: 15,
    isActive: true,
    totalCompletedJobs: 0,
    avgRuntimeSeconds: null,
    ...overrides,
  })
}

async function createJob(
  imageConfigId: number,
  overrides: Partial<InstanceType<typeof Job>> = {}
) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: 'test/grader:lifecycle',
    status: 'pending',
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 15,
    retryCount: 0,
    submittedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

test.group('JobLifecycleService — markProcessing', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('marks job as processing and sets worker pod and started_at', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id)

    const result = await jobLifecycleService.markProcessing(job.jobId, 'pod-abc123')

    assert.isNotNull(result)
    assert.equal(result!.status, 'processing')
    assert.equal(result!.workerPodName, 'pod-abc123')
    assert.isNotNull(result!.startedAt)
  })

  test('returns null for non-existent job', async ({ assert }) => {
    const result = await jobLifecycleService.markProcessing(999999, 'pod-x')
    assert.isNull(result)
  })
})

test.group('JobLifecycleService — markCompleted', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('updates job to completed and inserts job_result atomically', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'processing', workerPodName: 'pod-1' })

    await jobLifecycleService.markCompleted(job.jobId, {
      correctness_score: 90,
      tool_score: 85,
      comments: 'Great work',
      exit_code: 0,
      runtime_ms: 12000,
      pod_name: 'pod-1',
    }, 12.0)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'completed')
    assert.equal(updated.actualRuntime, 12.0)
    assert.isNotNull(updated.completedAt)

    const result = await JobResult.findByOrFail('job_id', job.jobId)
    assert.equal(result.correctnessScore, 90)
    assert.equal(result.toolScore, 85)
    assert.equal(result.exitCode, 0)
  })

  test('updates image_config rolling average on first completion', async ({ assert }) => {
    const cfg = await createImageConfig({ totalCompletedJobs: 0, avgRuntimeSeconds: null })
    const job = await createJob(cfg.id, { status: 'processing' })

    await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, 20.0)

    const updatedCfg = await ImageConfig.findOrFail(cfg.id)
    assert.equal(updatedCfg.totalCompletedJobs, 1)
    assert.approximately(updatedCfg.avgRuntimeSeconds!, 20.0, 0.01)
  })

  test('updates image_config rolling average on subsequent completions', async ({ assert }) => {
    const cfg = await createImageConfig({ totalCompletedJobs: 4, avgRuntimeSeconds: 10.0 })
    const job = await createJob(cfg.id, { status: 'processing' })

    // new_avg = ((10 * 4) + 20) / 5 = 60/5 = 12
    await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, 20.0)

    const updatedCfg = await ImageConfig.findOrFail(cfg.id)
    assert.equal(updatedCfg.totalCompletedJobs, 5)
    assert.approximately(updatedCfg.avgRuntimeSeconds!, 12.0, 0.01)
  })

  test('skips if job is not in processing status', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'pending' })

    const result = await jobLifecycleService.markCompleted(job.jobId, { exit_code: 0 }, 10.0)

    assert.isNull(result)
    const unchanged = await Job.findOrFail(job.jobId)
    assert.equal(unchanged.status, 'pending')
  })
})

test.group('JobLifecycleService — markFailed', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('re-queues job as pending when under max_retries', async ({ assert }) => {
    const cfg = await createImageConfig({ maxRetries: 2 })
    const job = await createJob(cfg.id, {
      status: 'processing',
      workerPodName: 'pod-1',
      retryCount: 0,
    })

    await jobLifecycleService.markFailed(job.jobId, 'OOMKilled')

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'pending')
    assert.equal(updated.retryCount, 1)
    assert.isNull(updated.workerPodName)
    assert.isNull(updated.startedAt)
  })

  test('permanently fails job when at max_retries', async ({ assert }) => {
    const cfg = await createImageConfig({ maxRetries: 2 })
    const job = await createJob(cfg.id, {
      status: 'processing',
      retryCount: 2,
    })

    await jobLifecycleService.markFailed(job.jobId, 'Container crashed')

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.equal(updated.errorMessage, 'Container crashed')
    assert.isNotNull(updated.completedAt)
  })

  test('skips if job is already completed', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'completed' })

    const result = await jobLifecycleService.markFailed(job.jobId, 'Late failure')

    assert.isNull(result)
    const unchanged = await Job.findOrFail(job.jobId)
    assert.equal(unchanged.status, 'completed')
  })
})

test.group('JobLifecycleService — cancelJob (file cleanup)', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('cancels a pending job', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id)

    const result = await jobLifecycleService.cancelJob(job.jobId)

    assert.isTrue(result.found)
    assert.isFalse(result.conflict)
    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'cancelled')
  })

  test('returns conflict for non-pending job', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'processing' })

    const result = await jobLifecycleService.cancelJob(job.jobId)

    assert.isTrue(result.found)
    assert.isTrue(result.conflict)
  })
})

test.group('JobLifecycleService — getQueuePosition', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('returns position, hrrnScore, and totalPending', async ({ assert }) => {
    const cfg = await createImageConfig()
    const now = DateTime.now()

    // Job A: waiting 120s → higher HRRN score
    await Job.create({
      submissionId: 1,
      dockerImageTag: 'test/grader:lifecycle',
      status: 'pending',
      priority: 5,
      sourcePath: '/tmp/a',
      resultDelivered: false,
      estimatedRuntime: 15,
      retryCount: 0,
      submittedAt: now.minus({ seconds: 120 }),
      imageConfigId: cfg.id,
    })

    // Job B: waiting 10s → lower HRRN score, this is the job we're querying
    const jobB = await Job.create({
      submissionId: 2,
      dockerImageTag: 'test/grader:lifecycle',
      status: 'pending',
      priority: 5,
      sourcePath: '/tmp/b',
      resultDelivered: false,
      estimatedRuntime: 15,
      retryCount: 0,
      submittedAt: now.minus({ seconds: 10 }),
      imageConfigId: cfg.id,
    })

    const pos = await jobLifecycleService.getQueuePosition(jobB.jobId)

    assert.equal(pos.position, 2) // one job ahead
    assert.equal(pos.totalPending, 2)
    assert.isNotNull(pos.hrrnScore)
    assert.isAbove(pos.hrrnScore!, 1.0)
  })
})
