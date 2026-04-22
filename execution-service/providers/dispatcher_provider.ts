import type { ApplicationService } from '@adonisjs/core/types'
import logger from '@adonisjs/core/services/logger'

/**
 * Starts the dispatcher loop when `ENABLE_DISPATCHER=true`. Skipped in
 * `NODE_ENV=test` so the test runner can drive the dispatcher directly.
 */
export default class DispatcherProvider {
  private dispatcher: { stop(): Promise<void> } | null = null

  constructor(protected app: ApplicationService) {}

  async start() {
    if (this.app.getEnvironment() === 'test') return

    if (process.env.ENABLE_DISPATCHER !== 'true') {
      logger.info('Dispatcher not started (set ENABLE_DISPATCHER=true to enable)')
      return
    }

    const { default: dispatcherService } = await import('#services/dispatcher_service')
    await dispatcherService.start()
    this.dispatcher = dispatcherService
  }

  async shutdown() {
    if (this.dispatcher) {
      await this.dispatcher.stop()
      this.dispatcher = null
    }
  }
}
