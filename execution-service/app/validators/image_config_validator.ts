import vine from '@vinejs/vine'

const intInRange = (min: number, max: number) => vine.number().min(min).max(max)

/**
 * POST /api/v1/images — all required fields per task spec; optional with defaults applied in controller.
 */
export const createImageConfigValidator = vine.compile(
  vine.object({
    docker_image_tag: vine.string().trim().maxLength(255),
    display_name: vine.string().trim().maxLength(255).optional(),
    timeout_seconds: intInRange(5, 600),
    memory_limit_mb: intInRange(64, 4096),
    cpu_limit_millicores: intInRange(100, 4000),
    max_retries: intInRange(0, 10).optional(),
    default_priority: intInRange(1, 10).optional(),
    default_estimated_runtime: vine.number().min(1.0),
  })
)

/**
 * PUT /api/v1/images/:id — every field optional; partial updates.
 */
export const updateImageConfigValidator = vine.compile(
  vine.object({
    docker_image_tag: vine.string().trim().maxLength(255).optional(),
    display_name: vine.string().trim().maxLength(255).optional().nullable(),
    timeout_seconds: intInRange(5, 600).optional(),
    memory_limit_mb: intInRange(64, 4096).optional(),
    cpu_limit_millicores: intInRange(100, 4000).optional(),
    max_retries: intInRange(0, 10).optional(),
    default_priority: intInRange(1, 10).optional(),
    default_estimated_runtime: vine.number().min(1.0).optional(),
    is_active: vine.boolean().optional(),
  })
)
