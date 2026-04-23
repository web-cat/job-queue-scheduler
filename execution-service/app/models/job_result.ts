import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Job from '#models/job'

export default class JobResult extends BaseModel {
  static table = 'job_results'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare jobId: number

  @column()
  declare correctnessScore: number | null

  @column()
  declare toolScore: number | null

  @column()
  declare comments: string | null

  @column()
  declare commentFormat: number | null

  @column()
  declare testOutput: string | null

  @column()
  declare containerLogs: string | null

  @column()
  declare exitCode: number | null

  @column()
  declare cpuUsage: number | null

  @column()
  declare ramUsage: number | null

  @column()
  declare runtimeMs: number | null

  @column()
  declare podName: string | null

  @column()
  declare nodeIp: string | null

  @column()
  declare payloadPath: string | null

  @column()
  declare payloadFilename: string | null

  @column({
    consume: (value: unknown) => {
      if (value === null || value === undefined) return null
      if (typeof value === 'number') return value
      if (typeof value === 'bigint') return Number(value)
      if (typeof value === 'string') {
        const n = Number(value)
        return Number.isFinite(n) ? n : null
      }
      return null
    },
  })
  declare payloadSizeBytes: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Job, {
    foreignKey: 'jobId',
  })
  declare job: BelongsTo<typeof Job>
}
