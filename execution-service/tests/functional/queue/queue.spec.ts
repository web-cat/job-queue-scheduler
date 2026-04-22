import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'

const QUEUE_IMAGE_TAG = 'test/grader:queue'

async function makeImageConfig() {
  return ImageConfig.create({
    dockerImageTag: QUEUE_IMAGE_TAG,
    displayName: null,
    timeoutSeconds: 30,
    memoryLimitMb: 512,
    cpuLimitMillicores: 1000,
    maxRetries: 1,
    defaultPriority: 5,
    defaultEstimatedRuntime: 15,
    isActive: true,
    totalCompletedJobs: 0,
    avgRuntimeSeconds: null,
  })
}

async function makeJob(imageConfigId: number, overrides: Partial<InstanceType<typeof Job>> = {}) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: QUEUE_IMAGE_TAG,
    status: 'pending',
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 10,
    retryCount: 0,
    submittedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// GET /api/v1/queue/status
// ---------------------------------------------------------------------------

test.group('GET /api/v1/queue/status', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', QUEUE_IMAGE_TAG).delete()
  })

  test('returns zeros when there are no jobs', async ({ client, assert }) => {
    const res = await client.get('/api/v1/queue/status')
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.pending_count, 0)
    assert.equal(body.processing_count, 0)
    assert.equal(body.completed_today, 0)
    assert.equal(body.failed_today, 0)
    assert.equal(body.active_workers, 0)
    assert.equal(body.estimated_drain_time_seconds, 0)
  })

  test('returns accurate counts across job statuses', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const now = DateTime.now()

    // 3 pending, 2 processing (2 distinct workers), 1 completed today, 1 failed today
    await makeJob(cfg.id, { status: 'pending' })
    await makeJob(cfg.id, { status: 'pending' })
    await makeJob(cfg.id, { status: 'pending' })
    await makeJob(cfg.id, {
      status: 'processing',
      startedAt: now.minus({ seconds: 5 }),
      workerPodName: 'worker-a',
    })
    await makeJob(cfg.id, {
      status: 'processing',
      startedAt: now.minus({ seconds: 5 }),
      workerPodName: 'worker-b',
    })
    await makeJob(cfg.id, {
      status: 'completed',
      submittedAt: now.minus({ minutes: 5 }),
      startedAt: now.minus({ minutes: 4 }),
      completedAt: now.minus({ minutes: 3 }),
      actualRuntime: 30,
    })
    await makeJob(cfg.id, {
      status: 'failed',
      submittedAt: now.minus({ minutes: 6 }),
      completedAt: now.minus({ minutes: 4 }),
      errorMessage: 'timeout',
    })

    const res = await client.get('/api/v1/queue/status')
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.pending_count, 3)
    assert.equal(body.processing_count, 2)
    assert.equal(body.completed_today, 1)
    assert.equal(body.failed_today, 1)
    assert.equal(body.active_workers, 2)

    // avg_wait_seconds = (started_at - submitted_at) for the completed job in last hour = 60s
    assert.closeTo(body.avg_wait_seconds, 60, 5)
    // estimated_drain_time = pending (3) * avg_exec (30s) = 90
    assert.closeTo(body.estimated_drain_time_seconds, 90, 1)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/queue/position/:id
// ---------------------------------------------------------------------------

test.group('GET /api/v1/queue/position/:id', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', QUEUE_IMAGE_TAG).delete()
  })

  test('returns 404 for non-existent job', async ({ client }) => {
    const res = await client.get('/api/v1/queue/position/999999')
    res.assertStatus(404)
  })

  test('returns 409 for a processing job', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'processing',
      startedAt: DateTime.now(),
      workerPodName: 'pod-1',
    })

    const res = await client.get(`/api/v1/queue/position/${job.jobId}`)
    res.assertStatus(409)
    const body = res.body() as any
    assert.equal(body.error?.code, 'JOB_NOT_PENDING')
  })

  test('returns 409 for a completed job', async ({ client }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'completed',
      completedAt: DateTime.now(),
    })

    const res = await client.get(`/api/v1/queue/position/${job.jobId}`)
    res.assertStatus(409)
  })

  test('returns position 1 when the job has the highest HRRN score', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const now = DateTime.now()

    // The "older" job has a higher HRRN score (longer wait, same burst)
    const older = await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 120 }),
      estimatedRuntime: 10,
    })
    await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 5 }),
      estimatedRuntime: 10,
    })

    const res = await client.get(`/api/v1/queue/position/${older.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.job_id, older.jobId)
    assert.equal(body.position, 1)
    assert.equal(body.total_pending, 2)
    assert.isAbove(body.hrrn_score, 2) // (120+10)/10 = 13, well above the other's 1.5
  })

  test('returns position 2 when there is one job ahead', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const now = DateTime.now()

    await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 120 }),
      estimatedRuntime: 10,
    })
    const younger = await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 5 }),
      estimatedRuntime: 10,
    })

    const res = await client.get(`/api/v1/queue/position/${younger.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.job_id, younger.jobId)
    assert.equal(body.position, 2)
    assert.equal(body.total_pending, 2)
  })

  test('estimated_wait_seconds scales with position', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const now = DateTime.now()

    // Seed a recent completion so avg_exec is known (~30s)
    await makeJob(cfg.id, {
      status: 'completed',
      submittedAt: now.minus({ minutes: 5 }),
      startedAt: now.minus({ minutes: 4 }),
      completedAt: now.minus({ minutes: 3 }),
      actualRuntime: 30,
    })

    const older = await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 120 }),
      estimatedRuntime: 10,
    })
    const younger = await makeJob(cfg.id, {
      submittedAt: now.minus({ seconds: 5 }),
      estimatedRuntime: 10,
    })

    const resOlder = await client.get(`/api/v1/queue/position/${older.jobId}`)
    const resYounger = await client.get(`/api/v1/queue/position/${younger.jobId}`)

    const bodyOlder = resOlder.body() as any
    const bodyYounger = resYounger.body() as any

    assert.equal(bodyOlder.position, 1)
    assert.equal(bodyYounger.position, 2)
    // position 2 should wait ~2x longer than position 1
    assert.isAbove(bodyYounger.estimated_wait_seconds, bodyOlder.estimated_wait_seconds)
  })
})
