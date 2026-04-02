import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export type SubmittedJobStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed'

export default class SubmittedJob extends BaseModel {
  static table = 'submitted_jobs'

  @column({ isPrimary: true })
  declare jobId: number

  @column()
  declare submissionId: number

  @column()
  declare priority: number

  @column()
  declare status: SubmittedJobStatus

  @column()
  declare workerImage: string

  @column()
  declare estimatedServiceTime: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
