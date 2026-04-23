import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import SystemSetting from '#models/system_setting'
import { FileService } from '#services/file_service'
import { DispatcherService } from '#services/dispatcher_service'
import defaultJobLifecycleService from '#services/job_lifecycle_service'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DISPATCH_TAG = 'test/grader:dispatch'

async function makeImageConfig(overrides: Partial<InstanceType<typeof ImageConfig>> = {}) {
  return ImageConfig.create({
    dockerImageTag: DISPATCH_TAG,
    displayName: null,
    timeoutSeconds: 30,
    memoryLimitMb: 512,
    cpuLimitMillicores: 1000,
    maxRetries: 1,
    defaultPriority: 5,
    defaultEstimatedRuntime: 15,
    isActive: true,
    totalCompletedJobs: 0,
    avgRuntimeSeconds: null,
    ...overrides,
  })
}

async function makePendingJob(
  imageConfigId: number,
  overrides: Partial<InstanceType<typeof Job>> = {}
) {
  return Job.create({
    submissionId: 1,
    dockerImageTag: DISPATCH_TAG,
    status: 'pending',
    priority: 5,
    sourcePath: '/tmp/input-path',
    resultDelivered: false,
    estimatedRuntime: 10,
    retryCount: 0,
    submittedAt: DateTime.now(),
    imageConfigId,
    ...overrides,
  })
}

