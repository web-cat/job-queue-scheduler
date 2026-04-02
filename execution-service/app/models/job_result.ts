import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import SubmittedJob from '#models/submitted_job'

export default class JobResult extends BaseModel {
  static table = 'job_results'

  @column({ isPrimary: true })
  declare jobId: number

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare endedAt: DateTime | null

  @column()
  declare jobResults: Record<string, unknown> | null

  @column()
  declare exitCode: number | null

  @column()
  declare terminationCause: string | null

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
  declare retryCount: number

  @belongsTo(() => SubmittedJob, {
    foreignKey: 'jobId',
  })
  declare job: BelongsTo<typeof SubmittedJob>
}
