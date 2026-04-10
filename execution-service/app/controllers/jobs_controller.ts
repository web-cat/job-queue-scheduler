import type { HttpContext } from '@adonisjs/core/http'
import jobLifecycleService from '#services/job_lifecycle_service'
import { listJobsValidator } from '#validators/job_validator'

export default class JobsController {
  async show({ params, response }: HttpContext) {
    const job = await jobLifecycleService.getJob(Number(params.id))
    if (!job) {
      return response.notFound({ error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` } })
    }
    return job
  }

  async results({ params, response }: HttpContext) {
    const result = await jobLifecycleService.getJobResults(Number(params.id))

    if (!result.found) {
      return response.notFound({ error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` } })
    }

    if (!result.data) {
      return response.accepted({ status: result.status })
    }

    return result.data
  }

  async index({ request }: HttpContext) {
    const payload = await request.validateUsing(listJobsValidator)

    const filters = {
      submission_id: payload.submission_id,
      user_id: payload.user_id,
      status: payload.status as Parameters<typeof jobLifecycleService.listJobs>[0]['status'],
      docker_image_tag: payload.docker_image_tag,
    }

    const pagination = {
      limit: payload.limit ?? 20,
      offset: payload.offset ?? 0,
    }

    return jobLifecycleService.listJobs(filters, pagination)
  }

  async destroy({ params, response }: HttpContext) {
    const result = await jobLifecycleService.cancelJob(Number(params.id))

    if (!result.found) {
      return response.notFound({ error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` } })
    }

    if (result.conflict) {
      return response.conflict({ error: { code: 'JOB_NOT_CANCELLABLE', message: 'Only pending jobs can be cancelled' } })
    }

    return result.data
  }
}
