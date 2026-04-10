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
