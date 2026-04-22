import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { DateTime } from 'luxon'
import Job from '#models/job'
import fileService from '#services/file_service'
import logger from '@adonisjs/core/services/logger'

class CleanupService {
  async cleanupOldJobs(olderThanDays: number = 30): Promise<void> {
    try {
      const cutoff = DateTime.now().minus({ days: olderThanDays }).toJSDate()

      // Fetch IDs first so we can clean up files after DB deletion
      const jobs = await Job.query()
        .whereIn('status', ['completed', 'failed', 'cancelled'])
        .where('completed_at', '<', cutoff)
        .select('jobId')

      if (jobs.length === 0) {
        logger.info({ olderThanDays }, `No old jobs to clean up`)
        return
      }

      const jobIds = jobs.map((j) => j.jobId)

      // Delete DB rows — FK cascades handle job_results and callback_log
      await Job.query().whereIn('job_id', jobIds).delete()

      // Clean up submission files — non-critical, cleanupOrphanedFiles catches any misses.
      // Also delete persistent payload files since their retention aligns with job retention.
      for (const jobId of jobIds) {
        await fileService.cleanupSubmission(jobId)
        await fileService.cleanupPayload(jobId)
      }

      logger.info(
        { deleted: jobIds.length, olderThanDays },
        `Cleaned up ${jobIds.length} job(s) older than ${olderThanDays} days`
      )
    } catch (error) {
      logger.error({ error }, 'Error during old job cleanup')
    }
  }

  async cleanupOrphanedFiles(basePath?: string): Promise<void> {
    const submissionsPath = basePath ?? fileService.submissionsBasePath

    try {
      let entries: string[]
      try {
        entries = await readdir(submissionsPath)
      } catch (error: any) {
        if (error?.code === 'ENOENT') return
        throw error
      }

      const jobIds = entries.map(Number).filter((n) => Number.isInteger(n) && n > 0)

      if (jobIds.length === 0) return

      const activeJobs = await Job.query()
        .whereIn('job_id', jobIds)
        .whereIn('status', ['pending', 'queued', 'processing'])

      const activeSet = new Set(activeJobs.map((j) => Number(j.jobId)))

      const cleaned = await fileService.cleanupOrphanedDirectories(activeSet, submissionsPath)

      if (cleaned > 0) {
        logger.info({ cleaned }, `Cleaned up orphaned files for ${cleaned} job(s)`)
      }
    } catch (error) {
      logger.error({ error }, 'Error during orphaned file cleanup')
    }
  }

  async cleanupOrphanedPayloads(basePath?: string): Promise<void> {
    const payloadsPath = basePath ?? fileService.payloadsBasePath

    try {
      let entries: string[]
      try {
        entries = await readdir(payloadsPath)
      } catch (error: any) {
        if (error?.code === 'ENOENT') return
        throw error
      }

      const jobIds = entries.map(Number).filter((n) => Number.isInteger(n) && n > 0)

      if (jobIds.length === 0) return

      // A payload is orphaned if its job row is gone OR the job's retention window
      // has passed. We keep payloads for any job that still exists in the DB — the
      // per-job retention sweep in cleanupOldJobs handles the time-based removal.
      const existingJobs = await Job.query().whereIn('job_id', jobIds).select('jobId')
      const existingSet = new Set(existingJobs.map((j) => Number(j.jobId)))

      let cleaned = 0
      for (const jobId of jobIds) {
        if (!existingSet.has(jobId)) {
          const dir = path.join(payloadsPath, String(jobId))
          try {
            await rm(dir, { recursive: true, force: true })
            cleaned++
          } catch (err: any) {
            if (err?.code !== 'ENOENT') {
              logger.warn({ jobId, path: dir, err }, 'Failed to remove orphaned payload directory')
            }
          }
        }
      }

      if (cleaned > 0) {
        logger.info({ cleaned }, `Cleaned up orphaned payloads for ${cleaned} job(s)`)
      }
    } catch (error) {
      logger.error({ error }, 'Error during orphaned payload cleanup')
    }
  }
}

export default new CleanupService()
