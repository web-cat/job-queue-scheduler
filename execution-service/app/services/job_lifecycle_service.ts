import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import JobResult from '#models/job_result'
import type { JobStatus } from '#models/job'

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

export class JobLifecycleService {
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

    if (filters.submission_id !== undefined) {
      query.where('submission_id', filters.submission_id)
    }
    if (filters.user_id !== undefined) {
      query.where('user_id', filters.user_id)
    }
    if (filters.status !== undefined) {
      query.where('status', filters.status)
    }
    if (filters.docker_image_tag !== undefined) {
      query.where('docker_image_tag', filters.docker_image_tag)
    }

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

    return {
      found: true,
      conflict: false,
      data: { job_id: job.jobId, status: job.status },
    }
  }

  async getQueuePosition(jobId: number) {
    const job = await Job.find(jobId)
    if (!job) return { position: null, estimatedWait: null }

    // HRRN score: (wait_time + estimated_runtime) / estimated_runtime
    const hrrnResult = (await db.rawQuery(
      `SELECT (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime AS hrrn_score
       FROM jobs WHERE job_id = ?`,
      [jobId]
    )) as unknown as RawQueryResult<{ hrrn_score: number }>

    const myScore = hrrnResult.rows[0]?.hrrn_score ?? 0

    // Count pending jobs with higher HRRN score (they are ahead in queue)
    const higherCountResult = (await db.rawQuery(
      `SELECT COUNT(*) as count FROM jobs
       WHERE status = 'pending'
         AND job_id != ?
         AND (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime > ?`,
      [jobId, myScore]
    )) as unknown as RawQueryResult<{ count: string }>

    const position = Number(higherCountResult.rows[0]?.count ?? 0) + 1

    // Estimated wait = position × avg recent execution time
    const avgResult = (await db.rawQuery(
      `SELECT AVG(actual_runtime) as avg_runtime FROM jobs
       WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour'`
    )) as unknown as RawQueryResult<{ avg_runtime: number | null }>

    const avgSeconds = avgResult.rows[0]?.avg_runtime ?? job.estimatedRuntime
    const estimatedWait = position * Number(avgSeconds)

    return { position, estimatedWait }
  }
}

export default new JobLifecycleService()
