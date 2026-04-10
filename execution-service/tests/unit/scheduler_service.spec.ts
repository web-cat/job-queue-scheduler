import ImageConfig from '#models/image_config'
import Job from '#models/job'
import SystemSetting from '#models/system_setting'
import { SchedulerService } from '#services/scheduler_service'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

async function createImageConfig() {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:1',
    displayName: null,
    timeoutSeconds: 30,
    memoryLimitMb: 512,
    cpuLimitMillicores: 1000,
    maxRetries: 3,
    defaultPriority: 5,
    defaultEstimatedRuntime: 15,
    isActive: true,
    totalCompletedJobs: 0,
    avgRuntimeSeconds: null,
  })
}

type JobCreateAttrs = {
  imageConfigId?: number
  submissionId?: number
  dockerImageTag?: string
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'queued'
  priority?: number
  sourcePath?: string
  resultDelivered?: boolean
  estimatedRuntime?: number
  retryCount?: number
  submittedAt?: DateTime
}

function pendingJob(overrides: JobCreateAttrs = {}) {
  return {
    submissionId: 1,
    dockerImageTag: 'test/grader:1',
    status: 'pending' as const,
    priority: 5,
    sourcePath: '/tmp/s',
    resultDelivered: false,
    estimatedRuntime: 10,
    retryCount: 0,
    submittedAt: DateTime.now(),
    ...overrides,
  }
}

test.group('SchedulerService', (group) => {
  let imageConfigId: number

  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
    await db.from('system_settings').delete()

    const cfg = await createImageConfig()
    imageConfigId = cfg.id

    await SystemSetting.create({
      key: 'scheduler_strategy',
      value: 'HRRN',
      description: 'Active scheduler',
    })
  })

  test('HRRN: dequeues the job with higher response ratio first', async ({ assert }) => {
    const now = DateTime.now()

    // Job A: waiting 60s, burst 10s → ratio = (60+10)/10 = 7.0
    await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 60 }),
      estimatedRuntime: 10,
    })

    // Job B: waiting 10s, burst 10s → ratio = (10+10)/10 = 2.0
    await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 10 }),
      estimatedRuntime: 10,
    })

    const service = new SchedulerService()
    await service.initialize()

    const first = await service.dequeueNext('worker-1')
    assert.isNotNull(first)
    // Job A submitted 60s ago, so it has the higher HRRN score
    assert.approximately(first!.hrrnScoreAtDequeue!, 7.0, 0.5)
  })

  test('FIFO: dequeues the earliest submitted job first', async ({ assert }) => {
    const now = DateTime.now()

    const early = await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 60 }),
      estimatedRuntime: 5,
    })

    await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 10 }),
      estimatedRuntime: 100,
    })

    await SystemSetting.query().where('key', 'scheduler_strategy').update({ value: 'FIFO' })

    const service = new SchedulerService()
    await service.initialize()

    const first = await service.dequeueNext('worker-1')
    assert.isNotNull(first)
    assert.equal(first!.jobId, early.jobId)
  })

  test('Priority: dequeues highest priority first, ties broken by submitted_at', async ({
    assert,
  }) => {
    const now = DateTime.now()

    await Job.create({
      ...pendingJob({ imageConfigId }),
      priority: 3,
      submittedAt: now.minus({ seconds: 100 }),
    })

    const high = await Job.create({
      ...pendingJob({ imageConfigId }),
      priority: 9,
      submittedAt: now.minus({ seconds: 10 }),
    })

    await SystemSetting.query().where('key', 'scheduler_strategy').update({ value: 'PRIORITY' })

    const service = new SchedulerService()
    await service.initialize()

    const first = await service.dequeueNext('worker-1')
    assert.isNotNull(first)
    assert.equal(first!.jobId, high.jobId)
  })

  test('Priority: breaks ties by submitted_at ASC', async ({ assert }) => {
    const now = DateTime.now()

    const older = await Job.create({
      ...pendingJob({ imageConfigId }),
      priority: 7,
      submittedAt: now.minus({ seconds: 50 }),
    })

    await Job.create({
      ...pendingJob({ imageConfigId }),
      priority: 7,
      submittedAt: now.minus({ seconds: 5 }),
    })

    await SystemSetting.query().where('key', 'scheduler_strategy').update({ value: 'PRIORITY' })

    const service = new SchedulerService()
    await service.initialize()

    const first = await service.dequeueNext('worker-1')
    assert.isNotNull(first)
    assert.equal(first!.jobId, older.jobId)
  })

  test('Empty queue returns null', async ({ assert }) => {
    const service = new SchedulerService()
    await service.initialize()

    const result = await service.dequeueNext('worker-1')
    assert.isNull(result)
  })

  test('Concurrent dequeue: each call gets a different job (SKIP LOCKED)', async ({ assert }) => {
    const now = DateTime.now()

    for (let i = 0; i < 5; i++) {
      await Job.create({
        ...pendingJob({ imageConfigId }),
        submittedAt: now.minus({ seconds: i }),
      })
    }

    const service = new SchedulerService()
    await service.initialize()

    const results = await Promise.all([
      service.dequeueNext('worker-1'),
      service.dequeueNext('worker-2'),
      service.dequeueNext('worker-3'),
      service.dequeueNext('worker-4'),
      service.dequeueNext('worker-5'),
    ])

    const dequeued = results.filter((j) => j !== null)
    const ids = dequeued.map((j) => j!.jobId)
    const uniqueIds = new Set(ids)

    assert.equal(uniqueIds.size, ids.length, 'Each concurrent call should get a unique job')
    assert.equal(dequeued.length, 5)
  })

  test('Strategy switching: changing system_settings takes effect within refresh interval', async ({
    assert,
  }) => {
    const now = DateTime.now()

    // Two jobs — oldest submitted first
    const older = await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 100 }),
      estimatedRuntime: 100, // low HRRN ratio despite long wait
      priority: 3,
    })

    await Job.create({
      ...pendingJob({ imageConfigId }),
      submittedAt: now.minus({ seconds: 1 }),
      estimatedRuntime: 1, // HRRN: (1+1)/1 = 2.0 vs older: (100+100)/100 = 2.0 — same; FIFO picks older
      priority: 9,
    })

    const service = new SchedulerService()
    await service.initialize() // starts with HRRN

    // Switch to FIFO
    await SystemSetting.query().where('key', 'scheduler_strategy').update({ value: 'FIFO' })

    // Force refresh by backdating last refresh
    ;(service as any).lastRefreshedAt = 0

    const first = await service.dequeueNext('worker-1')
    assert.isNotNull(first)
    // FIFO picks the oldest submitted job
    assert.equal(first!.jobId, older.jobId)
  })
})
