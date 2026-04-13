import db from '@adonisjs/lucid/services/db'
import { errors } from '@adonisjs/http-server'
import { DateTime } from 'luxon'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import fileService from '#services/file_service'
import logger from '@adonisjs/core/services/logger'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import type { JobStatus } from '#models/job'

type MarkCompletedResults = {
  correctness_score?: number | null
  tool_score?: number | null
  comments?: string | null
  comment_format?: number | null
  test_output?: string | null
  container_logs?: string | null
  exit_code?: number | null
  cpu_usage?: number | null
  ram_usage?: number | null
  runtime_ms?: number | null
  pod_name?: string | null
  node_ip?: string | null
}

type SubmitJobPayload = {
  docker_image_tag: string
  submission_id: number
  callback_url?: string
  user_id?: number
  course_id?: number
  assignment_name?: string
  priority?: number
  files: MultipartFile[]
}

interface ListFilters {
  submission_id?: number
  user_id?: number
  status?: JobStatus
  docker_image_tag?: string
}

interface Pagination {
  limit: number
  offset: number
}

interface RawQueryResult<T> {
  rows: T[]
}

class JobLifecycleService {
  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getHrrnScore(job: Pick<Job, 'submittedAt' | 'estimatedRuntime'>): number {
    const ageSeconds = Math.max(0, (Date.now() - job.submittedAt.toJSDate().getTime()) / 1000)
    const runtime =
      Number.isFinite(job.estimatedRuntime) && job.estimatedRuntime > 0 ? job.estimatedRuntime : 1
    return (ageSeconds + runtime) / runtime
  }

  private async countJobsAhead(job: Job): Promise<number> {
    const currentScore = this.getHrrnScore(job)
    const query = await db
      .from('jobs')
      .where('status', 'pending')
      .whereNot('job_id', job.jobId)
      .where('estimated_runtime', '>', 0)
      .whereRaw(
        '((EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime) > ?',
        [currentScore]
      )
      .count('* as total')
      .first()

    return Number(query?.total || 0)
  }

  // ---------------------------------------------------------------------------
  // Task 3: Job submission
  // ---------------------------------------------------------------------------

