import { test } from '@japa/runner'
import { mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import cleanupService from '#services/cleanup_service'

async function createImageConfig() {
  return ImageConfig.create({
    dockerImageTag: 'test/grader:cleanup',
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
  })
}

async function createJob(
  imageConfigId: number,
  overrides: Partial<InstanceType<typeof Job>> = {}
) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: 'test/grader:cleanup',
    status: 'completed',
    priority: 5,
    sourcePath: '/tmp/test',
    resultDelivered: false,
    estimatedRuntime: 15,
    retryCount: 0,
    submittedAt: DateTime.now(),
    completedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

test.group('CleanupService — cleanupOldJobs', (group) => {
  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()
  })

  test('deletes completed jobs older than retention days', async ({ assert }) => {
    const cfg = await createImageConfig()
    const oldJob = await createJob(cfg.id, {
      status: 'completed',
      completedAt: DateTime.now().minus({ days: 31 }),
    })

    await cleanupService.cleanupOldJobs(30)

    const found = await Job.find(oldJob.jobId)
    assert.isNull(found)
  })

  test('deletes failed and cancelled jobs older than retention days', async ({ assert }) => {
    const cfg = await createImageConfig()
    const failedJob = await createJob(cfg.id, {
      status: 'failed',
      completedAt: DateTime.now().minus({ days: 35 }),
    })
    const cancelledJob = await createJob(cfg.id, {
      status: 'cancelled',
      completedAt: DateTime.now().minus({ days: 40 }),
    })

    await cleanupService.cleanupOldJobs(30)

    assert.isNull(await Job.find(failedJob.jobId))
    assert.isNull(await Job.find(cancelledJob.jobId))
  })

  test('keeps jobs newer than retention days', async ({ assert }) => {
    const cfg = await createImageConfig()
    const recentJob = await createJob(cfg.id, {
      status: 'completed',
      completedAt: DateTime.now().minus({ days: 10 }),
    })

    await cleanupService.cleanupOldJobs(30)

    const found = await Job.find(recentJob.jobId)
    assert.isNotNull(found)
  })

  test('does not delete pending or processing jobs', async ({ assert }) => {
    const cfg = await createImageConfig()
    const pendingJob = await createJob(cfg.id, {
      status: 'pending',
      completedAt: null as any,
    })

    await cleanupService.cleanupOldJobs(30)

    const found = await Job.find(pendingJob.jobId)
    assert.isNotNull(found)
  })
})

test.group('CleanupService — cleanupOrphanedFiles', (group) => {
  let tmpBase: string

  group.each.setup(async () => {
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').delete()

    tmpBase = path.join(tmpdir(), `cleanup-test-${Date.now()}`)
    await mkdir(tmpBase, { recursive: true })
  })

  group.each.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
  })

  test('removes directory for a job that does not exist in DB', async ({ assert }) => {
    const orphanDir = path.join(tmpBase, '9999')
    await mkdir(orphanDir, { recursive: true })

    await cleanupService.cleanupOrphanedFiles(tmpBase)

    assert.isFalse(await dirExists(orphanDir))
  })

  test('removes directory for a completed job', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'completed' })

    const jobDir = path.join(tmpBase, String(job.jobId))
    await mkdir(jobDir, { recursive: true })

    await cleanupService.cleanupOrphanedFiles(tmpBase)

    assert.isFalse(await dirExists(jobDir))
  })

  test('keeps directory for an active (pending) job', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, { status: 'pending', completedAt: null as any })

    const jobDir = path.join(tmpBase, String(job.jobId))
    await mkdir(jobDir, { recursive: true })

    await cleanupService.cleanupOrphanedFiles(tmpBase)

    assert.isTrue(await dirExists(jobDir))
  })

  test('keeps directory for a processing job', async ({ assert }) => {
    const cfg = await createImageConfig()
    const job = await createJob(cfg.id, {
      status: 'processing',
      completedAt: null as any,
      startedAt: DateTime.now(),
    })

    const jobDir = path.join(tmpBase, String(job.jobId))
    await mkdir(jobDir, { recursive: true })

    await cleanupService.cleanupOrphanedFiles(tmpBase)

    assert.isTrue(await dirExists(jobDir))
  })

  test('skips non-numeric directory names', async ({ assert }) => {
    const nonNumericDir = path.join(tmpBase, 'lost+found')
    await mkdir(nonNumericDir, { recursive: true })

    await cleanupService.cleanupOrphanedFiles(tmpBase)

    assert.isTrue(await dirExists(nonNumericDir))
  })

  test('handles missing submissions directory gracefully', async ({ assert }) => {
    const nonExistent = path.join(tmpdir(), `does-not-exist-${Date.now()}`)
    await assert.doesNotRejects(() => cleanupService.cleanupOrphanedFiles(nonExistent))
  })
})
