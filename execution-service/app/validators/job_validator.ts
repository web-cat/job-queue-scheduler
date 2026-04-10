import vine from '@vinejs/vine'

export const listJobsValidator = vine.compile(
  vine.object({
    submission_id: vine.number().optional(),
    user_id: vine.number().optional(),
    status: vine
      .enum(['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'])
      .optional(),
    docker_image_tag: vine.string().optional(),
    limit: vine.number().min(1).max(100).optional(),
    offset: vine.number().min(0).optional(),
  })
)
