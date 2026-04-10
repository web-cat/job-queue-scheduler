import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany, hasOne } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'
import ImageConfig from '#models/image_config'
import JobResult from '#models/job_result'
import CallbackLog from '#models/callback_log'

export type JobStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export default class Job extends BaseModel {
  static table = 'jobs'

  @column({ isPrimary: true })
  declare jobId: number

  @column()
  declare submissionId: number

  @column()
  declare dockerImageTag: string

  @column()
  declare status: JobStatus

  @column()
  declare priority: number

  @column()
  declare sourcePath: string

  @column()
  declare callbackUrl: string | null

  @column()
  declare resultDelivered: boolean

  @column.dateTime()
  declare submittedAt: DateTime

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column()
  declare estimatedRuntime: number

  @column()
  declare actualRuntime: number | null

  @column()
  declare hrrnScoreAtDequeue: number | null

  @column()
  declare workerPodName: string | null

  @column()
  declare retryCount: number

  @column()
  declare errorMessage: string | null

  @column()
  declare imageConfigId: number

  @column()
  declare userId: number | null

  @column()
  declare courseId: number | null

  @column()
  declare assignmentName: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => ImageConfig, {
    foreignKey: 'imageConfigId',
  })
  declare imageConfig: BelongsTo<typeof ImageConfig>

  @hasOne(() => JobResult, {
    foreignKey: 'jobId',
  })
  declare result: HasOne<typeof JobResult>

  @hasMany(() => CallbackLog, {
    foreignKey: 'jobId',
  })
  declare callbackLogs: HasMany<typeof CallbackLog>
}
