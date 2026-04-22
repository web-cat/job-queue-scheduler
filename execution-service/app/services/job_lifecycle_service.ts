import db from '@adonisjs/lucid/services/db'
import { errors } from '@adonisjs/http-server'
import { DateTime } from 'luxon'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import fileService, { FileServiceError } from '#services/file_service'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
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
  payload_path?: string | null
  payload_filename?: string | null
  payload_size_bytes?: number | null
}

type JobResultPayloadFields = Pick<
  JobResult,
  'payloadPath' | 'payloadFilename' | 'payloadSizeBytes'
>

function buildPayloadMetadata(jobId: number, jobResult: JobResultPayloadFields) {
  const hasPayload = jobResult.payloadPath !== null && jobResult.payloadPath !== undefined
  return {
    has_payload: hasPayload,
    payload_filename: jobResult.payloadFilename,
    payload_size_bytes: jobResult.payloadSizeBytes,
    payload_url: hasPayload ? `${env.get('APP_URL')}/api/v1/jobs/${jobId}/payload` : null,
  }
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

  private async countJobsAhead(jobId: number): Promise<number> {
    // Compute both scores at a single NOW() so there is no timing split
    // between the reference score and the comparison scores.
    const result = (await db.rawQuery(
      `WITH my_score AS (
         SELECT (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime AS score
         FROM jobs WHERE job_id = ?
       )
       SELECT COUNT(*) AS count
       FROM jobs, my_score
       WHERE status = 'pending'
         AND job_id != ?
         AND (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime > my_score.score`,
      [jobId, jobId]
    )) as unknown as RawQueryResult<{ count: string }>

    return Number(result.rows[0]?.count ?? 0)
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

      const jobsAhead = await this.countJobsAhead(job.jobId)

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
      await fileService.cleanupSubmission(job.jobId)
      await job.delete()
      if (error instanceof FileServiceError && error.httpStatus !== undefined) {
        throw errors.E_HTTP_EXCEPTION.invoke(
          { error: { code: error.code, message: error.message } },
          error.httpStatus
        )
      }
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
          ...buildPayloadMetadata(jobId, job.result),
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
        ...buildPayloadMetadata(jobId, jobResult),
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

    await fileService.cleanupSubmission(jobId)

    return {
      found: true,
      conflict: false,
      data: { job_id: job.jobId, status: job.status },
    }
  }

  async getQueuePosition(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return { position: null, estimatedWait: null, hrrnScore: null, totalPending: null }

    const jobsAhead = await this.countJobsAhead(job.jobId)
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
          payloadPath: results.payload_path ?? null,
          payloadFilename: results.payload_filename ?? null,
          payloadSizeBytes: results.payload_size_bytes ?? null,
        },
        { client: trx }
      )

      // Atomic SQL update prevents lost increments when two jobs with the
      // same image_config_id complete concurrently.
      await trx.rawQuery(
        `UPDATE image_configs
         SET avg_runtime_seconds = CASE
               WHEN total_completed_jobs = 0 THEN ?
               ELSE (avg_runtime_seconds * total_completed_jobs + ?) / (total_completed_jobs + 1)
             END,
             total_completed_jobs = total_completed_jobs + 1,
             updated_at = NOW()
         WHERE id = ?`,
        [actualRuntime, actualRuntime, job.imageConfigId]
      )
    })

    // Attempt immediate callback delivery (Task 11). Failures are retried by the background task.
    if (job.callbackUrl) {
      const { default: callbackService } = await import('#services/callback_service')
      callbackService.deliverResult(jobId).catch((err) =>
        logger.error({ jobId, err }, 'Unhandled error in callback delivery after markCompleted')
      )
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
