import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import timeoutService from '#services/timeout_service'

async function createImageConfig(overrides: Partial<InstanceType<typeof ImageConfig>> = {}) {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:timeout',
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
    ...overrides,
  })
}

async function createJob(
  imageConfigId: number,
  overrides: Partial<InstanceType<typeof Job>> = {}
) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: 'test/grader:timeout',
    status: 'processing',
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 15,
    retryCount: 0,
    submittedAt: DateTime.now(),
    workerPodName: 'pod-timeout-test',
    startedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

test.group('TimeoutService — detectStuckJobs', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('marks a job as failed when it exceeds timeout + grace period', async ({ assert }) => {
    const cfg = await createImageConfig({ timeoutSeconds: 30, maxRetries: 0 })
    // started_at 70s ago — exceeds 30s timeout + 30s grace (total 60s)
    const job = await createJob(cfg.id, {
      startedAt: DateTime.now().minus({ seconds: 70 }),
    })

    await timeoutService.detectStuckJobs()

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!, 'timed out after 30s')
  })

  test('does not mark a job that is within the grace period', async ({ assert }) => {
    const cfg = await createImageConfig({ timeoutSeconds: 30, maxRetries: 0 })
    // started_at 40s ago — within 30s timeout + 30s grace (total 60s)
    const job = await createJob(cfg.id, {
      startedAt: DateTime.now().minus({ seconds: 40 }),
    })

    await timeoutService.detectStuckJobs()

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'processing')
  })

  test('requeues a stuck job as pending when retries remain', async ({ assert }) => {
    const cfg = await createImageConfig({ timeoutSeconds: 30, maxRetries: 2 })
    const job = await createJob(cfg.id, {
      startedAt: DateTime.now().minus({ seconds: 70 }),
      retryCount: 0,
    })

    await timeoutService.detectStuckJobs()

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'pending')
    assert.equal(updated.retryCount, 1)
    assert.isNull(updated.workerPodName)
  })

  test('ignores jobs that are not in processing status', async ({ assert }) => {
    const cfg = await createImageConfig({ timeoutSeconds: 30 })
    const job = await createJob(cfg.id, {
      status: 'pending',
      startedAt: DateTime.now().minus({ seconds: 70 }),
    })

    await timeoutService.detectStuckJobs()

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'pending')
  })

  test('ignores jobs with null started_at', async ({ assert }) => {
    const cfg = await createImageConfig({ timeoutSeconds: 30 })
    const job = await createJob(cfg.id, { startedAt: null as any })

    await timeoutService.detectStuckJobs()

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'processing')
  })

  test('handles empty queue without errors', async ({ assert }) => {
    await assert.doesNotRejects(() => timeoutService.detectStuckJobs())
  })
})
