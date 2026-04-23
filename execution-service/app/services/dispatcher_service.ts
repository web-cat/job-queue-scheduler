import logger from '@adonisjs/core/services/logger'
import Job from '#models/job'
import SystemSetting from '#models/system_setting'
import defaultSchedulerService, { SchedulerService } from '#services/scheduler_service'
import defaultJobLifecycleService from '#services/job_lifecycle_service'
import defaultFileService, {
  FileService,
  FileServiceError,
  markFailedMessageForGradingResultsError,
} from '#services/file_service'
import defaultK8sService from '#services/k8s_service_factory'

const DEFAULT_MAX_CONCURRENT = 10
const DEFAULT_IDLE_SLEEP_MS = 1000
const DEFAULT_ERROR_SLEEP_MS = 5000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 60_000
const MAX_CONTAINER_LOGS_BYTES = 10 * 1024
const MAX_FAILURE_LOG_BYTES = 2 * 1024

/**
 * In some non-HTTP entrypoints (e.g. Ace commands used as a sidecar),
 * the Adonis logger service can be unavailable during early boot or if
 * something goes wrong while booting providers. Never crash the dispatcher
 * just because structured logging isn't available.
 */
const log: Pick<Console, 'info' | 'warn' | 'error'> = (logger as any) ?? console

type K8sLike = typeof defaultK8sService
type JobLifecycleLike = typeof defaultJobLifecycleService

export type DispatcherIterationOutcome = 'processed' | 'empty' | 'at_capacity' | 'error'

export interface DispatcherOptions {
  workerId?: string
  idleSleepMs?: number
  errorSleepMs?: number
  shutdownTimeoutMs?: number
}

export class DispatcherService {
  private running = false
  private loopPromise: Promise<void> | null = null
  private inflight = new Set<Promise<void>>()

