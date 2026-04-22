import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'job_results'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('payload_path', 500).nullable()
      table.string('payload_filename', 255).nullable()
      table.bigInteger('payload_size_bytes').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('payload_path')
      table.dropColumn('payload_filename')
      table.dropColumn('payload_size_bytes')
    })
  }
}
