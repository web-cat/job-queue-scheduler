import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'

export class QueueService {
  async getQueueStatus() {
    const pendingCount = await Job.query().where('status', 'pending').count('* as total')
    const processingCount = await Job.query().where('status', 'processing').count('* as total')

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const completedToday = await Job.query()
      .where('status', 'completed')
      .where('completed_at', '>=', startOfToday)
      .count('* as total')

    const failedToday = await Job.query()
      .where('status', 'failed')
      .where('completed_at', '>=', startOfToday)
      .count('* as total')

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const avgWaitResult = await db.rawQuery(
      `SELECT AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) AS avg_wait
       FROM jobs
       WHERE status = 'completed' AND completed_at >= ?`,
      [oneHourAgo]
    )

    const avgExecResult = await db.rawQuery(
      `SELECT AVG(actual_runtime) AS avg_exec
       FROM jobs
       WHERE status = 'completed' AND completed_at >= ?`,
      [oneHourAgo]
    )

    const activeWorkers = await Job.query()
      .where('status', 'processing')
      .whereNotNull('worker_pod_name')
      .countDistinct('worker_pod_name as total')

    const pending = Number(pendingCount[0].$extras.total)
    const avgExec = Number(avgExecResult.rows[0]?.avg_exec ?? 0)

    return {
      pending_count: pending,
      processing_count: Number(processingCount[0].$extras.total),
      completed_today: Number(completedToday[0].$extras.total),
      failed_today: Number(failedToday[0].$extras.total),
      avg_wait_seconds: Number(avgWaitResult.rows[0]?.avg_wait ?? 0),
      active_workers: Number(activeWorkers[0].$extras.total),
      estimated_drain_time_seconds: pending * avgExec,
    }
  }

  async getQueuePosition(jobId: number) {
    const job = await Job.find(jobId)

    if (!job) {
      return { notFound: true }
    }

    if (job.status !== 'pending') {
      return { notPending: true, status: job.status }
    }

    const avgExecResult = await db.rawQuery(
      `SELECT AVG(actual_runtime) AS avg_exec
       FROM jobs
       WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '1 hour'`
    )
    const avgExec = Number(avgExecResult.rows[0]?.avg_exec ?? job.estimatedRuntime)

    const pendingJobs = await db.rawQuery(
      `SELECT job_id,
              (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime AS hrrn_score
       FROM jobs
       WHERE status = 'pending'
       ORDER BY hrrn_score DESC`
    )

    const rows: Array<{ job_id: number; hrrn_score: number }> = pendingJobs.rows
    const index = rows.findIndex((r) => Number(r.job_id) === jobId)
    const position = index + 1
    const hrrnScore = rows[index] ? Number(rows[index].hrrn_score) : null

    return {
      job_id: jobId,
      position,
      hrrn_score: hrrnScore,
      estimated_wait_seconds: position * avgExec,
      total_pending: rows.length,
    }
  }
}

export default new QueueService()
