import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import type { SchedulerStrategy } from './scheduler_strategy.js'

export class PriorityStrategy implements SchedulerStrategy {
  async dequeueNext(workerId: string): Promise<Job | null> {
    const result = await db.rawQuery(
      `UPDATE jobs
       SET status = 'processing',
           started_at = NOW(),
           worker_pod_name = ?,
           updated_at = NOW()
       WHERE job_id = (
           SELECT job_id FROM jobs
           WHERE status = 'pending'
           ORDER BY priority DESC, submitted_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
       ) RETURNING job_id`,
      [workerId]
    )

    if (!result.rows || result.rows.length === 0) {
      return null
    }

    return Job.find(result.rows[0].job_id)
  }
}
