import type { HttpContext } from '@adonisjs/core/http'
import imageConfigService, { serializeImageConfig } from '#services/image_config_service'
import {
  createImageConfigValidator,
  updateImageConfigValidator,
} from '#validators/image_config_validator'

function parseImageId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null
  const n = Number.parseInt(raw, 10)
  return Number.isSafeInteger(n) ? n : null
}

function notFound(ctx: HttpContext) {
  return ctx.response.status(404).send({
    error: { code: 'E_IMAGE_CONFIG_NOT_FOUND', message: 'Image config not found' },
  })
}

function conflictTag(ctx: HttpContext) {
  return ctx.response.status(409).send({
    error: { code: 'E_DOCKER_IMAGE_TAG_EXISTS', message: 'docker_image_tag already exists' },
  })
}

export default class ImagesController {
  async index({ serialize }: HttpContext) {
    return serialize(await imageConfigService.list())
  }

  async store(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(createImageConfigValidator)

    const existing = await imageConfigService.findByTag(payload.docker_image_tag)
    if (existing) return conflictTag(ctx)

    const row = await imageConfigService.create(payload)
    ctx.response.status(201)
    return ctx.serialize(serializeImageConfig(row))
  }

  async show(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) return notFound(ctx)

    const row = await imageConfigService.findById(id)
    if (!row) return notFound(ctx)

    return ctx.serialize(serializeImageConfig(row))
  }

  async update(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) return notFound(ctx)

    const row = await imageConfigService.findById(id)
    if (!row) return notFound(ctx)

    const payload = await ctx.request.validateUsing(updateImageConfigValidator)

    if (payload.docker_image_tag !== undefined) {
      const conflict = await imageConfigService.findByTag(payload.docker_image_tag)
      if (conflict && conflict.id !== id) return conflictTag(ctx)
    }

    const updated = await imageConfigService.update(row, payload)
    return ctx.serialize(serializeImageConfig(updated))
  }

  async destroy(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) return notFound(ctx)

    const row = await imageConfigService.findById(id)
    if (!row) return notFound(ctx)

    const updated = await imageConfigService.softDelete(row)
    return ctx.serialize(serializeImageConfig(updated))
  }

  async stats(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) return notFound(ctx)

    const config = await imageConfigService.findById(id)
    if (!config) return notFound(ctx)

    return ctx.serialize(await imageConfigService.getStats(id, config))
  }
}
