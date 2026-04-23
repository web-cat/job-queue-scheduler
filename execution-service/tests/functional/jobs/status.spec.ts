import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeImageConfig() {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:status',
    displayName: 'Status Test',
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
    dockerImageTag: 'test/grader:status',
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

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/:id
// ---------------------------------------------------------------------------

test.group('GET /api/v1/jobs/:id — job show', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', 'test/grader:status').delete()
  })

  test('returns 404 for non-existent job', async ({ client, assert }) => {
    const res = await client.get('/api/v1/jobs/999999')
    res.assertStatus(404)
    const body = res.body() as any
    assert.equal(body.error?.code, 'JOB_NOT_FOUND')
  })

  test('returns queue_position and estimated_wait_seconds for pending job', async ({
    client,
    assert,
  }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, { status: 'pending' })

    const res = await client.get(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)

    const body = res.body() as any
    assert.equal(body.job_id, job.jobId)
    assert.equal(body.status, 'pending')
    assert.equal(body.docker_image_tag, 'test/grader:status')
    assert.equal(body.queue_position, 1)
    assert.isNumber(body.estimated_wait_seconds)
    assert.isNull(body.result)
  })

  test('returns full result payload for a completed job', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'completed',
      startedAt: DateTime.now().minus({ seconds: 30 }),
      completedAt: DateTime.now(),
      actualRuntime: 12.5,
    })

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 87.5,
      toolScore: 92.0,
      comments: 'Nice work',
      commentFormat: 0,
      testOutput: 'All tests passed',
      exitCode: 0,
      runtimeMs: 12500,
    })

    const res = await client.get(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'completed')
    assert.isNull(body.queue_position)
    assert.isNotNull(body.result)
    assert.equal(body.result.correctness_score, 87.5)
    assert.equal(body.result.tool_score, 92)
    assert.equal(body.result.exit_code, 0)
    assert.equal(body.result.runtime_ms, 12500)
    assert.equal(body.actual_runtime, 12.5)
  })

  test('does not include queue_position for failed job', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'failed',
      errorMessage: 'OOMKilled',
      completedAt: DateTime.now(),
    })

    const res = await client.get(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'failed')
    assert.isNull(body.queue_position)
    assert.isNull(body.estimated_wait_seconds)
    assert.isNull(body.result)
  })

  test('returns error_message on the failed job response', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'failed',
      errorMessage: 'Container exited with code 137 (OOMKilled)',
      completedAt: DateTime.now(),
    })

    const res = await client.get(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'failed')
    assert.equal(body.error_message, 'Container exited with code 137 (OOMKilled)')
  })

  test('error_message is null for non-failed jobs', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, { status: 'pending' })

    const res = await client.get(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.status, 'pending')
    assert.isNull(body.error_message)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/:id/results
// ---------------------------------------------------------------------------

test.group('GET /api/v1/jobs/:id/results — job results', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', 'test/grader:status').delete()
  })

  test('returns 404 when job does not exist', async ({ client }) => {
    const res = await client.get('/api/v1/jobs/999999/results')
    res.assertStatus(404)
  })

  test('returns 202 when job exists but is still pending', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, { status: 'pending' })

    const res = await client.get(`/api/v1/jobs/${job.jobId}/results`)
    res.assertStatus(202)
    const body = res.body() as any
    assert.equal(body.status, 'pending')
  })

  test('returns 202 when job is processing', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'processing',
      startedAt: DateTime.now(),
      workerPodName: 'pod-1',
    })

    const res = await client.get(`/api/v1/jobs/${job.jobId}/results`)
    res.assertStatus(202)
    const body = res.body() as any
    assert.equal(body.status, 'processing')
  })

  test('returns 200 with scores for a completed job', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'completed',
      completedAt: DateTime.now(),
      actualRuntime: 10,
    })

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 75,
      toolScore: 80,
      comments: 'Partial credit',
      commentFormat: 0,
      testOutput: '4/5 tests passed',
      exitCode: 0,
      runtimeMs: 10000,
    })

    const res = await client.get(`/api/v1/jobs/${job.jobId}/results`)
    res.assertStatus(200)
    const body = res.body() as any

    assert.equal(body.job_id, job.jobId)
    assert.equal(body.correctness_score, 75)
    assert.equal(body.tool_score, 80)
    assert.equal(body.exit_code, 0)
    assert.equal(body.runtime_ms, 10000)
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/jobs/:id (cancellation)
// ---------------------------------------------------------------------------

test.group('DELETE /api/v1/jobs/:id — cancel job', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', 'test/grader:status').delete()
  })

  test('returns 404 when job does not exist', async ({ client }) => {
    const res = await client.delete('/api/v1/jobs/999999')
    res.assertStatus(404)
  })

  test('cancels a pending job and returns 200', async ({ client, assert }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, { status: 'pending' })

    const res = await client.delete(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(200)
    const body = res.body() as any
    assert.equal(body.status, 'cancelled')

    const refreshed = await Job.findOrFail(job.jobId)
    assert.equal(refreshed.status, 'cancelled')
  })

  test('returns 409 when trying to cancel a processing job', async ({ client }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'processing',
      startedAt: DateTime.now(),
      workerPodName: 'pod-1',
    })

    const res = await client.delete(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(409)
  })

  test('returns 409 when trying to cancel a completed job', async ({ client }) => {
    const cfg = await makeImageConfig()
    const job = await makeJob(cfg.id, {
      status: 'completed',
      completedAt: DateTime.now(),
    })

    const res = await client.delete(`/api/v1/jobs/${job.jobId}`)
    res.assertStatus(409)
  })
})
