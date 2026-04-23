import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Job from '#models/job'
import { SchedulerService } from '#services/scheduler_service'
import {
  cleanDatabase,
  createTestImageConfig,
  createTestJob,
  TEST_TAG_PREFIX,
} from '#tests/helpers/test_utils'

/**
 * Functional tests for the HRRN scheduling strategy.
 *
 * These drive the real SchedulerService against Postgres (the same SQL used
 * by the dispatcher in production), seeding 5 jobs whose expected HRRN
 * ordering is pinned by picking (wait, burst) pairs with unambiguously
 * different response ratios. A 2-job unit variant already exists in
 * tests/unit/scheduler_service.spec.ts — this file covers the 5-job
 * ordering requirement and the concurrent-dequeue race condition check
 * that Task 15 mandates.
 */

const HRRN_TAG = `${TEST_TAG_PREFIX}hrrn`

/**
 * HRRN score = (wait + burst) / burst.
 *
 * The seeds below are engineered so every pair has a different ratio
 * (with enough gap that small clock drift during the test does not
 * flip the ordering):
 *
 *   J1  wait=600  burst=10   ratio = 61.0    ← dequeued 1st
 *   J2  wait=400  burst=10   ratio = 41.0    ← 2nd
 *   J3  wait=300  burst=20   ratio = 16.0    ← 3rd
 *   J4  wait=60   burst=10   ratio =  7.0    ← 4th
 *   J5  wait=10   burst=10   ratio =  2.0    ← 5th
 */
const SEEDS: Array<{ label: string; waitSeconds: number; burstSeconds: number }> = [
  { label: 'J1', waitSeconds: 600, burstSeconds: 10 },
  { label: 'J2', waitSeconds: 400, burstSeconds: 10 },
  { label: 'J3', waitSeconds: 300, burstSeconds: 20 },
  { label: 'J4', waitSeconds: 60, burstSeconds: 10 },
  { label: 'J5', waitSeconds: 10, burstSeconds: 10 },
]

test.group('HRRN scheduler — dequeue ordering', (group) => {
  group.each.setup(async () => {
    await cleanDatabase()
  })

  test('dequeues 5 seeded jobs in strict HRRN order', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: HRRN_TAG, maxRetries: 0 })
    const now = DateTime.now()

    // Insert in non-sequential order so we prove the scheduler is ranking
    // by HRRN score and not by insertion/submitted_at tie-break.
    const insertionOrder = [SEEDS[2], SEEDS[0], SEEDS[4], SEEDS[1], SEEDS[3]]
    const jobsByLabel = new Map<string, Job>()

    for (const seed of insertionOrder) {
      const job = await createTestJob({
        imageConfigId: cfg.id,
        dockerImageTag: cfg.dockerImageTag,
        submittedAt: now.minus({ seconds: seed.waitSeconds }),
        estimatedRuntime: seed.burstSeconds,
      })
      jobsByLabel.set(seed.label, job)
    }

    const service = new SchedulerService()
    const dequeuedLabels: string[] = []

    for (let i = 0; i < SEEDS.length; i++) {
      const next = await service.dequeueNext(`hrrn-worker-${i}`)
      assert.isNotNull(next, `Dequeue #${i + 1} unexpectedly returned null`)
      // Match by jobId to figure out which seed we pulled.
      const label = [...jobsByLabel.entries()].find(([, j]) => j.jobId === next!.jobId)?.[0]
      assert.exists(label, `Dequeued job ${next!.jobId} does not match any seeded job`)
      dequeuedLabels.push(label!)
    }

    assert.deepEqual(
      dequeuedLabels,
      SEEDS.map((s) => s.label),
      'Jobs should come out in descending HRRN score order'
    )

    // A sixth dequeue on an empty queue must return null.
    const empty = await service.dequeueNext('hrrn-worker-empty')
    assert.isNull(empty)
  })

  test('hrrn_score_at_dequeue is persisted on the claimed job', async ({ assert }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${HRRN_TAG}-score` })

    // wait = 120s, burst = 10s → ratio = 13.0
    const job = await createTestJob({
      imageConfigId: cfg.id,
      dockerImageTag: cfg.dockerImageTag,
      submittedAt: DateTime.now().minus({ seconds: 120 }),
      estimatedRuntime: 10,
    })

    const service = new SchedulerService()
    const claimed = await service.dequeueNext('hrrn-score-worker')
    assert.isNotNull(claimed)
    assert.equal(claimed!.jobId, job.jobId)
    assert.equal(claimed!.status, 'processing')
    assert.isNotNull(claimed!.hrrnScoreAtDequeue)
    assert.approximately(claimed!.hrrnScoreAtDequeue!, 13.0, 0.5)
    assert.isNotNull(claimed!.startedAt)
    assert.equal(claimed!.workerPodName, 'hrrn-score-worker')
  })

  test('concurrent dequeue: 5 workers claim 5 distinct jobs (FOR UPDATE SKIP LOCKED)', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${HRRN_TAG}-concurrent` })
    const now = DateTime.now()

    // 5 pending jobs, all identically aged so races are maximally likely
    // but every one is still claimable.
    for (let i = 0; i < 5; i++) {
      await createTestJob({
        imageConfigId: cfg.id,
        dockerImageTag: cfg.dockerImageTag,
        submittedAt: now.minus({ seconds: 30 }),
        estimatedRuntime: 10,
      })
    }

    const service = new SchedulerService()
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => service.dequeueNext(`concurrent-worker-${i}`))
    )

    const claimed = results.filter((j): j is Job => j !== null)
    assert.equal(claimed.length, 5, 'Every worker should claim a job (none should starve)')

    const ids = claimed.map((j) => j.jobId)
    assert.equal(
      new Set(ids).size,
      ids.length,
      'Each concurrent dequeue must return a distinct job'
    )

    const workerNames = claimed.map((j) => j.workerPodName)
    assert.equal(
      new Set(workerNames).size,
      claimed.length,
      'Worker names should be unique per claim'
    )

    // After concurrent dequeue, no pending jobs remain.
    const remaining = await Job.query()
      .where('status', 'pending')
      .where('docker_image_tag', cfg.dockerImageTag)
    assert.lengthOf(remaining, 0)
  })

  test('concurrent dequeue with more workers than jobs: extras get null, no duplicates', async ({
    assert,
  }) => {
    const cfg = await createTestImageConfig({ dockerImageTag: `${HRRN_TAG}-overflow` })
    const now = DateTime.now()

    // 3 jobs, 6 workers → 3 wins, 3 nulls, zero duplicates.
    for (let i = 0; i < 3; i++) {
      await createTestJob({
        imageConfigId: cfg.id,
        dockerImageTag: cfg.dockerImageTag,
        submittedAt: now.minus({ seconds: 30 + i }),
        estimatedRuntime: 10,
      })
    }

    const service = new SchedulerService()
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => service.dequeueNext(`overflow-worker-${i}`))
    )

    const claimed = results.filter((j): j is Job => j !== null)
    const nulls = results.filter((j) => j === null)

    assert.equal(claimed.length, 3)
    assert.equal(nulls.length, 3)
    assert.equal(new Set(claimed.map((j) => j.jobId)).size, 3, 'Claimed jobs must all be distinct')
  })
})
