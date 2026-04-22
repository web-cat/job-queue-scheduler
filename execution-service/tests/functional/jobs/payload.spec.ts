import { test } from '@japa/runner'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'

const TEST_SUBMISSION_ID = 900501

async function ensureImageConfig() {
  return ImageConfig.firstOrCreate(
    { dockerImageTag: 'webcat/payload-test:example' },
    {
      displayName: 'Payload Test Grader',
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 0,
      defaultPriority: 5,
      defaultEstimatedRuntime: 15,
      isActive: true,
      totalCompletedJobs: 0,
    }
  )
}

async function createCompletedJob(imageConfigId: number, sourcePath: string) {
  return Job.create({
    submissionId: TEST_SUBMISSION_ID,
    dockerImageTag: 'webcat/payload-test:example',
    status: 'completed',
    priority: 5,
    sourcePath,
    resultDelivered: false,
    estimatedRuntime: 15,
    retryCount: 0,
    submittedAt: DateTime.now(),
    completedAt: DateTime.now(),
    imageConfigId,
  })
}

test.group('GET /api/v1/jobs/:id/payload', (group) => {
  let tmpBase: string

  group.setup(async () => {
    await ensureImageConfig()
  })

  group.each.setup(async () => {
    tmpBase = path.join(tmpdir(), `payload-func-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(tmpBase, { recursive: true })

    await db.from('jobs').where('submission_id', TEST_SUBMISSION_ID).delete()
  })

  group.each.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    await db.from('jobs').where('submission_id', TEST_SUBMISSION_ID).delete()
  })

  test('streams the payload file with correct headers', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await createCompletedJob(cfg.id, path.join(tmpBase, 'source'))

    const payloadDir = path.join(tmpBase, String(job.jobId))
    await mkdir(payloadDir, { recursive: true })
    const payloadPath = path.join(payloadDir, 'payload.zip')
    const payloadBytes = Buffer.from('fake-zip-contents-for-test')
    await writeFile(payloadPath, payloadBytes)

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 100,
      toolScore: null,
      comments: null,
      commentFormat: null,
      testOutput: null,
      containerLogs: null,
      exitCode: 0,
      cpuUsage: null,
      ramUsage: null,
      runtimeMs: 1000,
      podName: 'test-pod',
      nodeIp: null,
      payloadPath,
      payloadFilename: 'payload.zip',
      payloadSizeBytes: payloadBytes.length,
    })

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'application/octet-stream')
    assert.equal(response.header('content-disposition'), 'attachment; filename="payload.zip"')
    assert.equal(response.header('content-length'), String(payloadBytes.length))
  })

  test('returns 404 JOB_NOT_FOUND when no Job row exists for the id', async ({ client, assert }) => {
    const response = await client.get('/api/v1/jobs/99999999/payload')

    response.assertStatus(404)
    const body = (await response.body()) as any
    assert.equal(body.error.code, 'JOB_NOT_FOUND')
  })

  test('returns 202 with status when job exists but is not completed', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await Job.create({
      submissionId: TEST_SUBMISSION_ID,
      dockerImageTag: 'webcat/payload-test:example',
      status: 'pending',
      priority: 5,
      sourcePath: path.join(tmpBase, 'source'),
      resultDelivered: false,
      estimatedRuntime: 15,
      retryCount: 0,
      submittedAt: DateTime.now(),
      completedAt: null,
      imageConfigId: cfg.id,
    })

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(202)
    const body = (await response.body()) as any
    assert.equal(body.status, 'pending')
  })

  test('returns 404 NO_PAYLOAD when completed job has no JobResult row', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await createCompletedJob(cfg.id, path.join(tmpBase, 'source'))

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(404)
    const body = (await response.body()) as any
    assert.equal(body.error.code, 'NO_PAYLOAD')
  })

  test('returns 404 NO_PAYLOAD when JobResult has no payload_path', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await createCompletedJob(cfg.id, path.join(tmpBase, 'source'))

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 100,
      toolScore: null,
      comments: null,
      commentFormat: null,
      testOutput: null,
      containerLogs: null,
      exitCode: 0,
      cpuUsage: null,
      ramUsage: null,
      runtimeMs: 1000,
      podName: 'test-pod',
      nodeIp: null,
      payloadPath: null,
      payloadFilename: null,
      payloadSizeBytes: null,
    })

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(404)
    const body = (await response.body()) as any
    assert.equal(body.error.code, 'NO_PAYLOAD')
  })

  test('returns 404 PAYLOAD_DELETED when payload_path set but file missing on disk', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await createCompletedJob(cfg.id, path.join(tmpBase, 'source'))

    const missingPath = path.join(tmpBase, 'ghost', 'payload.zip')

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: 100,
      toolScore: null,
      comments: null,
      commentFormat: null,
      testOutput: null,
      containerLogs: null,
      exitCode: 0,
      cpuUsage: null,
      ramUsage: null,
      runtimeMs: 1000,
      podName: 'test-pod',
      nodeIp: null,
      payloadPath: missingPath,
      payloadFilename: 'payload.zip',
      payloadSizeBytes: 100,
    })

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(404)
    const body = (await response.body()) as any
    assert.equal(body.error.code, 'PAYLOAD_DELETED')
  })

  test('sanitizes filename to strip CR/LF/quote characters in Content-Disposition', async ({ client, assert }) => {
    const cfg = await ensureImageConfig()
    const job = await createCompletedJob(cfg.id, path.join(tmpBase, 'source'))

    const payloadDir = path.join(tmpBase, String(job.jobId))
    await mkdir(payloadDir, { recursive: true })
    const payloadPath = path.join(payloadDir, 'payload.zip')
    const payloadBytes = Buffer.from('x')
    await writeFile(payloadPath, payloadBytes)

    await JobResult.create({
      jobId: job.jobId,
      correctnessScore: null,
      toolScore: null,
      comments: null,
      commentFormat: null,
      testOutput: null,
      containerLogs: null,
      exitCode: 0,
      cpuUsage: null,
      ramUsage: null,
      runtimeMs: 1,
      podName: null,
      nodeIp: null,
      payloadPath,
      payloadFilename: 'weird"name\r\nfile.zip',
      payloadSizeBytes: payloadBytes.length,
    })

    const response = await client.get(`/api/v1/jobs/${job.jobId}/payload`)

    response.assertStatus(200)
    const disposition = response.header('content-disposition') as string
    assert.notInclude(disposition, '"name')
    assert.notInclude(disposition, '\r')
    assert.notInclude(disposition, '\n')
    assert.match(disposition, /filename="weirdnamefile\.zip"/)
  })
})
