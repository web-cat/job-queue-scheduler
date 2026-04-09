import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import Job from '#models/job'

export default class ImageConfig extends BaseModel {
  static table = 'image_configs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare dockerImageTag: string

  @column()
  declare displayName: string | null

  @column()
  declare timeoutSeconds: number

  @column()
  declare memoryLimitMb: number

  @column()
  declare cpuLimitMillicores: number

  @column()
  declare maxRetries: number

  @column()
  declare defaultPriority: number

  @column()
  declare defaultEstimatedRuntime: number

  @column()
  declare avgRuntimeSeconds: number | null

  @column()
  declare totalCompletedJobs: number

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => Job, {
    foreignKey: 'imageConfigId',
  })
  declare jobs: HasMany<typeof Job>
}
