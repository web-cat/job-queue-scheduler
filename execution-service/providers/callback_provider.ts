import type { ApplicationService } from '@adonisjs/core/types'
import SystemSetting from '#models/system_setting'
import logger from '@adonisjs/core/services/logger'

async function getSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const setting = await SystemSetting.findBy('key', key)
    if (setting) {
      const parsed = Number(setting.value)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  } catch {
    // DB may not be available yet — fall back to default
  }
  return defaultValue
}

export default class CallbackProvider {
  private intervals: ReturnType<typeof setInterval>[] = []

  constructor(protected app: ApplicationService) {}

  async start() {
    if (this.app.getEnvironment() === 'test') return

    const { default: callbackService } = await import('#services/callback_service')

    const callbackRetrySeconds = await getSetting('callback_retry_delay_seconds', 5)

    logger.info({ callbackRetrySeconds }, 'Starting callback retry background task')

    this.intervals.push(
      setInterval(
        () =>
          callbackService
            .retryPendingCallbacks()
            .catch((err) => logger.error({ err }, 'Unhandled error in retryPendingCallbacks')),
        callbackRetrySeconds * 1000
      )
    )
  }

  async shutdown() {
    for (const interval of this.intervals) {
      clearInterval(interval)
    }
    this.intervals = []
  }
}
