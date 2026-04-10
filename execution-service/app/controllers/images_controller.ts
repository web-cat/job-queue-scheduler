import ImageConfig from '#models/image_config'
import Job from '#models/job'
import {
  createImageConfigValidator,
  updateImageConfigValidator,
} from '#validators/image_config_validator'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

function parseImageId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null
  }
  const n = Number.parseInt(raw, 10)
  return Number.isSafeInteger(n) ? n : null
}

function serializeImageConfig(row: ImageConfig) {
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

function notFound(ctx: HttpContext) {
  return ctx.response.status(404).send({
    error: { code: 'E_IMAGE_CONFIG_NOT_FOUND', message: 'Image config not found' },
  })
}

function conflictTag(ctx: HttpContext) {
  return ctx.response.status(409).send({
    error: { code: 'E_DOCKER_IMAGE_TAG_EXISTS', message: 'docker_image_tag already exists' },
  })
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Knex/pg returns `{ rows }`; some SQLite paths return a row array directly. */
function firstRawRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) {
    return result[0] as Record<string, unknown> | undefined
  }
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown[] }).rows
    return rows[0] as Record<string, unknown> | undefined
  }
  return undefined
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(0.95 * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}

export default class ImagesController {
  async index({ serialize }: HttpContext) {
    const rows = await ImageConfig.query().orderBy('id', 'asc')
    return serialize(rows.map(serializeImageConfig))
  }

  async store(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(createImageConfigValidator)

    const existing = await ImageConfig.query()
      .where('dockerImageTag', payload.docker_image_tag)
      .first()
    if (existing) {
      return conflictTag(ctx)
    }

    const row = await ImageConfig.create({
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

    ctx.response.status(201)
    return ctx.serialize(serializeImageConfig(row))
  }

  async show(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) {
      return notFound(ctx)
    }

    const row = await ImageConfig.find(id)
    if (!row) {
      return notFound(ctx)
    }

    return ctx.serialize(serializeImageConfig(row))
  }

  async update(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) {
      return notFound(ctx)
    }

    const row = await ImageConfig.find(id)
    if (!row) {
      return notFound(ctx)
    }

    const payload = await ctx.request.validateUsing(updateImageConfigValidator)

    if (payload.docker_image_tag !== undefined) {
      const conflict = await ImageConfig.query()
        .where('dockerImageTag', payload.docker_image_tag)
        .whereNot('id', id)
        .first()
      if (conflict) {
        return conflictTag(ctx)
      }
      row.dockerImageTag = payload.docker_image_tag
    }

    if (payload.display_name !== undefined) {
      row.displayName = payload.display_name
    }
    if (payload.timeout_seconds !== undefined) {
      row.timeoutSeconds = payload.timeout_seconds
    }
    if (payload.memory_limit_mb !== undefined) {
      row.memoryLimitMb = payload.memory_limit_mb
    }
    if (payload.cpu_limit_millicores !== undefined) {
      row.cpuLimitMillicores = payload.cpu_limit_millicores
    }
    if (payload.max_retries !== undefined) {
      row.maxRetries = payload.max_retries
    }
    if (payload.default_priority !== undefined) {
      row.defaultPriority = payload.default_priority
    }
    if (payload.default_estimated_runtime !== undefined) {
      row.defaultEstimatedRuntime = payload.default_estimated_runtime
    }
    if (payload.is_active !== undefined) {
      row.isActive = payload.is_active
    }

    await row.save()
    return ctx.serialize(serializeImageConfig(row))
  }

  async destroy(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) {
      return notFound(ctx)
    }

    const row = await ImageConfig.find(id)
    if (!row) {
      return notFound(ctx)
    }

    row.isActive = false
    await row.save()

    return ctx.serialize(serializeImageConfig(row))
  }

  async stats(ctx: HttpContext) {
    const id = parseImageId(ctx.params.id)
    if (id === null) {
      return notFound(ctx)
    }

    const config = await ImageConfig.find(id)
    if (!config) {
      return notFound(ctx)
    }

    const isPg = env.get('DB_CONNECTION') === 'pg'

    const totalRow = await db.from('jobs').where('image_config_id', id).count('* as total')
    const completedRow = await db
      .from('jobs')
      .where('image_config_id', id)
      .where('status', 'completed')
      .count('* as total')
    const failedRow = await db
      .from('jobs')
      .where('image_config_id', id)
      .where('status', 'failed')
      .count('* as total')

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

    let avgWaitSeconds: number | null = null
    if (isPg) {
      const waitRow = await db.rawQuery(
        `
        SELECT AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) AS avg_wait_seconds
        FROM jobs
        WHERE image_config_id = ?
          AND started_at IS NOT NULL
        `,
        [id]
      )
      avgWaitSeconds = toNumber(firstRawRow(waitRow)?.avg_wait_seconds)
    } else {
      const waitRow = await db.rawQuery(
        `
        SELECT AVG((julianday(started_at) - julianday(submitted_at)) * 86400.0) AS avg_wait_seconds
        FROM jobs
        WHERE image_config_id = ?
          AND started_at IS NOT NULL
        `,
        [id]
      )
      avgWaitSeconds = toNumber(firstRawRow(waitRow)?.avg_wait_seconds)
    }

    let p95RuntimeSeconds: number | null = null
    if (isPg) {
      const p95Row = await db.rawQuery(
        `
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY actual_runtime) AS p95
        FROM jobs
        WHERE image_config_id = ?
          AND status = 'completed'
          AND actual_runtime IS NOT NULL
        `,
        [id]
      )
      p95RuntimeSeconds = toNumber(firstRawRow(p95Row)?.p95)
    } else {
      const runtimes = await Job.query()
        .where('imageConfigId', id)
        .where('status', 'completed')
        .whereNotNull('actualRuntime')
        .select('actualRuntime')
      const values = runtimes
        .map((j) => j.actualRuntime)
        .filter((v): v is number => v !== null && typeof v === 'number')
      p95RuntimeSeconds = percentile95(values)
    }

    const finished = completedJobs + failedJobs
    const successRate = finished > 0 ? completedJobs / finished : null

    return ctx.serialize({
      docker_image_tag: config.dockerImageTag,
      total_jobs: totalJobs,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      success_rate: successRate,
      avg_runtime_seconds: avgRuntimeSeconds,
      avg_wait_seconds: avgWaitSeconds,
      p95_runtime_seconds: p95RuntimeSeconds,
    })
  }
}
