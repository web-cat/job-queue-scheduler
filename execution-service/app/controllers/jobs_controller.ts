import type { HttpContext } from '@adonisjs/core/http'
import { errors } from '@adonisjs/http-server'
import { createJobValidator } from '#validators/job_validator'
import jobLifecycleService from '#services/job_lifecycle_service'

export default class JobsController {
  async store({ request, response, serialize }: HttpContext) {
    const files = request.files('files', { size: '50mb' })
    const dockerImageTag = request.input('docker_image_tag')
    const submissionId = request.input('submission_id')

    if (!dockerImageTag || submissionId === undefined || submissionId === null) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        {
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'docker_image_tag and submission_id are required',
          },
        },
        400
      )
    }

    if (!files.length) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        { error: { code: 'FILES_REQUIRED', message: 'At least one file must be uploaded' } },
        400
      )
    }

    const payload = await request.validateUsing(createJobValidator)
    const result = await jobLifecycleService.submitJob({ ...payload, files })

    response.status(201)
    return serialize(result)
  }
}
