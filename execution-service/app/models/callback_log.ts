import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Job from '#models/job'

export default class CallbackLog extends BaseModel {
  static table = 'callback_log'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare jobId: number

  @column()
  declare url: string

  @column()
  declare attemptNumber: number

  @column()
  declare responseCode: number | null

  @column()
  declare responseBody: string | null

  @column()
  declare success: boolean

  @column.dateTime()
  declare attemptedAt: DateTime

  @belongsTo(() => Job, {
    foreignKey: 'jobId',
  })
  declare job: BelongsTo<typeof Job>
}
