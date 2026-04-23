import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import type { JobStatus } from '#models/job'

/**
 * Shared test fixtures for Task 15 functional suites.
 *
 * Every created row uses a tag / submission_id namespace (`TEST_TAG_PREFIX`
 * / `TEST_SUBMISSION_MIN`) so cleanDatabase() can wipe only rows introduced
 * by tests and leave unrelated data alone. Tests that don't care about
 * isolation from other suites can also call `cleanAll()` for a hard reset.
 */
export const TEST_TAG_PREFIX = 'test-utils/'
export const TEST_SUBMISSION_MIN = 950_000

interface ImageConfigOverrides {
  dockerImageTag?: string
  displayName?: string | null
  timeoutSeconds?: number
  memoryLimitMb?: number
  cpuLimitMillicores?: number
  maxRetries?: number
  defaultPriority?: number
  defaultEstimatedRuntime?: number
  isActive?: boolean
  totalCompletedJobs?: number
  avgRuntimeSeconds?: number | null
}

interface JobOverrides {
  submissionId?: number
  dockerImageTag?: string
  imageConfigId?: number
  status?: JobStatus
  priority?: number
  sourcePath?: string
  callbackUrl?: string | null
  resultDelivered?: boolean
  submittedAt?: DateTime
  startedAt?: DateTime | null
  completedAt?: DateTime | null
  estimatedRuntime?: number
  actualRuntime?: number | null
  workerPodName?: string | null
  retryCount?: number
  errorMessage?: string | null
  userId?: number | null
  courseId?: number | null
  assignmentName?: string | null
}

let submissionCounter = TEST_SUBMISSION_MIN

function nextSubmissionId(): number {
  submissionCounter += 1
  return submissionCounter
}

/**
 * Create an ImageConfig row with sensible defaults for grading tests.
 * Any field can be overridden; `dockerImageTag` defaults to a
 * prefixed unique tag so tests can coexist.
 */
export async function createTestImageConfig(overrides: ImageConfigOverrides = {}) {
  const dockerImageTag =
    overrides.dockerImageTag ??
    `${TEST_TAG_PREFIX}grader-${Math.random().toString(36).slice(2, 10)}`

  return ImageConfig.create({
    dockerImageTag,
    displayName: overrides.displayName ?? 'Test Grader',
    timeoutSeconds: overrides.timeoutSeconds ?? 30,
    memoryLimitMb: overrides.memoryLimitMb ?? 512,
    cpuLimitMillicores: overrides.cpuLimitMillicores ?? 1000,
    maxRetries: overrides.maxRetries ?? 0,
    defaultPriority: overrides.defaultPriority ?? 5,
    defaultEstimatedRuntime: overrides.defaultEstimatedRuntime ?? 15,
    isActive: overrides.isActive ?? true,
    totalCompletedJobs: overrides.totalCompletedJobs ?? 0,
    avgRuntimeSeconds: overrides.avgRuntimeSeconds ?? null,
  })
}

/**
 * Create a Job row, auto-creating an ImageConfig when none is supplied.
 * Returns the saved Job model; the caller can `await job.load('imageConfig')`.
 */
export async function createTestJob(overrides: JobOverrides = {}): Promise<Job> {
  let imageConfigId = overrides.imageConfigId
  let dockerImageTag = overrides.dockerImageTag

  if (imageConfigId === undefined) {
    const config = await createTestImageConfig(dockerImageTag ? { dockerImageTag } : {})
    imageConfigId = config.id
    dockerImageTag = dockerImageTag ?? config.dockerImageTag
  } else if (!dockerImageTag) {
    const existing = await ImageConfig.findOrFail(imageConfigId)
    dockerImageTag = existing.dockerImageTag
  }

  return Job.create({
    submissionId: overrides.submissionId ?? nextSubmissionId(),
    dockerImageTag: dockerImageTag!,
    imageConfigId: imageConfigId!,
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 5,
    sourcePath: overrides.sourcePath ?? '/tmp/test-utils',
    callbackUrl: overrides.callbackUrl ?? null,
    resultDelivered: overrides.resultDelivered ?? false,
    submittedAt: overrides.submittedAt ?? DateTime.now(),
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    estimatedRuntime: overrides.estimatedRuntime ?? 15,
    actualRuntime: overrides.actualRuntime ?? null,
    workerPodName: overrides.workerPodName ?? null,
    retryCount: overrides.retryCount ?? 0,
    errorMessage: overrides.errorMessage ?? null,
    userId: overrides.userId ?? null,
    courseId: overrides.courseId ?? null,
    assignmentName: overrides.assignmentName ?? null,
  })
}

/**
 * Remove all rows touched by test utilities: jobs with submission_id in the
 * test namespace, image_configs whose tag starts with the test prefix, and
 * the job_results / callback_log rows that belong to those jobs (FK cascade
 * handles most of it, but we delete children explicitly first to be safe
 * on non-cascading schemas).
 */
export async function cleanDatabase(): Promise<void> {
  await db.from('callback_log').delete()
  await db.from('job_results').delete()
  await db.from('jobs').delete()
  await db.from('image_configs').where('docker_image_tag', 'like', `${TEST_TAG_PREFIX}%`).delete()
}

/**
 * Seed a small, deterministic data set used by tests that want to verify
 * filtering/aggregation against a known population.
 *
 * Creates:
 *   - 1 image config (tag = `${TEST_TAG_PREFIX}seed-grader`)
 *   - 3 pending jobs, 1 processing, 1 completed (with matching JobResult)
 *
 * Returns the created image config plus the job ids so tests can assert.
 */
export async function seedTestData() {
  await cleanDatabase()

  const cfg = await createTestImageConfig({
    dockerImageTag: `${TEST_TAG_PREFIX}seed-grader`,
    defaultEstimatedRuntime: 10,
    maxRetries: 2,
  })

  const now = DateTime.now()

  const pendings = await Promise.all([
    createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'pending',
      submittedAt: now.minus({ minutes: 10 }),
      estimatedRuntime: 10,
      userId: 1,
    }),
    createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'pending',
      submittedAt: now.minus({ minutes: 5 }),
      estimatedRuntime: 10,
      userId: 1,
    }),
    createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      status: 'pending',
      submittedAt: now.minus({ minutes: 2 }),
      estimatedRuntime: 10,
      userId: 2,
    }),
  ])

  const processing = await createTestJob({
    imageConfigId: cfg.id,
    dockerImageTag: cfg.dockerImageTag,
    status: 'processing',
    submittedAt: now.minus({ minutes: 8 }),
    startedAt: now.minus({ minutes: 1 }),
    workerPodName: 'seed-worker-1',
    estimatedRuntime: 10,
    userId: 2,
  })

  const completed = await createTestJob({
    imageConfigId: cfg.id,
    dockerImageTag: cfg.dockerImageTag,
    status: 'completed',
    submittedAt: now.minus({ minutes: 15 }),
    startedAt: now.minus({ minutes: 14 }),
    completedAt: now.minus({ minutes: 13 }),
    actualRuntime: 45,
    estimatedRuntime: 10,
    userId: 1,
  })

  await JobResult.create({
    jobId: completed.jobId,
    correctnessScore: 85,
    toolScore: 90,
    comments: 'Seed result',
    commentFormat: 0,
    testOutput: 'seed tests passed',
    exitCode: 0,
    runtimeMs: 45000,
  })

  return {
    imageConfig: cfg,
    pendingIds: pendings.map((j) => j.jobId),
    processingId: processing.jobId,
    completedId: completed.jobId,
  }
}
