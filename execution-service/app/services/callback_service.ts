import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import JobResult from '#models/job_result'
import CallbackLog from '#models/callback_log'
import SystemSetting from '#models/system_setting'
import logger from '@adonisjs/core/services/logger'
import { buildPayloadUrl } from '#services/job_lifecycle_service'
import { DateTime } from 'luxon'

const CALLBACK_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 3
const MAX_RESPONSE_BODY = 1_000

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

function isValidCallbackUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') {
    logger.warn(
      { callbackUrl: rawUrl },
      'Callback URL rejected: only HTTPS is allowed'
    )
    return false
  }

  const host = url.hostname.toLowerCase()

  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return false
  if (/^169\.254\./.test(host)) return false
  if (/^10\./.test(host)) return false
  if (/^192\.168\./.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false

  return true
}

class CallbackService {
  async deliverResult(jobId: number): Promise<void> {
    const job = await Job.find(jobId)

    if (!job) {
      logger.warn({ jobId }, 'deliverResult called for non-existent job')
      return
    }

    if (!job.callbackUrl) return
    if (job.resultDelivered) return

    if (!isValidCallbackUrl(job.callbackUrl)) {
      logger.warn(
        { jobId, callbackUrl: job.callbackUrl },
        `Callback URL failed SSRF validation for job ${jobId} — skipping`
      )
      return
    }

    const jobResult = await JobResult.findBy('job_id', jobId)
    if (!jobResult) {
      logger.warn({ jobId }, 'deliverResult: no job_result row found yet — skipping')
      return
    }

    const callbackUrl = job.callbackUrl

    const hasPayload = jobResult.payloadPath !== null
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
      has_payload: hasPayload,
      payload_filename: jobResult.payloadFilename,
      payload_size_bytes: jobResult.payloadSizeBytes,
      payload_url: hasPayload ? buildPayloadUrl(job.jobId) : null,
      completed_at: job.completedAt?.toISO() ?? null,
    }

    let responseCode: number | null = null
    let responseBody: string | null = null
    let success = false

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS)

      try {
        const response = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        responseCode = response.status
        const rawBody = await response.text().catch(() => null)
        responseBody = rawBody !== null ? rawBody.slice(0, MAX_RESPONSE_BODY) : null
        success = response.ok
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      responseBody = message.slice(0, MAX_RESPONSE_BODY)
      logger.warn(
        { jobId, callbackUrl, error: message },
        `Callback delivery failed for job ${jobId}`
      )
    }

    // Serialize concurrent deliverResult calls for the same job.
    // The FOR UPDATE lock is re-checked inside the transaction (via Lucid's
    // typed query so boolean casting is correct) so that if two callers both
    // passed the early resultDelivered guard, only the first to acquire the lock
    // will log success and mark delivery; the second will see resultDelivered =
    // true and bail out without logging a spurious extra entry.
    // result_delivered is updated inside the same transaction as the CallbackLog
    // insert so both are committed atomically — no crash window between them.
    let attemptNumber!: number
    let alreadyDelivered = false

    await db.transaction(async (trx) => {
      // Lock the row, then re-read it through Lucid so the boolean column is
      // cast correctly (rawQuery can return 't'/'f' strings on some pg versions).
      await trx.rawQuery('SELECT 1 FROM jobs WHERE job_id = ? FOR UPDATE', [jobId])
      const lockedJob = await Job.query({ client: trx }).where('job_id', jobId).first()

      if (!lockedJob || lockedJob.resultDelivered) {
        alreadyDelivered = true
        return
      }

      const countResult = await CallbackLog.query({ client: trx })
        .where('job_id', jobId)
        .count('* as total')
      attemptNumber = Number(countResult[0].$extras.total) + 1

      await CallbackLog.create(
        {
          jobId,
          url: callbackUrl,
          attemptNumber,
          responseCode,
          responseBody,
          success,
          attemptedAt: DateTime.now(),
        },
        { client: trx }
      )

      if (success) {
        lockedJob.resultDelivered = true
        await lockedJob.save()
      }
    })

    if (alreadyDelivered) return

    if (success) {
      job.resultDelivered = true // keep in-memory object in sync
      logger.info(
        { jobId, callbackUrl, attemptNumber },
        `Callback delivered successfully for job ${jobId}`
      )
    } else {
      logger.warn(
        { jobId, callbackUrl, attemptNumber, responseCode },
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

    if (pendingJobs.length === 0) return

    const pendingJobIds = pendingJobs.map((j) => j.jobId)

    const { rows: countRows } = await db.rawQuery<{ rows: { job_id: string; total: string }[] }>(
      `SELECT job_id, COUNT(*) as total FROM callback_log WHERE job_id = ANY(?) GROUP BY job_id`,
      [pendingJobIds]
    )

    const attemptMap = new Map<number, number>()
    for (const row of countRows) {
      attemptMap.set(Number(row.job_id), Number(row.total))
    }

    for (const job of pendingJobs) {
      const attemptCount = attemptMap.get(Number(job.jobId)) ?? 0

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
