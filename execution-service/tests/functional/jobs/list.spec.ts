import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'

const LIST_IMAGE_TAG = 'test/grader:list'
const LIST_IMAGE_TAG_ALT = 'test/grader:list-alt'

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

/**
 * Seeds a known fleet of 5 jobs to exercise filter + pagination logic:
 *   - 2 pending (user 42),       tag = LIST_IMAGE_TAG
 *   - 1 processing (user 42),    tag = LIST_IMAGE_TAG
 *   - 1 completed (user 99),     tag = LIST_IMAGE_TAG
 *   - 1 completed (user 42),     tag = LIST_IMAGE_TAG_ALT
 */
async function seedJobs() {
  const cfg = await makeImageConfig(LIST_IMAGE_TAG)
  const cfgAlt = await makeImageConfig(LIST_IMAGE_TAG_ALT)

  const base = {
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 10,
    retryCount: 0,
  }

  const now = DateTime.now()

  await Job.createMany([
    // oldest → newest to give stable submitted_at DESC ordering
    {
      ...base,
      submissionId: 1001,
      dockerImageTag: LIST_IMAGE_TAG,
      status: 'pending',
      submittedAt: now.minus({ minutes: 10 }),
      imageConfigId: cfg.id,
      userId: 42,
    },
    {
      ...base,
      submissionId: 1002,
      dockerImageTag: LIST_IMAGE_TAG,
      status: 'pending',
      submittedAt: now.minus({ minutes: 8 }),
      imageConfigId: cfg.id,
      userId: 42,
    },
    {
      ...base,
      submissionId: 1003,
      dockerImageTag: LIST_IMAGE_TAG,
      status: 'processing',
      submittedAt: now.minus({ minutes: 6 }),
      startedAt: now.minus({ minutes: 1 }),
      workerPodName: 'pod-1',
      imageConfigId: cfg.id,
      userId: 42,
    },
    {
      ...base,
      submissionId: 1004,
      dockerImageTag: LIST_IMAGE_TAG,
      status: 'completed',
      submittedAt: now.minus({ minutes: 4 }),
      startedAt: now.minus({ minutes: 3 }),
      completedAt: now.minus({ minutes: 2 }),
      actualRuntime: 60,
      imageConfigId: cfg.id,
      userId: 99,
    },
    {
      ...base,
      submissionId: 1005,
      dockerImageTag: LIST_IMAGE_TAG_ALT,
      status: 'completed',
      submittedAt: now.minus({ minutes: 2 }),
      startedAt: now.minus({ minutes: 1 }),
      completedAt: now,
      actualRuntime: 45,
      imageConfigId: cfgAlt.id,
      userId: 42,
    },
  ])
}

test.group('GET /api/v1/jobs — list with filters and pagination', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').whereIn('docker_image_tag', [LIST_IMAGE_TAG, LIST_IMAGE_TAG_ALT]).delete()
    await seedJobs()
  })

  test('returns all seeded jobs with total count', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs')
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 5)
    assert.equal(body.limit, 20)
    assert.equal(body.offset, 0)
    assert.isArray(body.jobs)
    assert.lengthOf(body.jobs, 5)
  })

  test('orders results by submitted_at DESC', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs')
    res.assertStatus(200)
    const body = res.body() as any

    // Newest (1005) first, oldest (1001) last. bigint submission_id is serialized as string.
    const submissionIds = body.jobs.map((j: any) => Number(j.submission_id))
    assert.deepEqual(submissionIds, [1005, 1004, 1003, 1002, 1001])
  })

  test('filters by status=pending', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ status: 'pending' })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 2)
    assert.lengthOf(body.jobs, 2)
    for (const job of body.jobs) assert.equal(job.status, 'pending')
  })

  test('filters by status=completed', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ status: 'completed' })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 2)
    for (const job of body.jobs) assert.equal(job.status, 'completed')
  })

  test('filters by user_id', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ user_id: 42 })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 4) // 2 pending + 1 processing + 1 completed for user 42
  })

  test('filters by submission_id', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ submission_id: 1003 })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 1)
    assert.equal(body.jobs[0].submission_id, 1003)
    assert.equal(body.jobs[0].status, 'processing')
  })

  test('filters by docker_image_tag', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ docker_image_tag: LIST_IMAGE_TAG_ALT })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 1)
    assert.equal(body.jobs[0].docker_image_tag, LIST_IMAGE_TAG_ALT)
  })

  test('combines multiple filters (user_id + status)', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs').qs({ user_id: 42, status: 'pending' })
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.total, 2)
    for (const job of body.jobs) {
      assert.equal(job.status, 'pending')
    }
  })

  test('respects limit and offset for pagination', async ({ client, assert }) => {
    const page1 = await client.get('/api/v1/jobs').qs({ limit: 2, offset: 0 })
    page1.assertStatus(200)
    const body1 = page1.body() as any
    assert.equal(body1.total, 5)
    assert.equal(body1.limit, 2)
    assert.equal(body1.offset, 0)
    assert.lengthOf(body1.jobs, 2)

    const page2 = await client.get('/api/v1/jobs').qs({ limit: 2, offset: 2 })
    page2.assertStatus(200)
    const body2 = page2.body() as any
    assert.lengthOf(body2.jobs, 2)

    // No overlap between pages
    const ids1 = body1.jobs.map((j: any) => j.job_id)
    const ids2 = body2.jobs.map((j: any) => j.job_id)
    for (const id of ids1) assert.notInclude(ids2, id)
  })

  test('rejects invalid status enum value with 422', async ({ client }) => {
    const res = await client.get('/api/v1/jobs').qs({ status: 'bogus' })
    res.assertStatus(422)
  })

  test('rejects limit over 100 with 422', async ({ client }) => {
    const res = await client.get('/api/v1/jobs').qs({ limit: 500 })
    res.assertStatus(422)
  })
})
