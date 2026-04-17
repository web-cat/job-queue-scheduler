import Job from '#models/job'
import JobResult from '#models/job_result'
import CallbackLog from '#models/callback_log'
import SystemSetting from '#models/system_setting'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

const CALLBACK_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 3

async function getSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const setting = await SystemSetting.findBy('key', key)
    if (setting) {
      const parsed = Number(setting.value)
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  } catch {
    // DB unavailable — use default
  }
  return defaultValue
}

class CallbackService {
  async deliverResult(jobId: number): Promise<void> {
    const job = await Job.find(jobId)

    if (!job) {
      logger.warn({ jobId }, 'deliverResult called for non-existent job')
      return
    }

    if (!job.callbackUrl) {
      return
    }

    if (job.resultDelivered) {
      return
    }

    const jobResult = await JobResult.findBy('job_id', jobId)
    if (!jobResult) {
      logger.warn({ jobId }, 'deliverResult: no job_result row found yet — skipping')
      return
    }

    const existingAttempts = await CallbackLog.query().where('job_id', jobId).count('* as total')
    const attemptNumber = Number(existingAttempts[0].$extras.total) + 1

    const payload = {
      job_id: job.jobId,
      submission_id: job.submissionId,
      status: job.status,
      correctness_score: jobResult.correctnessScore,
      tool_score: jobResult.toolScore,
      comments: jobResult.comments,
      comment_format: jobResult.commentFormat,
      test_output: jobResult.testOutput,
      exit_code: jobResult.exitCode,
      runtime_ms: jobResult.runtimeMs,
      completed_at: job.completedAt?.toISO() ?? null,
    }

    let responseCode: number | null = null
    let responseBody: string | null = null
    let success = false

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)

      try {
        const response = await fetch(job.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        responseCode = response.status
        responseBody = await response.text().catch(() => null)
        success = response.ok
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      responseBody = message
      logger.warn({ jobId, callbackUrl: job.callbackUrl, error: message }, `Callback delivery failed for job ${jobId}`)
    }

    await CallbackLog.create({
      jobId,
      url: job.callbackUrl,
      attemptNumber,
      responseCode,
      responseBody,
      success,
      attemptedAt: DateTime.now(),
    })

    if (success) {
      job.resultDelivered = true
      await job.save()
      logger.info({ jobId, callbackUrl: job.callbackUrl, attemptNumber }, `Callback delivered successfully for job ${jobId}`)
    } else {
      logger.warn(
        { jobId, callbackUrl: job.callbackUrl, attemptNumber, responseCode },
        `Callback delivery attempt ${attemptNumber} failed for job ${jobId}`
      )
    }
  }

  async retryPendingCallbacks(): Promise<void> {
    const maxRetries = await getSetting('callback_retry_max', DEFAULT_MAX_RETRIES)

    const pendingJobs = await Job.query()
      .where('status', 'completed')
      .where('result_delivered', false)
      .whereNotNull('callback_url')

    for (const job of pendingJobs) {
      const attempts = await CallbackLog.query().where('job_id', job.jobId).count('* as total')
      const attemptCount = Number(attempts[0].$extras.total)

      if (attemptCount >= maxRetries) {
        logger.warn(
          { jobId: job.jobId, attemptCount, maxRetries },
          `Job ${job.jobId} has exhausted ${maxRetries} callback attempts — giving up`
        )
        continue
      }

      await this.deliverResult(job.jobId)
    }
  }
}

export default new CallbackService()
