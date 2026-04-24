import { BaseCommand } from '@adonisjs/core/ace'

/**
 * Start the dispatcher loop without booting the HTTP server.
 *
 * This is intended for Kubernetes deployments where the dispatcher runs as a
 * sidecar in the same pod as the API (to share an RWO PVC). In that setup the
 * dispatcher must not bind to PORT=3333.
 */
export default class DispatcherRun extends BaseCommand {
  static commandName = 'dispatcher:run'
  static description = 'Run the dispatcher loop (no HTTP server)'
  static options = {
    /**
     * Boot the Adonis application (providers, Lucid DB, etc.).
     * Without this, models/services will not be initialized.
     */
    startApp: true,
  }

  async run() {
    const { default: dispatcherService } = await import('#services/dispatcher_service')

    await dispatcherService.start()
    // Avoid depending on the Adonis logger service in this entrypoint.
    console.log('dispatcher:run started (waiting for SIGTERM)')

    const stop = async () => {
      try {
        await dispatcherService.stop()
      } finally {
        process.exit(0)
      }
    }

    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)

    await new Promise<void>(() => {
      // keep process alive
    })
  }
}

