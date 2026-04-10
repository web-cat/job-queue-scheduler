import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import SystemSetting from '#models/system_setting'

export default class HealthController {
  async check({ response }: HttpContext) {
    try {
      await db.rawQuery('SELECT 1')
      const schedulerSetting = await SystemSetting.findBy('key', 'scheduler_strategy')

      return response.ok({
        status: 'ok',
        database: 'connected',
        scheduler_strategy: schedulerSetting?.value ?? null,
      })
    } catch {
      return response.serviceUnavailable({
        status: 'error',
        database: 'unreachable',
      })
    }
  }
}
