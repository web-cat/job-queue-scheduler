import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import SystemSetting from '#models/system_setting'
import User from '#models/user'

const METRICS_IMAGE_TAG = 'test/grader:metrics'
const METRICS_IMAGE_TAG_ALT = 'test/grader:metrics-alt'
const TEST_USER_EMAIL = 'metrics-test@webcat.local'

async function createAuthedUser(): Promise<string> {
  const user = await User.firstOrCreate(
    { email: TEST_USER_EMAIL },
    { email: TEST_USER_EMAIL, password: 'password123', fullName: 'Metrics Test' }
  )
  const token = await User.accessTokens.create(user)
  return token.value!.release()
}

async function cleanUsers() {
  const user = await User.findBy('email', TEST_USER_EMAIL)
  if (user) {
    await db.from('auth_access_tokens').where('tokenable_id', user.id).delete()
    await user.delete()
  }
}

async function makeImageConfig(tag: string) {
  return ImageConfig.create({
    dockerImageTag: tag,
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

async function seedJobs() {
  const cfg = await makeImageConfig(METRICS_IMAGE_TAG)
  const cfgAlt = await makeImageConfig(METRICS_IMAGE_TAG_ALT)
  const now = DateTime.now()

  const base = {
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 10,
    retryCount: 0,
  }

  await Job.createMany([
    // Pending (age ~5m)
    {
      ...base,
      submissionId: 2001,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'pending',
      submittedAt: now.minus({ minutes: 5 }),
      imageConfigId: cfg.id,
    },
    // Pending (age ~10m, so oldest_pending_age_seconds ≈ 600)
    {
      ...base,
      submissionId: 2002,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'pending',
      submittedAt: now.minus({ minutes: 10 }),
      imageConfigId: cfg.id,
    },
    // Processing
    {
      ...base,
      submissionId: 2003,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'processing',
      submittedAt: now.minus({ minutes: 3 }),
      startedAt: now.minus({ minutes: 1 }),
      workerPodName: 'pod-a',
      imageConfigId: cfg.id,
    },
    // Completed in last 24h: tag A, 30s runtime, 60s wait
    {
      ...base,
      submissionId: 2004,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'completed',
      submittedAt: now.minus({ hours: 2 }),
      startedAt: now.minus({ hours: 2 }).plus({ seconds: 60 }),
      completedAt: now.minus({ hours: 2 }).plus({ seconds: 90 }),
      actualRuntime: 30,
      imageConfigId: cfg.id,
    },
    // Completed in last 24h: tag A, 20s runtime, 40s wait
    {
      ...base,
      submissionId: 2005,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'completed',
      submittedAt: now.minus({ hours: 1 }),
      startedAt: now.minus({ hours: 1 }).plus({ seconds: 40 }),
      completedAt: now.minus({ hours: 1 }).plus({ seconds: 60 }),
      actualRuntime: 20,
      imageConfigId: cfg.id,
    },
    // Failed in last 24h: tag A
    {
      ...base,
      submissionId: 2006,
      dockerImageTag: METRICS_IMAGE_TAG,
      status: 'failed',
      submittedAt: now.minus({ hours: 3 }),
      completedAt: now.minus({ hours: 3 }).plus({ minutes: 1 }),
      errorMessage: 'timeout',
      imageConfigId: cfg.id,
    },
    // Completed in last 24h: tag ALT
    {
      ...base,
      submissionId: 2007,
      dockerImageTag: METRICS_IMAGE_TAG_ALT,
      status: 'completed',
      submittedAt: now.minus({ hours: 4 }),
      startedAt: now.minus({ hours: 4 }).plus({ seconds: 20 }),
      completedAt: now.minus({ hours: 4 }).plus({ seconds: 50 }),
      actualRuntime: 30,
      imageConfigId: cfgAlt.id,
    },
  ])
}

// ---------------------------------------------------------------------------
// GET /api/v1/metrics/overview
// ---------------------------------------------------------------------------

test.group('GET /api/v1/metrics/overview', (group) => {
  group.each.setup(async () => {
    await cleanUsers()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').whereIn('docker_image_tag', [METRICS_IMAGE_TAG, METRICS_IMAGE_TAG_ALT]).delete()
    await seedJobs()
  })

  group.each.teardown(async () => {
    await cleanUsers()
  })

  test('returns 401 without a bearer token', async ({ client }) => {
    const res = await client.get('/api/v1/metrics/overview')
    res.assertStatus(401)
  })

  test('returns aggregate metrics with a valid token', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client.get('/api/v1/metrics/overview').bearerToken(token)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total_pending, 2)
    assert.equal(body.total_processing, 1)
    assert.equal(body.total_completed_24h, 3)
    assert.equal(body.total_failed_24h, 1)

    // Average runtime for completed jobs in last 24h: (30 + 20 + 30) / 3 ≈ 26.67
    assert.closeTo(body.avg_execution_seconds_24h, 26.67, 1)
    // Average wait: (60 + 40 + 20) / 3 = 40
    assert.closeTo(body.avg_wait_seconds_24h, 40, 1)

    // throughput = 3 / 24 = 0.125
    assert.closeTo(body.throughput_per_hour, 0.125, 0.001)
    // failed_rate = 1 / (3 + 1) = 0.25
    assert.closeTo(body.failed_rate_24h, 0.25, 0.001)

    // Oldest pending age ≈ 600 seconds (10 minutes). Allow slack for timing.
    assert.isAtLeast(body.oldest_pending_age_seconds, 590)
  })

  test('returns zeros when there are no jobs', async ({ client, assert }) => {
    // Wipe jobs for this specific test
    await db.from('jobs').delete()

    const token = await createAuthedUser()
    const res = await client.get('/api/v1/metrics/overview').bearerToken(token)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total_pending, 0)
    assert.equal(body.total_processing, 0)
    assert.equal(body.total_completed_24h, 0)
    assert.equal(body.total_failed_24h, 0)
    assert.equal(body.throughput_per_hour, 0)
    assert.equal(body.failed_rate_24h, 0)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/metrics/images
// ---------------------------------------------------------------------------

test.group('GET /api/v1/metrics/images', (group) => {
  group.each.setup(async () => {
    await cleanUsers()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').whereIn('docker_image_tag', [METRICS_IMAGE_TAG, METRICS_IMAGE_TAG_ALT]).delete()
    await seedJobs()
  })

  group.each.teardown(async () => {
    await cleanUsers()
  })

  test('returns 401 without a bearer token', async ({ client }) => {
    const res = await client.get('/api/v1/metrics/images')
    res.assertStatus(401)
  })

  test('returns per-image breakdown with a valid token', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client.get('/api/v1/metrics/images').bearerToken(token)
    res.assertStatus(200)
    const body = res.body() as any

    assert.isArray(body)
    const tags = body.map((r: any) => r.docker_image_tag)
    assert.include(tags, METRICS_IMAGE_TAG)
    assert.include(tags, METRICS_IMAGE_TAG_ALT)

    const main = body.find((r: any) => r.docker_image_tag === METRICS_IMAGE_TAG)
    // tag A within last 24h: 2 pending + 1 processing + 2 completed + 1 failed = 6
    assert.equal(main.total_jobs, 6)
    // success_rate for tag A = 2 completed / (2 completed + 1 failed) ≈ 0.667
    assert.closeTo(main.success_rate, 2 / 3, 0.01)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/health
// ---------------------------------------------------------------------------

test.group('GET /api/v1/health', (group) => {
  group.each.setup(async () => {
    await db.from('system_settings').where('key', 'scheduler_strategy').delete()
  })

  test('returns 200 with database=connected and scheduler_strategy', async ({ client, assert }) => {
    await SystemSetting.create({
      key: 'scheduler_strategy',
      value: 'HRRN',
      description: 'Active scheduler',
    })

    const res = await client.get('/api/v1/health')
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'ok')
    assert.equal(body.database, 'connected')
    assert.equal(body.scheduler_strategy, 'HRRN')
  })

  test('returns scheduler_strategy=null when setting is missing', async ({ client, assert }) => {
    const res = await client.get('/api/v1/health')
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'ok')
    assert.equal(body.database, 'connected')
    assert.isNull(body.scheduler_strategy)
  })

  test('does not require authentication', async ({ client }) => {
    // No bearer token, should still work
    const res = await client.get('/api/v1/health')
    res.assertStatus(200)
  })
})