async function dirExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function drainInflight(dispatcher: DispatcherService, maxMs = 5000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (dispatcher.inflightCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// ---------------------------------------------------------------------------
// Fake k8s service factory
// ---------------------------------------------------------------------------

type ResultsSpec =
  | Record<string, unknown>
  | 'missing'
  | 'invalid-json'
  | 'empty'

interface FakeOpts {
  succeed?: boolean
  exitCode?: number
  activeCount?: number
  throwOnCreate?: Error
  throwOnDelete?: Error
  writeResults?: ResultsSpec
  logs?: string | null
}

interface FakeHandle {
  fake: any
  calls: {
    created: number
    waited: number
    deleted: number
    logsRequested: number
  }
  lastOutputPath: () => string
}

function makeFakeK8s(opts: FakeOpts = {}): FakeHandle {
  let lastOutputPath = ''
  const calls = { created: 0, waited: 0, deleted: 0, logsRequested: 0 }

  const fake = {
    getJobName(jobId: number) {
      return `grading-job-${jobId}`
    },
    async createGradingJob(params: {
      jobId: number
      outputPath: string
      [k: string]: unknown
    }): Promise<string> {
      calls.created++
      lastOutputPath = params.outputPath
      if (opts.throwOnCreate) throw opts.throwOnCreate
      return `grading-job-${params.jobId}`
    },
    async waitForJobCompletion(_jobName: string, _timeoutSeconds: number) {
      calls.waited++
      if (opts.writeResults !== undefined && lastOutputPath) {
        const resultsPath = path.join(lastOutputPath, 'results.json')
        if (opts.writeResults === 'missing') {
          // Write nothing
        } else if (opts.writeResults === 'empty') {
          await writeFile(resultsPath, '')
        } else if (opts.writeResults === 'invalid-json') {
          await writeFile(resultsPath, 'not valid json {{{')
        } else {
          await writeFile(resultsPath, JSON.stringify(opts.writeResults))
        }
      }
      return {
        succeeded: opts.succeed ?? true,
        exitCode: opts.exitCode ?? 0,
        durationSeconds: 0.5,
      }
    },
    async getActiveJobCount(): Promise<number> {
      return opts.activeCount ?? 0
    },
    async getJobLogs(): Promise<string | null> {
      calls.logsRequested++
      return opts.logs === undefined ? 'fake pod logs' : opts.logs
    },
    async deleteJob(_name: string): Promise<void> {
      calls.deleted++
      if (opts.throwOnDelete) throw opts.throwOnDelete
    },
  }

  return { fake, calls, lastOutputPath: () => lastOutputPath }
}

// ---------------------------------------------------------------------------
// runIteration tests
// ---------------------------------------------------------------------------

test.group('DispatcherService — runIteration', (group) => {
  let tmpBase: string
  let testFiles: FileService

  group.each.setup(async () => {
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', DISPATCH_TAG).delete()
    await db.from('system_settings').where('key', 'max_concurrent_jobs').delete()

    tmpBase = path.join(
      tmpdir(),
      `dispatcher-iter-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(tmpBase, { recursive: true })
    testFiles = new FileService({ submissionsPath: tmpBase })
  })

  group.each.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
  })

  test('returns "empty" when there are no pending jobs', async ({ assert }) => {
    const { fake, calls } = makeFakeK8s({})
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    const outcome = await dispatcher.runIteration()
    assert.equal(outcome, 'empty')
    assert.equal(calls.created, 0)
  })

  test('returns "at_capacity" when active job count equals max_concurrent', async ({ assert }) => {
    await SystemSetting.create({
      key: 'max_concurrent_jobs',
      value: '2',
      description: 'test override',
    })
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake, calls } = makeFakeK8s({ activeCount: 2 })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    const outcome = await dispatcher.runIteration()

    assert.equal(outcome, 'at_capacity')
    assert.equal(calls.created, 0)

    // Job must remain pending — capacity check must short-circuit dequeue
    const stillPending = await Job.findOrFail(job.jobId)
    assert.equal(stillPending.status, 'pending')
    assert.isNull(stillPending.workerPodName)
  })

  test('happy path: dequeues, runs pod, parses results, marks completed', async ({ assert }) => {
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake, calls } = makeFakeK8s({
      writeResults: {
        correctness_score: 90,
        tool_score: 85,
        comments: 'Great job',
        exit_code: 0,
        runtime_ms: 12345,
        test_output: 'all tests passed',
      },
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    const outcome = await dispatcher.runIteration()

    assert.equal(outcome, 'processed')
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'completed')
    assert.isNotNull(updated.completedAt)
    assert.equal(updated.workerPodName, `grading-job-${job.jobId}`)
    assert.approximately(updated.actualRuntime!, 0.5, 0.01)

    // Pod lifecycle fully exercised
    assert.equal(calls.created, 1)
    assert.equal(calls.waited, 1)
    assert.equal(calls.deleted, 1)

    // Submission directory cleaned up after run
    assert.isFalse(await dirExists(path.join(tmpBase, String(job.jobId))))

    // Rolling avg on image_config updated
    const cfgAfter = await ImageConfig.findOrFail(cfg.id)
    assert.equal(cfgAfter.totalCompletedJobs, 1)
    assert.approximately(cfgAfter.avgRuntimeSeconds!, 0.5, 0.01)

    // JobResult row persisted
    const rows = await db.from('job_results').where('job_id', job.jobId)
    assert.lengthOf(rows, 1)
    assert.equal(Number(rows[0].correctness_score), 90)
    assert.equal(Number(rows[0].tool_score), 85)
  })

  test('failed pod with no retries remaining: marks job failed', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 0 })
    const job = await makePendingJob(cfg.id)

    const { fake, calls } = makeFakeK8s({
      succeed: false,
      exitCode: 137,
      logs: 'OOMKilled',
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!, 'exited with code 137')
    assert.include(updated.errorMessage!, 'OOMKilled')
    assert.equal(calls.deleted, 1)
  })

  test('failed pod with retries remaining: requeues as pending', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 2 })
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8s({ succeed: false, exitCode: 1 })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'pending')
    assert.equal(updated.retryCount, 1)
    assert.isNull(updated.workerPodName)
    assert.isNull(updated.startedAt)
  })

  test('missing results.json: marks job failed with stable message', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 0 })
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8s({ writeResults: 'missing' })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!, 'did not produce results')
  })

  test('empty results.json: marks job failed', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 0 })
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8s({ writeResults: 'empty' })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!, 'empty')
  })

  test('invalid JSON in results.json: marks job failed', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 0 })
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8s({ writeResults: 'invalid-json' })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!.toLowerCase(), 'json')
  })

  test('createGradingJob throws: marks job failed, no deleteJob call', async ({ assert }) => {
    const cfg = await makeImageConfig({ maxRetries: 0 })
    const job = await makePendingJob(cfg.id)

    const { fake, calls } = makeFakeK8s({
      throwOnCreate: new Error('k8s API unreachable'),
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'failed')
    assert.include(updated.errorMessage!, 'k8s API unreachable')

    assert.equal(calls.created, 1) // attempt was made
    assert.equal(calls.deleted, 0) // no pod to delete
  })
})

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------

test.group('DispatcherService — start/stop', (group) => {
  let tmpBase: string
  let testFiles: FileService

  group.each.setup(async () => {
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', DISPATCH_TAG).delete()
    await db.from('system_settings').where('key', 'max_concurrent_jobs').delete()

    tmpBase = path.join(
      tmpdir(),
      `dispatcher-ls-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    await mkdir(tmpBase, { recursive: true })
    testFiles = new FileService({ submissionsPath: tmpBase })
  })

  group.each.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
  })

  test('start then stop drains cleanly with no jobs', async ({ assert }) => {
    const { fake } = makeFakeK8s({})
    const dispatcher = new DispatcherService(fake, undefined, testFiles, undefined, {
      idleSleepMs: 20,
      errorSleepMs: 20,
      shutdownTimeoutMs: 1000,
    })

    await dispatcher.start()
    assert.isTrue(dispatcher.isRunning)

    // Let the loop spin for a bit
    await new Promise((r) => setTimeout(r, 80))

    await dispatcher.stop()
    assert.isFalse(dispatcher.isRunning)
    assert.equal(dispatcher.inflightCount, 0)
  })

  test('start is idempotent — second call while running is a no-op', async ({ assert }) => {
    const { fake } = makeFakeK8s({})
    const dispatcher = new DispatcherService(fake, undefined, testFiles, undefined, {
      idleSleepMs: 50,
      shutdownTimeoutMs: 1000,
    })

    await dispatcher.start()
    await dispatcher.start()
    assert.isTrue(dispatcher.isRunning)

    await dispatcher.stop()
    assert.isFalse(dispatcher.isRunning)
  })
})

// ---------------------------------------------------------------------------
// Payload extraction wiring (Task 17)
// ---------------------------------------------------------------------------

/**
 * Extends makeFakeK8s: if `writePayload` is set, also write a payload file into the output dir
 * alongside results.json during waitForJobCompletion. This simulates a grading container that
 * produced both artifacts.
 */
function makeFakeK8sWithPayload(
  opts: FakeOpts & { writePayload?: { name: string; content: string } } = {}
): FakeHandle {
  let lastOutputPath = ''
  const calls = { created: 0, waited: 0, deleted: 0, logsRequested: 0 }

  const fake = {
    getJobName(jobId: number) {
      return `grading-job-${jobId}`
    },
    async createGradingJob(params: {
      jobId: number
      outputPath: string
      [k: string]: unknown
    }): Promise<string> {
      calls.created++
      lastOutputPath = params.outputPath
      return `grading-job-${params.jobId}`
    },
    async waitForJobCompletion(_jobName: string, _timeoutSeconds: number) {
      calls.waited++
      if (opts.writeResults !== undefined && lastOutputPath) {
        const resultsPath = path.join(lastOutputPath, 'results.json')
        if (typeof opts.writeResults === 'object') {
          await writeFile(resultsPath, JSON.stringify(opts.writeResults))
        }
      }
      if (opts.writePayload && lastOutputPath) {
        await writeFile(path.join(lastOutputPath, opts.writePayload.name), opts.writePayload.content)
      }
      return {
        succeeded: opts.succeed ?? true,
        exitCode: opts.exitCode ?? 0,
        durationSeconds: 0.5,
      }
    },
    async getActiveJobCount(): Promise<number> {
      return opts.activeCount ?? 0
    },
    async getJobLogs(): Promise<string | null> {
      calls.logsRequested++
      return opts.logs === undefined ? 'fake pod logs' : opts.logs
    },
    async deleteJob(_name: string): Promise<void> {
      calls.deleted++
    },
  }

  return { fake, calls, lastOutputPath: () => lastOutputPath }
}

test.group('DispatcherService — payload extraction', (group) => {
  let tmpSubs: string
  let tmpPayloads: string
  let testFiles: FileService

  group.each.setup(async () => {
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', DISPATCH_TAG).delete()
    await db.from('system_settings').where('key', 'max_concurrent_jobs').delete()

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    tmpSubs = path.join(tmpdir(), `dispatcher-payload-subs-${suffix}`)
    tmpPayloads = path.join(tmpdir(), `dispatcher-payload-payloads-${suffix}`)
    await mkdir(tmpSubs, { recursive: true })
    await mkdir(tmpPayloads, { recursive: true })
    testFiles = new FileService({ submissionsPath: tmpSubs, payloadsPath: tmpPayloads })
  })

  group.each.teardown(async () => {
    await rm(tmpSubs, { recursive: true, force: true })
    await rm(tmpPayloads, { recursive: true, force: true })
  })

  test('successful run with payload: extracts file and persists metadata', async ({ assert }) => {
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8sWithPayload({
      writeResults: { correctness_score: 100, exit_code: 0 },
      writePayload: { name: 'payload.zip', content: 'zip-bytes-here' },
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const updated = await Job.findOrFail(job.jobId)
    assert.equal(updated.status, 'completed')

    const rows = await db.from('job_results').where('job_id', job.jobId)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].payload_filename, 'payload.zip')
    assert.equal(Number(rows[0].payload_size_bytes), 'zip-bytes-here'.length)
    assert.equal(rows[0].payload_path, path.join(tmpPayloads, String(job.jobId), 'payload.zip'))

    // Payload file persists in payloads directory after dispatcher cleanup of submissions
    const payloadStat = await stat(rows[0].payload_path as string)
    assert.isTrue(payloadStat.isFile())

    // Submission directory was cleaned up
    assert.isFalse(await dirExists(path.join(tmpSubs, String(job.jobId))))
  })

  test('successful run without payload: persists null payload metadata', async ({ assert }) => {
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8sWithPayload({
      writeResults: { correctness_score: 75, exit_code: 0 },
      // no writePayload — only results.json is produced
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const rows = await db.from('job_results').where('job_id', job.jobId)
    assert.lengthOf(rows, 1)
    assert.isNull(rows[0].payload_path)
    assert.isNull(rows[0].payload_filename)
    assert.isNull(rows[0].payload_size_bytes)

    // No payload directory created
    assert.isFalse(await dirExists(path.join(tmpPayloads, String(job.jobId))))
  })

  test('rolls back extracted payload when markCompleted fails', async ({ assert }) => {
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8sWithPayload({
      writeResults: { correctness_score: 100, exit_code: 0 },
      writePayload: { name: 'payload.zip', content: 'zip-bytes-here' },
    })

    // `defaultJobLifecycleService` is a class instance; spreading it drops prototype methods.
    // Create a delegating object and override the one method we want to fail.
    const flakyLifecycle = Object.assign(Object.create(defaultJobLifecycleService), {
      markCompleted: async () => {
        throw new Error('simulated DB failure during markCompleted')
      },
    }) as typeof defaultJobLifecycleService

    const dispatcher = new DispatcherService(fake, flakyLifecycle, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    // Payload directory must be cleaned up — no orphan left on disk
    assert.isFalse(await dirExists(path.join(tmpPayloads, String(job.jobId))))

    // No job_results row was inserted since markCompleted threw
    const rows = await db.from('job_results').where('job_id', job.jobId)
    assert.lengthOf(rows, 0)
  })

  test('payload is extracted before submission directory cleanup', async ({ assert }) => {
    const cfg = await makeImageConfig()
    const job = await makePendingJob(cfg.id)

    const { fake } = makeFakeK8sWithPayload({
      writeResults: { exit_code: 0 },
      writePayload: { name: 'output.tar.gz', content: 'archived-output' },
    })
    const dispatcher = new DispatcherService(fake, undefined, testFiles)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    // The payload survived submission cleanup
    const expected = path.join(tmpPayloads, String(job.jobId), 'output.tar.gz')
    const st = await stat(expected)
    assert.equal(st.size, 'archived-output'.length)

    // And submission dir itself was removed
    assert.isFalse(await dirExists(path.join(tmpSubs, String(job.jobId))))
  })
})
