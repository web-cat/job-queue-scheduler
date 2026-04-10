import db from '@adonisjs/lucid/services/db'
import ImageConfig from '#models/image_config'

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : null
}

function firstRawRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: unknown[] }).rows[0] as Record<string, unknown> | undefined
  }
  return undefined
}

export function serializeImageConfig(row: ImageConfig) {
  return {
    id: row.id,
    docker_image_tag: row.dockerImageTag,
    display_name: row.displayName,
    timeout_seconds: row.timeoutSeconds,
    memory_limit_mb: row.memoryLimitMb,
    cpu_limit_millicores: row.cpuLimitMillicores,
    max_retries: row.maxRetries,
    default_priority: row.defaultPriority,
    default_estimated_runtime: row.defaultEstimatedRuntime,
    avg_runtime_seconds: row.avgRuntimeSeconds,
    total_completed_jobs: row.totalCompletedJobs,
    is_active: row.isActive,
  }
}

export class ImageConfigService {
  async list() {
    const rows = await ImageConfig.query().orderBy('id', 'asc')
    return rows.map(serializeImageConfig)
  }

  async findById(id: number) {
    return ImageConfig.find(id)
  }

  async findByTag(tag: string) {
    return ImageConfig.query().where('dockerImageTag', tag).first()
  }

  async create(payload: {
    docker_image_tag: string
    display_name?: string | null
    timeout_seconds: number
    memory_limit_mb: number
    cpu_limit_millicores: number
    max_retries?: number
    default_priority?: number
    default_estimated_runtime: number
  }) {
    return ImageConfig.create({
      dockerImageTag: payload.docker_image_tag,
      displayName: payload.display_name ?? null,
      timeoutSeconds: payload.timeout_seconds,
      memoryLimitMb: payload.memory_limit_mb,
      cpuLimitMillicores: payload.cpu_limit_millicores,
      maxRetries: payload.max_retries ?? 3,
      defaultPriority: payload.default_priority ?? 5,
      defaultEstimatedRuntime: payload.default_estimated_runtime,
      isActive: true,
      totalCompletedJobs: 0,
      avgRuntimeSeconds: null,
    })
  }

  async update(
    row: ImageConfig,
    payload: {
      docker_image_tag?: string
      display_name?: string | null
      timeout_seconds?: number
      memory_limit_mb?: number
      cpu_limit_millicores?: number
      max_retries?: number
      default_priority?: number
      default_estimated_runtime?: number
      is_active?: boolean
    }
  ) {
    if (payload.docker_image_tag !== undefined) row.dockerImageTag = payload.docker_image_tag
    if (payload.display_name !== undefined) row.displayName = payload.display_name
    if (payload.timeout_seconds !== undefined) row.timeoutSeconds = payload.timeout_seconds
    if (payload.memory_limit_mb !== undefined) row.memoryLimitMb = payload.memory_limit_mb
    if (payload.cpu_limit_millicores !== undefined) row.cpuLimitMillicores = payload.cpu_limit_millicores
    if (payload.max_retries !== undefined) row.maxRetries = payload.max_retries
    if (payload.default_priority !== undefined) row.defaultPriority = payload.default_priority
    if (payload.default_estimated_runtime !== undefined) row.defaultEstimatedRuntime = payload.default_estimated_runtime
    if (payload.is_active !== undefined) row.isActive = payload.is_active
    await row.save()
    return row
  }

  async softDelete(row: ImageConfig) {
    row.isActive = false
    await row.save()
    return row
  }

  async getStats(id: number, config: ImageConfig) {
    const [totalRow, completedRow, failedRow] = await Promise.all([
      db.from('jobs').where('image_config_id', id).count('* as total'),
      db.from('jobs').where('image_config_id', id).where('status', 'completed').count('* as total'),
      db.from('jobs').where('image_config_id', id).where('status', 'failed').count('* as total'),
    ])

    const totalJobs = Number((totalRow[0] as { total?: string | number }).total ?? 0)
    const completedJobs = Number((completedRow[0] as { total?: string | number }).total ?? 0)
    const failedJobs = Number((failedRow[0] as { total?: string | number }).total ?? 0)

    const avgRuntimeRow = await db
      .from('jobs')
      .where('image_config_id', id)
      .where('status', 'completed')
      .whereNotNull('actual_runtime')
      .avg('actual_runtime as avg')
    const avgRuntimeSeconds = toNumber((avgRuntimeRow[0] as { avg?: unknown })?.avg)

    const waitRow = await db.rawQuery(
      `SELECT AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) AS avg_wait_seconds
       FROM jobs WHERE image_config_id = ? AND started_at IS NOT NULL`,
      [id]
    )
    const avgWaitSeconds = toNumber(firstRawRow(waitRow)?.avg_wait_seconds)

    const p95Row = await db.rawQuery(
      `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY actual_runtime) AS p95
       FROM jobs WHERE image_config_id = ? AND status = 'completed' AND actual_runtime IS NOT NULL`,
      [id]
    )
    const p95RuntimeSeconds = toNumber(firstRawRow(p95Row)?.p95)

    const finished = completedJobs + failedJobs
    const successRate = finished > 0 ? completedJobs / finished : null

    return {
      docker_image_tag: config.dockerImageTag,
      total_jobs: totalJobs,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      success_rate: successRate,
      avg_runtime_seconds: avgRuntimeSeconds,
      avg_wait_seconds: avgWaitSeconds,
      p95_runtime_seconds: p95RuntimeSeconds,
    }
  }
}

export default new ImageConfigService()
