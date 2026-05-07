import type { HttpContext } from '@adonisjs/core/http'
import SystemSetting from '#models/system_setting'

const VALIDATORS: Record<string, (value: string) => boolean> = {
  scheduler_strategy: (v) => ['HRRN', 'FIFO', 'PRIORITY'].includes(v),
  max_concurrent_jobs: (v) => Number.isInteger(Number(v)) && Number(v) > 0,
}

export default class ConfigController {
  async index() {
    return SystemSetting.all()
  }

  async store({ request, response }: HttpContext) {
    const key = request.input('key')
    const value = request.input('value')
    const description = request.input('description')

    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      return response.badRequest({
        error: { code: 'MISSING_KEY', message: 'Request body must include a non-empty "key" field' },
      })
    }

    if (value === undefined || value === null) {
      return response.badRequest({
        error: { code: 'MISSING_VALUE', message: 'Request body must include a "value" field' },
      })
    }

    const trimmedKey = key.trim()
    const existing = await SystemSetting.findBy('key', trimmedKey)
    if (existing) {
      return response.conflict({
        error: { code: 'SETTING_EXISTS', message: `Config key "${trimmedKey}" already exists` },
      })
    }

    const validate = VALIDATORS[trimmedKey]
    if (validate && !validate(String(value))) {
      return response.unprocessableEntity({
        error: {
          code: 'INVALID_VALUE',
          message: `Invalid value "${value}" for setting "${trimmedKey}"`,
        },
      })
    }

    const setting = await SystemSetting.create({
      key: trimmedKey,
      value: String(value),
      description: description === undefined || description === null ? null : String(description),
    })

    response.status(201)
    return setting
  }

  async update({ params, request, response }: HttpContext) {
    const setting = await SystemSetting.findBy('key', params.key)

    if (!setting) {
      return response.notFound({
        error: { code: 'SETTING_NOT_FOUND', message: `Config key "${params.key}" not found` },
      })
    }

    const value = request.input('value')

    if (value === undefined || value === null) {
      return response.badRequest({
        error: { code: 'MISSING_VALUE', message: 'Request body must include a "value" field' },
      })
    }

    const validate = VALIDATORS[params.key]
    if (validate && !validate(String(value))) {
      return response.unprocessableEntity({
        error: {
          code: 'INVALID_VALUE',
          message: `Invalid value "${value}" for setting "${params.key}"`,
        },
      })
    }

    setting.value = String(value)
    await setting.save()

    return setting
  }
}
