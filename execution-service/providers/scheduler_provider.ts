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

export default class SchedulerProvider {
  private intervals: ReturnType<typeof setInterval>[] = []

  constructor(protected app: ApplicationService) {}

  async start() {
    if (this.app.getEnvironment() === 'test') return

    const { default: timeoutService } = await import('#services/timeout_service')
    const { default: cleanupService } = await import('#services/cleanup_service')

    const timeoutCheckSeconds = await getSetting('timeout_check_interval_seconds', 30)
    const cleanupJobsSeconds = await getSetting('cleanup_jobs_interval_seconds', 86_400)
    const cleanupFilesSeconds = await getSetting('cleanup_files_interval_seconds', 3_600)
    const retentionDays = await getSetting('job_retention_days', 30)

    logger.info(
      { timeoutCheckSeconds, cleanupJobsSeconds, cleanupFilesSeconds, retentionDays },
      'Starting background scheduler tasks'
    )

    this.intervals.push(
      setInterval(
        () => timeoutService.detectStuckJobs().catch((err) => logger.error({ err }, 'Unhandled error in detectStuckJobs')),
        timeoutCheckSeconds * 1000
      )
    )

    this.intervals.push(
      setInterval(
        () => cleanupService.cleanupOldJobs(retentionDays).catch((err) => logger.error({ err }, 'Unhandled error in cleanupOldJobs')),
        cleanupJobsSeconds * 1000
      )
    )

    this.intervals.push(
      setInterval(
        () => cleanupService.cleanupOrphanedFiles().catch((err) => logger.error({ err }, 'Unhandled error in cleanupOrphanedFiles')),
        cleanupFilesSeconds * 1000
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
