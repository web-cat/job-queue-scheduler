import ImageConfig from '#models/image_config'
import Job from '#models/job'
import db from '@adonisjs/lucid/services/db'
import type { ApiResponse } from '@japa/api-client'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/** Index may serialize as `{ data: [...] }` or a top-level array depending on transformer output. */
function listPayload(res: ApiResponse) {
  const body = res.body() as unknown
  if (Array.isArray(body)) {
    return body
  }
  if (
    body &&
    typeof body === 'object' &&
    'data' in body &&
    Array.isArray((body as { data: unknown }).data)
  ) {
    return (body as { data: unknown[] }).data
  }
  return []
}

const validPayload = {
  docker_image_tag: 'webcat/test-grader:v1',
  display_name: 'Test grader',
  timeout_seconds: 30,
  memory_limit_mb: 512,
  cpu_limit_millicores: 1000,
  max_retries: 3,
  default_priority: 5,
  default_estimated_runtime: 15.0,
}

test.group('Image config API', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('GET /api/v1/images lists configs', async ({ client, assert }) => {
    await ImageConfig.create({
      dockerImageTag: 'a/grader:1',
      displayName: 'A',
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 3,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const res = await client.get('/api/v1/images')
    res.assertStatus(200)
    const items = listPayload(res) as { docker_image_tag: string }[]
    assert.equal(items.length, 1)
    assert.equal(items[0].docker_image_tag, 'a/grader:1')
  })

  test('POST /api/v1/images creates and applies defaults', async ({ client, assert }) => {
    const res = await client.post('/api/v1/images').json({
      docker_image_tag: validPayload.docker_image_tag,
      timeout_seconds: 20,
      memory_limit_mb: 256,
      cpu_limit_millicores: 500,
      default_estimated_runtime: 12.0,
    })
    res.assertStatus(201)
    const row = res.body() as { data: { max_retries: number; default_priority: number } }
    assert.equal(row.data.max_retries, 3)
    assert.equal(row.data.default_priority, 5)
  })

  test('POST /api/v1/images returns 409 when tag exists', async ({ client }) => {
    await client.post('/api/v1/images').json(validPayload)
    const dup = await client.post('/api/v1/images').json(validPayload)
    dup.assertStatus(409)
  })

  test('GET /api/v1/images/:id show and 404', async ({ client, assert }) => {
    const cfg = await ImageConfig.create({
      dockerImageTag: 'show/me:1',
      displayName: null,
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 3,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const ok = await client.get(`/api/v1/images/${cfg.id}`)
    ok.assertStatus(200)
    assert.equal((ok.body() as { data: { id: number } }).data.id, cfg.id)

    const missing = await client.get('/api/v1/images/999999')
    missing.assertStatus(404)
  })

  test('PUT /api/v1/images/:id partial update', async ({ client, assert }) => {
    const cfg = await ImageConfig.create({
      dockerImageTag: 'put/test:1',
      displayName: 'Old',
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 3,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const res = await client.put(`/api/v1/images/${cfg.id}`).json({ display_name: 'New' })
    res.assertStatus(200)
    assert.equal((res.body() as { data: { display_name: string } }).data.display_name, 'New')
    assert.equal((res.body() as { data: { timeout_seconds: number } }).data.timeout_seconds, 30)
  })

  test('DELETE /api/v1/images/:id soft-deletes', async ({ client, assert }) => {
    const cfg = await ImageConfig.create({
      dockerImageTag: 'del/test:1',
      displayName: null,
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 3,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const res = await client.delete(`/api/v1/images/${cfg.id}`)
    res.assertStatus(200)
    assert.equal((res.body() as { data: { is_active: boolean } }).data.is_active, false)

    await cfg.refresh()
    assert.isFalse(cfg.isActive)
  })

  test('GET /api/v1/images/:id/stats aggregates jobs', async ({ client, assert }) => {
    const cfg = await ImageConfig.create({
      dockerImageTag: 'stats/grader:1',
      displayName: null,
      timeoutSeconds: 30,
      memoryLimitMb: 512,
      cpuLimitMillicores: 1000,
      maxRetries: 3,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })

    const baseJob = {
      submissionId: 1,
      dockerImageTag: cfg.dockerImageTag,
      priority: 5,
      sourcePath: '/tmp/s',
      resultDelivered: false,
      submittedAt: DateTime.fromISO('2026-01-01T12:00:00Z'),
      estimatedRuntime: 10,
      retryCount: 0,
      imageConfigId: cfg.id,
    }

    await Job.createMany([
      {
        ...baseJob,
        submissionId: 101,
        status: 'completed',
        startedAt: DateTime.fromISO('2026-01-01T12:00:10Z'),
        completedAt: DateTime.fromISO('2026-01-01T12:00:20Z'),
        actualRuntime: 10,
      },
      {
        ...baseJob,
        submissionId: 102,
        status: 'completed',
        startedAt: DateTime.fromISO('2026-01-01T12:00:05Z'),
        completedAt: DateTime.fromISO('2026-01-01T12:00:15Z'),
        actualRuntime: 20,
      },
      {
        ...baseJob,
        submissionId: 103,
        status: 'failed',
        startedAt: DateTime.fromISO('2026-01-01T12:00:01Z'),
        completedAt: DateTime.fromISO('2026-01-01T12:00:02Z'),
        actualRuntime: null,
      },
      {
        ...baseJob,
        submissionId: 104,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        actualRuntime: null,
      },
    ])

    const res = await client.get(`/api/v1/images/${cfg.id}/stats`)
    res.assertStatus(200)
    const d = (res.body() as { data: Record<string, unknown> }).data
    assert.equal(d.docker_image_tag, cfg.dockerImageTag)
    assert.equal(d.total_jobs, 4)
    assert.equal(d.completed_jobs, 2)
    assert.equal(d.failed_jobs, 1)
    assert.closeTo(d.success_rate as number, 2 / 3, 0.0001)
    assert.closeTo(d.avg_runtime_seconds as number, 15, 0.0001)
    assert.isAbove(d.avg_wait_seconds as number, 0)
  })
})
