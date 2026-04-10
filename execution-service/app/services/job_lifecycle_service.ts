import db from '@adonisjs/lucid/services/db'
import { errors } from '@adonisjs/http-server'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import fileService from '#services/file_service'
import type { MultipartFile } from '@adonisjs/core/bodyparser'

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

class JobLifecycleService {
  private async reserveJobId(): Promise<number> {
    const result = (await db.rawQuery("SELECT nextval('jobs_job_id_seq') AS job_id")) as {
      rows: Array<{ job_id: string }>
    }
    const jobId = Number(result.rows[0]?.job_id)

    if (!jobId) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        { error: { code: 'JOB_ID_RESERVATION_FAILED', message: 'Unable to reserve a job id' } },
        500
      )
    }

    return jobId
  }

  private async getQueuePosition(job: Job): Promise<number> {
    const currentScore = await this.getJobHrrnScore(job)
    const query = await db
      .from('jobs')
      .where('status', 'pending')
      .whereNot('job_id', job.jobId)
      .whereRaw(
        '((EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime) > ?',
        [currentScore]
      )
      .count('* as total')
      .first()

    return Number(query?.total || 0) + 1
  }

  private async getJobHrrnScore(job: Pick<Job, 'submittedAt' | 'estimatedRuntime'>): Promise<number> {
    const ageSeconds = Math.max(0, (Date.now() - job.submittedAt.toJSDate().getTime()) / 1000)
    return (ageSeconds + job.estimatedRuntime) / job.estimatedRuntime
  }

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

    const reservedJobId = await this.reserveJobId()
    const sourcePath = await fileService.storeSubmissionFiles(reservedJobId, payload.files)
    const estimatedRuntime = imageConfig.avgRuntimeSeconds ?? imageConfig.defaultEstimatedRuntime

    const job = await Job.create({
      jobId: reservedJobId,
      submissionId: payload.submission_id,
      dockerImageTag: payload.docker_image_tag,
      status: 'pending',
      priority: payload.priority ?? imageConfig.defaultPriority,
      sourcePath,
      callbackUrl: payload.callback_url ?? null,
      resultDelivered: false,
      estimatedRuntime,
      imageConfigId: imageConfig.id,
      userId: payload.user_id ?? null,
      courseId: payload.course_id ?? null,
      assignmentName: payload.assignment_name ?? null,
    })

    const persistedJob = await Job.findOrFail(job.jobId)
    const queuePosition = await this.getQueuePosition(persistedJob)

    return {
      job_id: Number(job.jobId),
      submission_id: job.submissionId,
      status: job.status,
      docker_image_tag: job.dockerImageTag,
      estimated_runtime: job.estimatedRuntime,
      queue_position: queuePosition,
      submitted_at: job.submittedAt,
    }
  }
}

const jobLifecycleService = new JobLifecycleService()
export default jobLifecycleService
