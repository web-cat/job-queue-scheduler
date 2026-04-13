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

test.group('SchedulerService — HRRN', (group) => {
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

  test('dequeues the job with higher response ratio first', async ({ assert }) => {
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
    const first = await service.dequeueNext('worker-1')

    assert.isNotNull(first)
    assert.approximately(first!.hrrnScoreAtDequeue!, 7.0, 0.5)
  })

  test('empty queue returns null', async ({ assert }) => {
    const service = new SchedulerService()
    const result = await service.dequeueNext('worker-1')
    assert.isNull(result)
  })

  test('concurrent dequeue: each call gets a different job (SKIP LOCKED)', async ({ assert }) => {
    const now = DateTime.now()

    for (let i = 0; i < 5; i++) {
      await Job.create({
        ...pendingJob({ imageConfigId }),
        submittedAt: now.minus({ seconds: i }),
      })
    }

    const service = new SchedulerService()
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
})
