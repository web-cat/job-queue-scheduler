import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import type { SchedulerStrategy } from './scheduler_strategy.js'

export class HrrnStrategy implements SchedulerStrategy {
  async dequeueNext(workerId: string): Promise<Job | null> {
    // Atomically claim the pending job with the highest HRRN score.
    // FOR UPDATE SKIP LOCKED prevents race conditions when multiple workers poll concurrently.
    const result = await db.rawQuery(
      `UPDATE jobs
       SET status = 'processing',
           started_at = NOW(),
           worker_pod_name = ?,
           hrrn_score_at_dequeue = (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime
       WHERE job_id = (
         SELECT job_id FROM jobs
         WHERE status = 'pending'
         ORDER BY (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime DESC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING job_id`,
      [workerId]
    )

    if (!result.rows || result.rows.length === 0) {
      return null
    }

    return Job.find(result.rows[0].job_id)
  }
}
