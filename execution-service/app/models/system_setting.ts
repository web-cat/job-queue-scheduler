import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class SystemSetting extends BaseModel {
  static table = 'system_settings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: string

  @column()
  declare value: string

  @column()
  declare description: string | null

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime
}
