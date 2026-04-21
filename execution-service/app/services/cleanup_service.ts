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

      // Clean up submission files — non-critical, cleanupOrphanedFiles catches any misses
      for (const jobId of jobIds) {
        await fileService.cleanupSubmissionDirectory(jobId)
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

      // Filter to numeric directory names only
      const jobIds = entries.map(Number).filter((n) => Number.isInteger(n) && n > 0)

      if (jobIds.length === 0) return

      // Batch query: fetch all active jobs in one round-trip instead of N individual lookups
      const activeJobs = await Job.query()
        .whereIn('job_id', jobIds)
        .whereIn('status', ['pending', 'queued', 'processing'])

      const activeSet = new Set(activeJobs.map((j) => Number(j.jobId)))

      let cleaned = 0

      for (const jobId of jobIds) {
        if (!activeSet.has(jobId)) {
          const jobDir = path.join(submissionsPath, String(jobId))
          await rm(jobDir, { recursive: true, force: true })
          cleaned++
          logger.info({ jobId }, `Cleaned up orphaned files for job ${jobId}`)
        }
      }

      if (cleaned > 0) {
        logger.info({ cleaned }, `Cleaned up orphaned files for ${cleaned} job(s)`)
      }
    } catch (error) {
      logger.error({ error }, 'Error during orphaned file cleanup')
    }
  }
}

export default new CleanupService()
