import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import type { SchedulerStrategy } from './scheduler_strategy.js'

export class HrrnStrategy implements SchedulerStrategy {
  async dequeueNext(workerId: string): Promise<Job | null> {
    // One linear pass: compute and store the HRRN score for every pending job.
    // Then claim the row whose score equals the MAX — no ORDER BY, no sort.
    const result = await db.rawQuery(
      `WITH scored AS (
         UPDATE jobs
         SET hrrn_score_at_dequeue = (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime,
             updated_at = NOW()
         WHERE status = 'pending'
         RETURNING job_id, hrrn_score_at_dequeue
       ),
       winner AS (
         SELECT job_id FROM scored
         WHERE hrrn_score_at_dequeue = (SELECT MAX(hrrn_score_at_dequeue) FROM scored)
         LIMIT 1
       )
       UPDATE jobs
       SET status = 'processing',
           started_at = NOW(),
           worker_pod_name = ?
       FROM winner
       WHERE jobs.job_id = winner.job_id
       RETURNING jobs.job_id`,
      [workerId]
    )

    if (!result.rows || result.rows.length === 0) {
      return null
    }

    return Job.find(result.rows[0].job_id)
  }
}
