import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'image_configs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id').notNullable()
      table.string('docker_image_tag', 255).notNullable().unique()
      table.string('display_name', 255).nullable()
      table.integer('timeout_seconds').notNullable()
      table.integer('memory_limit_mb').notNullable()
      table.integer('cpu_limit_millicores').notNullable()
      table.integer('max_retries').notNullable().defaultTo(3)
      table.integer('default_priority').notNullable().defaultTo(5)
      table.double('default_estimated_runtime').notNullable()
      table.double('avg_runtime_seconds').nullable()
      table.integer('total_completed_jobs').notNullable().defaultTo(0)
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
