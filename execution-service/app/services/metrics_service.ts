import db from '@adonisjs/lucid/services/db'

export class MetricsService {
  async getOverview() {
    const counts = await db.rawQuery(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
        COUNT(*) FILTER (WHERE status = 'processing') AS total_processing,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '24 hours') AS total_completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours') AS total_failed_24h,
        AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '24 hours') AS avg_wait_seconds_24h,
        AVG(actual_runtime) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '24 hours') AS avg_execution_seconds_24h,
        EXTRACT(EPOCH FROM (NOW() - MIN(submitted_at) FILTER (WHERE status = 'pending'))) AS oldest_pending_age_seconds
      FROM jobs
    `)

    const row = counts.rows[0]
    const completed = Number(row.total_completed_24h ?? 0)
    const failed = Number(row.total_failed_24h ?? 0)

    return {
      total_pending: Number(row.total_pending ?? 0),
      total_processing: Number(row.total_processing ?? 0),
      total_completed_24h: completed,
      total_failed_24h: failed,
      avg_wait_seconds_24h: Number(row.avg_wait_seconds_24h ?? 0),
      avg_execution_seconds_24h: Number(row.avg_execution_seconds_24h ?? 0),
      throughput_per_hour: completed / 24,
      failed_rate_24h: completed + failed > 0 ? failed / (completed + failed) : 0,
      oldest_pending_age_seconds: Number(row.oldest_pending_age_seconds ?? 0),
    }
  }

  async getImageBreakdown() {
    const rows = await db.rawQuery(`
      SELECT
        docker_image_tag,
        COUNT(*) AS total_jobs,
        AVG(actual_runtime) AS avg_runtime_seconds,
        AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) AS avg_wait_seconds,
        COUNT(*) FILTER (WHERE status = 'completed')::float /
          NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0) AS success_rate
      FROM jobs
      WHERE submitted_at >= NOW() - INTERVAL '24 hours'
      GROUP BY docker_image_tag
      ORDER BY total_jobs DESC
    `)

    return rows.rows.map((r: any) => ({
      docker_image_tag: r.docker_image_tag,
      total_jobs: Number(r.total_jobs),
      avg_runtime_seconds: Number(r.avg_runtime_seconds ?? 0),
      avg_wait_seconds: Number(r.avg_wait_seconds ?? 0),
      success_rate: Number(r.success_rate ?? 0),
    }))
  }
}

export default new MetricsService()