  async submitJob(payload: SubmitJobPayload) {
    const imageConfig = await ImageConfig.query()
      .where('docker_image_tag', payload.docker_image_tag)
      .first()

    if (!imageConfig) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        {
          error: {
            code: 'IMAGE_CONFIG_NOT_FOUND',
            message: `Docker image tag ${payload.docker_image_tag} is not configured`,
          },
        },
        404
      )
    }

    if (!imageConfig.isActive) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        {
          error: {
            code: 'IMAGE_CONFIG_INACTIVE',
            message: `Docker image tag ${payload.docker_image_tag} is currently inactive`,
          },
        },
        409
      )
    }

    const estimatedRuntime = imageConfig.avgRuntimeSeconds ?? imageConfig.defaultEstimatedRuntime
    if (!Number.isFinite(estimatedRuntime) || estimatedRuntime <= 0) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        {
          error: {
            code: 'IMAGE_CONFIG_INVALID_RUNTIME',
            message: `Docker image tag ${payload.docker_image_tag} has invalid estimated runtime`,
          },
        },
        500
      )
    }

    // Create first so the DB allocates job_id without relying on hardcoded sequence names.
    const job = await Job.create({
      submissionId: payload.submission_id,
      dockerImageTag: payload.docker_image_tag,
      status: 'pending',
      priority: payload.priority ?? imageConfig.defaultPriority,
      sourcePath: 'PENDING_UPLOAD',
      callbackUrl: payload.callback_url ?? null,
      resultDelivered: false,
      estimatedRuntime,
      imageConfigId: imageConfig.id,
      userId: payload.user_id ?? null,
      courseId: payload.course_id ?? null,
      assignmentName: payload.assignment_name ?? null,
    })

    try {
      const sourcePath = await fileService.storeSubmissionFiles(job.jobId, payload.files)
      job.sourcePath = sourcePath
      await job.save()

      const persistedJob = await Job.findOrFail(job.jobId)
      const jobsAhead = await this.countJobsAhead(persistedJob)

      return {
        job_id: Number(job.jobId),
        submission_id: job.submissionId,
        status: job.status,
        docker_image_tag: job.dockerImageTag,
        estimated_runtime: job.estimatedRuntime,
        queue_position: jobsAhead + 1,
        submitted_at: job.submittedAt,
      }
    } catch (error) {
      await fileService.cleanupSubmissionDirectory(job.jobId)
      await job.delete()
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // Task 4: Job status & results
  // ---------------------------------------------------------------------------

  async getJob(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return null

    const result: Record<string, unknown> = {
      job_id: job.jobId,
      submission_id: job.submissionId,
      status: job.status,
      docker_image_tag: job.dockerImageTag,
      priority: job.priority,
      estimated_runtime: job.estimatedRuntime,
      actual_runtime: job.actualRuntime,
      submitted_at: job.submittedAt,
      started_at: job.startedAt,
      completed_at: job.completedAt,
      retry_count: job.retryCount,
      queue_position: null,
      estimated_wait_seconds: null,
      result: null,
    }

    if (job.status === 'completed') {
      await job.load('result')
      if (job.result) {
        result.result = {
          correctness_score: job.result.correctnessScore,
          tool_score: job.result.toolScore,
          comments: job.result.comments,
          comment_format: job.result.commentFormat,
          test_output: job.result.testOutput,
          exit_code: job.result.exitCode,
          runtime_ms: job.result.runtimeMs,
        }
      }
    }

    if (job.status === 'pending') {
      const { position, estimatedWait } = await this.getQueuePosition(jobId)
      result.queue_position = position
      result.estimated_wait_seconds = estimatedWait
    }

    return result
  }

  async getJobResults(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return { found: false, status: null, data: null }

    if (job.status !== 'completed') {
      return { found: true, status: job.status, data: null }
    }

    const jobResult = await JobResult.findBy('job_id', jobId)
    if (!jobResult) return { found: true, status: job.status, data: null }

    return {
      found: true,
      status: job.status,
      data: {
        job_id: jobId,
        correctness_score: jobResult.correctnessScore,
        tool_score: jobResult.toolScore,
        comments: jobResult.comments,
        comment_format: jobResult.commentFormat,
        test_output: jobResult.testOutput,
        exit_code: jobResult.exitCode,
        runtime_ms: jobResult.runtimeMs,
      },
    }
  }

  async listJobs(filters: ListFilters, pagination: Pagination) {
    const query = Job.query().orderBy('submitted_at', 'desc')

    if (filters.submission_id !== undefined) query.where('submission_id', filters.submission_id)
    if (filters.user_id !== undefined) query.where('user_id', filters.user_id)
    if (filters.status !== undefined) query.where('status', filters.status)
    if (filters.docker_image_tag !== undefined) query.where('docker_image_tag', filters.docker_image_tag)

    const countResult = await query.clone().clearOrder().count('* as total')
    const totalCount = Number(countResult[0].$extras.total)

    const jobs = await query.offset(pagination.offset).limit(pagination.limit)

    return {
      total: totalCount,
      limit: pagination.limit,
      offset: pagination.offset,
      jobs: jobs.map((job) => ({
        job_id: job.jobId,
        submission_id: job.submissionId,
        status: job.status,
        docker_image_tag: job.dockerImageTag,
        priority: job.priority,
        submitted_at: job.submittedAt,
        completed_at: job.completedAt,
        actual_runtime: job.actualRuntime,
      })),
    }
  }

  async cancelJob(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return { found: false, conflict: false, data: null }

    if (job.status !== 'pending') {
      return { found: true, conflict: true, data: null }
    }

    job.status = 'cancelled'
    await job.save()

    await fileService.cleanupSubmissionDirectory(jobId)

    return {
      found: true,
      conflict: false,
      data: { job_id: job.jobId, status: job.status },
    }
  }

  async getQueuePosition(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return { position: null, estimatedWait: null, hrrnScore: null, totalPending: null }

    const jobsAhead = await this.countJobsAhead(job)
    const position = jobsAhead + 1

    const avgResult = (await db.rawQuery(
      `SELECT AVG(actual_runtime) as avg_runtime FROM jobs
       WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour'`
    )) as unknown as RawQueryResult<{ avg_runtime: number | null }>

    const avgSeconds = avgResult.rows[0]?.avg_runtime ?? job.estimatedRuntime
    const estimatedWait = position * Number(avgSeconds)

    const totalResult = (await db.rawQuery(
      `SELECT COUNT(*) as total FROM jobs WHERE status = 'pending'`
    )) as unknown as RawQueryResult<{ total: string }>
    const totalPending = Number(totalResult.rows[0]?.total ?? 0)

    const hrrnScore = this.getHrrnScore(job)

    return { position, estimatedWait, hrrnScore, totalPending }
  }

  // ---------------------------------------------------------------------------
  // Task 9: Job lifecycle state transitions
  // ---------------------------------------------------------------------------

  async markProcessing(jobId: number, workerPodName: string) {
    const job = await Job.find(jobId)
    if (!job) return null

    job.status = 'processing'
    job.startedAt = DateTime.now()
    job.workerPodName = workerPodName
    await job.save()

    return job
  }

  async markCompleted(jobId: number, results: MarkCompletedResults, actualRuntime: number) {
    const job = await Job.find(jobId)

    if (!job) {
      logger.warn({ jobId }, 'markCompleted called on non-existent job')
      return null
    }

    if (job.status !== 'processing') {
      logger.warn({ jobId, status: job.status }, 'markCompleted called on job not in processing status — skipping')
      return null
    }

    await db.transaction(async (trx) => {
      job.useTransaction(trx)
      job.status = 'completed'
      job.completedAt = DateTime.now()
      job.actualRuntime = actualRuntime
      await job.save()

      await JobResult.create(
        {
          jobId,
          correctnessScore: results.correctness_score ?? null,
          toolScore: results.tool_score ?? null,
          comments: results.comments ?? null,
          commentFormat: results.comment_format ?? null,
          testOutput: results.test_output ?? null,
          containerLogs: results.container_logs ?? null,
          exitCode: results.exit_code ?? null,
          cpuUsage: results.cpu_usage ?? null,
          ramUsage: results.ram_usage ?? null,
          runtimeMs: results.runtime_ms ?? null,
          podName: results.pod_name ?? null,
          nodeIp: results.node_ip ?? null,
        },
        { client: trx }
      )

      const imageConfig = await ImageConfig.find(job.imageConfigId)
      if (imageConfig) {
        imageConfig.useTransaction(trx)
        const total = imageConfig.totalCompletedJobs
        const currentAvg = imageConfig.avgRuntimeSeconds ?? 0
        imageConfig.avgRuntimeSeconds = (currentAvg * total + actualRuntime) / (total + 1)
        imageConfig.totalCompletedJobs = total + 1
        await imageConfig.save()
      }
    })

    // Task 11 (callback service) will hook in here when implemented
    if (job.callbackUrl) {
      logger.info({ jobId, callbackUrl: job.callbackUrl }, 'Job completed with callback_url — callback delivery pending Task 11')
    }

    return job
  }

  async markFailed(jobId: number, errorMessage: string) {
    const job = await Job.find(jobId)

    if (!job) {
      logger.warn({ jobId }, 'markFailed called on non-existent job')
      return null
    }

    if (job.status === 'completed') {
      logger.warn({ jobId }, 'markFailed called on already-completed job — skipping')
      return null
    }

    await job.load('imageConfig')
    const maxRetries = job.imageConfig?.maxRetries ?? 0

    if (job.retryCount < maxRetries) {
      job.retryCount += 1
      job.status = 'pending'
      job.workerPodName = null
      job.startedAt = null
      await job.save()
      logger.info({ jobId, retryCount: job.retryCount, maxRetries }, `Job ${jobId} failed, retrying (attempt ${job.retryCount}/${maxRetries}): ${errorMessage}`)
    } else {
      job.status = 'failed'
      job.errorMessage = errorMessage
      job.completedAt = DateTime.now()
      await job.save()
      logger.error({ jobId, maxRetries }, `Job ${jobId} permanently failed after ${maxRetries} retries: ${errorMessage}`)
    }

    return job
  }
}

export default new JobLifecycleService()