  constructor(
    private readonly k8s: K8sLike = defaultK8sService,
    private readonly lifecycle: JobLifecycleLike = defaultJobLifecycleService,
    private readonly files: FileService = defaultFileService,
    private readonly scheduler: SchedulerService = defaultSchedulerService,
    private readonly options: DispatcherOptions = {}
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  get inflightCount(): number {
    return this.inflight.size
  }

  private get workerId(): string {
    return this.options.workerId ?? 'dispatcher'
  }

  private get idleSleepMs(): number {
    return this.options.idleSleepMs ?? DEFAULT_IDLE_SLEEP_MS
  }

  private get errorSleepMs(): number {
    return this.options.errorSleepMs ?? DEFAULT_ERROR_SLEEP_MS
  }

  private get shutdownTimeoutMs(): number {
    return this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  }

  /**
   * Kicks off the polling loop. Safe to call multiple times — a second call
   * while already running is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('Dispatcher start() called while already running — ignoring')
      return
    }

    const maxConcurrent = await this.getMaxConcurrentJobs()
    log.info({ workerId: this.workerId, maxConcurrent }, 'Dispatcher started')

    this.running = true
    this.loopPromise = this.runLoop().catch((err) => {
      log.error({ err }, 'Dispatcher loop terminated with error')
    })
  }

  /**
   * Stops the polling loop and waits for any in-flight jobs to finish
   * (up to `shutdownTimeoutMs`). In-flight jobs that exceed the timeout
   * are abandoned — they remain `processing` and the timeout service
   * will eventually mark them failed.
   */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    const deadline = Date.now() + this.shutdownTimeoutMs
    while (this.inflight.size > 0 && Date.now() < deadline) {
      await Promise.race([
        Promise.allSettled(this.inflight),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ])
    }

    if (this.inflight.size > 0) {
      log.warn(
        { abandoned: this.inflight.size },
        'Dispatcher shutdown timed out with jobs still in-flight'
      )
    }

    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined)
      this.loopPromise = null
    }

    log.info('Dispatcher stopped')
  }

  /**
   * Runs the dispatch loop until `running` is cleared.
   */
  private async runLoop(): Promise<void> {
    while (this.running) {
      let outcome: DispatcherIterationOutcome
      try {
        outcome = await this.runIteration()
      } catch (err) {
        log.error({ err }, 'Unhandled error in dispatcher iteration')
        outcome = 'error'
      }

      if (!this.running) break

      if (outcome === 'error') {
        await this.sleep(this.errorSleepMs)
      } else if (outcome === 'empty' || outcome === 'at_capacity') {
        await this.sleep(this.idleSleepMs)
      }
      // 'processed' loops again immediately to keep throughput up
    }
  }

  /**
   * A single tick of the dispatcher. Exposed for unit tests and for
   * step-by-step debugging.
   */
  async runIteration(): Promise<DispatcherIterationOutcome> {
    const maxConcurrent = await this.getMaxConcurrentJobs()
    const activeCount = await this.k8s.getActiveJobCount()

    if (activeCount + this.inflight.size >= maxConcurrent) {
      return 'at_capacity'
    }

    const job = await this.scheduler.dequeueNext(this.workerId)
    if (!job) return 'empty'

    // Fire-and-track: don't block the loop on a single job.
    const promise = this.runJob(job).catch((err) => {
      log.error({ jobId: job.jobId, err }, 'Error processing job (outer)')
    })
    this.inflight.add(promise)
    promise.finally(() => this.inflight.delete(promise))

    return 'processed'
  }

  /**
   * Full lifecycle for one claimed job: create pod → wait → parse results
   * → mark completed/failed → cleanup. Exposed for tests.
   */
  async runJob(job: Job): Promise<void> {
    const jobId = Number(job.jobId)
    const jobName = this.k8s.getJobName(jobId)
    let podCreated = false

    try {
      await job.load('imageConfig')
      const cfg = job.imageConfig
      if (!cfg) {
        throw new Error(`Job ${jobId} has no image_config — cannot dispatch`)
      }

      const outputPath = await this.files.prepareOutputDirectory(jobId)

      const podName = await this.k8s.createGradingJob({
        jobId,
        dockerImageTag: job.dockerImageTag,
        inputPath: job.sourcePath,
        outputPath,
        timeoutSeconds: cfg.timeoutSeconds,
        memoryLimitMb: cfg.memoryLimitMb,
        cpuLimitMillicores: cfg.cpuLimitMillicores,
      })
      podCreated = true

      job.workerPodName = podName
      await job.save()

      const completion = await this.k8s.waitForJobCompletion(podName, cfg.timeoutSeconds)

      if (completion.succeeded) {
        await this.handleSuccessfulRun(jobId, podName, completion.durationSeconds)
      } else {
        await this.handleFailedRun(jobId, podName, completion.exitCode)
      }
    } catch (err) {
      log.error({ jobId, err }, 'Dispatcher caught error while processing job')
      await this.lifecycle
        .markFailed(jobId, `Dispatcher error: ${(err as Error)?.message ?? err}`)
        .catch((inner) =>
          log.error({ jobId, err: inner }, 'Failed to mark job failed after dispatcher error')
        )
    } finally {
      if (podCreated) {
        await this.k8s
          .deleteJob(jobName)
          .catch((err) => log.warn({ jobId, jobName, err }, 'Failed to delete K8s Job during cleanup'))
      }
      await this.files
        .cleanupSubmission(jobId)
        .catch((err) => log.warn({ jobId, err }, 'Failed to clean up submission directory'))
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async handleSuccessfulRun(
    jobId: number,
    podName: string,
    durationSeconds: number
  ): Promise<void> {
    let results
    try {
      results = await this.files.readResults(jobId)
    } catch (err) {
      if (err instanceof FileServiceError) {
        const msg = markFailedMessageForGradingResultsError(err)
        log.warn({ jobId, code: err.code }, `Grading pod succeeded but results unreadable — ${msg}`)
        await this.lifecycle.markFailed(jobId, msg)
        return
      }
      throw err
    }

    const logs = await this.k8s.getJobLogs(podName).catch(() => null)

    // Extract payload file from /grading/output/ before the finally{} below cleans the
    // submission directory. Returns null when no payload exists or when extraction fails —
    // grading itself succeeded, so we never fail the job on payload issues.
    const payload = await this.files.extractPayloadFile(jobId)

    try {
      await this.lifecycle.markCompleted(
        jobId,
        {
          ...results,
          container_logs: truncate(logs, MAX_CONTAINER_LOGS_BYTES),
          pod_name: podName,
          payload_path: payload?.path ?? null,
          payload_filename: payload?.filename ?? null,
          payload_size_bytes: payload?.sizeBytes ?? null,
        },
        durationSeconds
      )
    } catch (err) {
      if (payload) {
        await this.files.cleanupPayload(jobId)
      }
      throw err
    }
  }

  private async handleFailedRun(jobId: number, podName: string, exitCode: number): Promise<void> {
    const logs = await this.k8s.getJobLogs(podName).catch(() => null)
    const logsExcerpt = truncate(logs, MAX_FAILURE_LOG_BYTES)
    const message = logsExcerpt
      ? `Container exited with code ${exitCode}. Logs: ${logsExcerpt}`
      : `Container exited with code ${exitCode}`
    await this.lifecycle.markFailed(jobId, message)
  }

  private async getMaxConcurrentJobs(): Promise<number> {
    try {
      const setting = await SystemSetting.findBy('key', 'max_concurrent_jobs')
      if (setting) {
        const parsed = Number(setting.value)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
      }
    } catch (err) {
      log.warn({ err }, 'Failed to read max_concurrent_jobs — using default')
    }
    return DEFAULT_MAX_CONCURRENT
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
}

function truncate(value: string | null | undefined, maxBytes: number): string | null {
  if (value === null || value === undefined) return null
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  return Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8')
}

export default new DispatcherService()
