import { test } from '@japa/runner'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'
import Job from '#models/job'
import JobResult from '#models/job_result'
import { DispatcherService } from '#services/dispatcher_service'
import type { CreateGradingJobParams } from '#services/k8s_service'

/**
 * End-to-end coverage for the full grading pipeline:
 *
 *   POST /api/v1/jobs  →  file stored  →  dispatcher dequeues  →
 *   fake k8s "runs" the pod (writes results.json)  →  markCompleted  →
 *   submission directory cleaned up
 *
 * The HTTP handler and the dispatcher both use the default `fileService`
 * singleton, whose path resolver reads `process.env.SUBMISSIONS_PATH` on
 * every call. Redirecting that env var to a tmp dir lets the full stack
 * run without touching /data/submissions.
 */

const TAG = 'webcat/e2e-dispatcher:v1'

async function dirExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function drainInflight(dispatcher: DispatcherService, maxMs = 10_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (dispatcher.inflightCount > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

interface FakeOpts {
  writeResults?: Record<string, unknown> | 'missing'
  succeed?: boolean
  exitCode?: number
  logs?: string | null
}

function makeFakeK8s(opts: FakeOpts = {}) {
  let lastOutputPath = ''
  const calls = { created: 0, deleted: 0 }
  return {
    calls,
    fake: {
      initialize() {
        // no-op: fake service needs to satisfy the dispatcher K8s interface
      },
      getJobName(jobId: number) {
        return `grading-job-${jobId}`
      },
      async createGradingJob(params: CreateGradingJobParams) {
        calls.created++
        lastOutputPath = params.outputPath
        return `grading-job-${params.jobId}`
      },
      async waitForJobCompletion(_name: string, _timeout: number) {
        if (opts.writeResults !== undefined && opts.writeResults !== 'missing' && lastOutputPath) {
          await writeFile(
            path.join(lastOutputPath, 'results.json'),
            JSON.stringify(opts.writeResults)
          )
        }
        return {
          succeeded: opts.succeed ?? true,
          exitCode: opts.exitCode ?? 0,
          durationSeconds: 0.25,
        }
      },
      async getActiveJobCount() {
        return 0
      },
      async getJobLogs() {
        return opts.logs === undefined ? 'stdout from grader' : opts.logs
      },
      async deleteJob(_name: string) {
        calls.deleted++
      },
    },
  }
}

test.group('E2E: submit → dispatch → complete', (group) => {
  const tmpBase = path.join(tmpdir(), `e2e-dispatcher-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  let previousSubmissionsPath: string | undefined

  group.setup(async () => {
    previousSubmissionsPath = process.env.SUBMISSIONS_PATH
    process.env.SUBMISSIONS_PATH = tmpBase
    await mkdir(tmpBase, { recursive: true })
  })

  group.teardown(async () => {
    await rm(tmpBase, { recursive: true, force: true })
    if (previousSubmissionsPath === undefined) {
      delete process.env.SUBMISSIONS_PATH
    } else {
      process.env.SUBMISSIONS_PATH = previousSubmissionsPath
    }
  })

  group.each.setup(async () => {
    // Wipe ALL jobs (not just TAG-scoped) so HRRN cannot dequeue a stale
    // pending row left over from another test file. FK cascade removes
    // job_results/callback_log automatically.
    await db.from('callback_log').delete()
    await db.from('job_results').delete()
    await db.from('jobs').delete()
    await db.from('image_configs').where('docker_image_tag', TAG).delete()
    await ImageConfig.create({
      dockerImageTag: TAG,
      displayName: 'E2E test grader',
      timeoutSeconds: 30,
      memoryLimitMb: 256,
      cpuLimitMillicores: 500,
      maxRetries: 0,
      defaultPriority: 5,
      defaultEstimatedRuntime: 10,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })
  })

  group.each.teardown(async () => {
    // The dispatcher cleans its own jobs, but a failed run could leave stray dirs.
    await rm(tmpBase, { recursive: true, force: true })
    await mkdir(tmpBase, { recursive: true })
  })

  test('grading job flows from submission to completed state', async ({ client, assert }) => {
    // 1. Submit a job over HTTP with a real file upload
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')
    const submitRes = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', TAG)
      .field('submission_id', 880001)
      .field('user_id', 7)
      .field('assignment_name', 'E2E Assignment')
      .file('files', fixturePath)

    submitRes.assertStatus(201)
    const submitBody = submitRes.body() as any
    const jobId = Number(submitBody.data.job_id)
    assert.isAbove(jobId, 0)
    assert.equal(submitBody.data.status, 'pending')

    // 2. File should have landed in the tmp submissions tree
    const inputFile = path.join(tmpBase, String(jobId), 'input', 'submission.txt')
    await stat(inputFile) // throws if missing

    // 3. Hook up a fake k8s that writes a canned results.json when the pod "runs"
    const { fake, calls } = makeFakeK8s({
      writeResults: {
        correctness_score: 92,
        tool_score: 88,
        comments: 'E2E passes!',
        comment_format: 0,
        test_output: '10/10 tests passed',
        exit_code: 0,
        runtime_ms: 2400,
      },
    })

    // Default everything else — so the HTTP file_service and the dispatcher
    // file_service are literally the same singleton pointing at tmpBase.
    const dispatcher = new DispatcherService(fake)

    const outcome = await dispatcher.runIteration()
    assert.equal(outcome, 'processed')

    await drainInflight(dispatcher)

    // 4. Job is now completed in DB
    const finalJob = await Job.findOrFail(jobId)
    assert.equal(finalJob.status, 'completed')
    assert.isNotNull(finalJob.completedAt)
    assert.equal(finalJob.workerPodName, `grading-job-${jobId}`)
    assert.approximately(finalJob.actualRuntime!, 0.25, 0.01)

    // 5. job_results row is populated from the grader output
    const result = await JobResult.findByOrFail('job_id', jobId)
    assert.equal(result.correctnessScore, 92)
    assert.equal(result.toolScore, 88)
    assert.equal(result.exitCode, 0)
    assert.equal(result.runtimeMs, 2400)
    assert.equal(result.podName, `grading-job-${jobId}`)

    // 6. Submission directory was cleaned up
    assert.isFalse(await dirExists(path.join(tmpBase, String(jobId))))

    // 7. Rolling average recorded on image_config
    const cfgAfter = await ImageConfig.findByOrFail('docker_image_tag', TAG)
    assert.equal(cfgAfter.totalCompletedJobs, 1)
    assert.approximately(cfgAfter.avgRuntimeSeconds!, 0.25, 0.01)

    // 8. Fake k8s was exercised in the expected order
    assert.equal(calls.created, 1)
    assert.equal(calls.deleted, 1)
  })

  test('grading job that produces no results.json ends up failed', async ({ client, assert }) => {
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')
    const submitRes = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', TAG)
      .field('submission_id', 880002)
      .file('files', fixturePath)

    submitRes.assertStatus(201)
    const jobId = Number((submitRes.body() as any).data.job_id)

    const { fake } = makeFakeK8s({ writeResults: 'missing' })
    const dispatcher = new DispatcherService(fake)
    await dispatcher.runIteration()
    await drainInflight(dispatcher)

    const finalJob = await Job.findOrFail(jobId)
    assert.equal(finalJob.status, 'failed')
    assert.include(finalJob.errorMessage!, 'did not produce results')
    assert.isFalse(await dirExists(path.join(tmpBase, String(jobId))))
  })
})
