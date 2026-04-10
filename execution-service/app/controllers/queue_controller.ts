import type { HttpContext } from '@adonisjs/core/http'
import queueService from '#services/queue_service'

export default class QueueController {
  async status({ response }: HttpContext) {
    const data = await queueService.getQueueStatus()
    return response.ok(data)
  }

  async position({ params, response }: HttpContext) {
    const jobId = Number(params.id)
    const result = await queueService.getQueuePosition(jobId)

    if ('notFound' in result) {
      return response.notFound({
        error: { code: 'JOB_NOT_FOUND', message: `Job with ID ${jobId} not found` },
      })
    }

    if ('notPending' in result) {
      return response.conflict({
        error: {
          code: 'JOB_NOT_PENDING',
          message: `Job ${jobId} is not pending (current status: ${result.status})`,
        },
      })
    }

    return response.ok(result)
  }
}
