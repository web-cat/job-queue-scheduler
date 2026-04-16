import { DateTime } from 'luxon'
import Job from '#models/job'
import jobLifecycleService from '#services/job_lifecycle_service'
import logger from '@adonisjs/core/services/logger'

const GRACE_PERIOD_SECONDS = 30

class TimeoutService {
  async detectStuckJobs(): Promise<void> {
    try {
      const processingJobs = await Job.query()
        .where('status', 'processing')
        .whereNotNull('started_at')
        .preload('imageConfig')

      let stuckCount = 0

      for (const job of processingJobs) {
        if (!job.startedAt) continue

        if (!job.imageConfig) {
          logger.warn(
            { jobId: job.jobId },
            `Job ${job.jobId} has no image config — using default 30s timeout for stuck job detection`
          )
        }
        const timeoutSeconds = job.imageConfig?.timeoutSeconds ?? 30
        const runningSeconds = DateTime.now().diff(job.startedAt, 'seconds').seconds

        if (runningSeconds > timeoutSeconds + GRACE_PERIOD_SECONDS) {
          logger.warn(
            { jobId: job.jobId, runningSeconds: Math.round(runningSeconds), timeoutSeconds },
            `Detected stuck job ${job.jobId}, running for ${Math.round(runningSeconds)}s (timeout: ${timeoutSeconds}s)`
          )
          await jobLifecycleService.markFailed(job.jobId, `Job timed out after ${timeoutSeconds}s`)
          stuckCount++
        }
      }

      if (stuckCount > 0) {
        logger.info({ stuckCount }, `Timeout check complete: marked ${stuckCount} stuck job(s) as failed`)
      }
    } catch (error) {
      logger.error({ error }, 'Error during stuck job detection')
    }
  }
}

export default new TimeoutService()
