import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { errors } from '@adonisjs/http-server'
import logger from '@adonisjs/core/services/logger'
import Job from '#models/job'
import JobResult from '#models/job_result'
import fileService from '#services/file_service'
import jobLifecycleService from '#services/job_lifecycle_service'
import { createJobValidator, listJobsValidator } from '#validators/job_validator'

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

  async show({ params, response }: HttpContext) {
    const job = await jobLifecycleService.getJob(Number(params.id))
    if (!job) {
      return response.notFound({
        error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` },
      })
    }
    return job
  }

  async results({ params, response }: HttpContext) {
    const result = await jobLifecycleService.getJobResults(Number(params.id))

    if (!result.found) {
      return response.notFound({
        error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` },
      })
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

  async payload({ params, response }: HttpContext) {
    const jobId = Number(params.id)
    const job = await Job.find(jobId)

    if (!job) {
      return response.notFound({
        error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` },
      })
    }

    if (job.status !== 'completed') {
      return response.accepted({ status: job.status })
    }

    const jobResult = await JobResult.findBy('job_id', jobId)
    if (!jobResult || !jobResult.payloadPath) {
      return response.notFound({
        error: { code: 'NO_PAYLOAD', message: 'No payload file for this job' },
      })
    }

    // Defense-in-depth: resolve both the stored path and the expected payload directory
    // and require the stored path to live strictly inside it (not equal to the directory
    // itself). Guards against DB tampering or unexpected writes producing an arbitrary
    // file read via this endpoint.
    const expectedDir = path.resolve(fileService.getPayloadDirectory(jobId))
    const resolvedPath = path.resolve(jobResult.payloadPath)
    if (!resolvedPath.startsWith(expectedDir + path.sep)) {
      logger.error(
        { jobId, payloadPath: jobResult.payloadPath, expectedDir },
        'Payload path is outside expected directory — refusing to serve'
      )
      return response.notFound({
        error: { code: 'NO_PAYLOAD', message: 'No payload file for this job' },
      })
    }

    // Use fs.stat to discover size at request time rather than trusting the DB,
    // and confirm the target is a regular file — refuse directories, symlinks, etc.
    // The stream below also attaches an error handler so a cleanup race between the
    // stat and the open still surfaces as ENOENT mid-stream.
    let currentSize: number
    try {
      const st = await stat(resolvedPath)
      if (!st.isFile()) {
        logger.error(
          { jobId, payloadPath: resolvedPath },
          'Payload path is not a regular file — refusing to serve'
        )
        return response.notFound({
          error: { code: 'NO_PAYLOAD', message: 'No payload file for this job' },
        })
      }
      currentSize = st.size
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return response.notFound({
          error: { code: 'PAYLOAD_DELETED', message: 'Payload file has been cleaned up' },
        })
      }
      throw err
    }

    const rawFilename = jobResult.payloadFilename ?? 'payload'
    // Restrict to a conservative allowlist to prevent header injection and odd client
    // behavior from control chars / path separators. path.basename strips any directory
    // components that slipped through (defense-in-depth: the filename is already just
    // a basename from extractPayloadFile, but this is a security boundary).
    const safeFilename = path.basename(rawFilename).replace(/[^A-Za-z0-9._ -]/g, '') || 'payload'
    response.header('Content-Type', 'application/octet-stream')
    response.header('Content-Disposition', `attachment; filename="${safeFilename}"`)
    response.header('Content-Length', String(currentSize))

    const stream = createReadStream(resolvedPath)
    stream.on('error', (err: any) => {
      if (err?.code === 'ENOENT') {
        logger.warn({ jobId, payloadPath: resolvedPath }, 'Payload vanished mid-stream')
      } else {
        logger.error({ jobId, err }, 'Error while streaming payload')
      }
    })
    return response.stream(stream)
  }

  async destroy({ params, response }: HttpContext) {
    const result = await jobLifecycleService.cancelJob(Number(params.id))

    if (!result.found) {
      return response.notFound({
        error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${params.id} not found` },
      })
    }

    if (result.conflict) {
      return response.conflict({
        error: { code: 'JOB_NOT_CANCELLABLE', message: 'Only pending jobs can be cancelled' },
      })
    }

    return result.data
  }
}
