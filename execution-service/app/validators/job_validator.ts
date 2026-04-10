import vine from '@vinejs/vine'

export const createJobValidator = vine.compile(
  vine.object({
    docker_image_tag: vine.string().trim().maxLength(255),
    submission_id: vine.number(),
    callback_url: vine.string().trim().url().maxLength(500).optional(),
    user_id: vine.number().optional(),
    course_id: vine.number().optional(),
    assignment_name: vine.string().trim().maxLength(255).optional(),
    priority: vine.number().min(1).max(10).optional(),
  })
)

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
