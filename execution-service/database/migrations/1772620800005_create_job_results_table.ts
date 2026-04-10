import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'job_results'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('job_id')
        .notNullable()
        .unique()
        .references('job_id')
        .inTable('jobs')
        .onDelete('CASCADE')
      table.double('correctness_score').nullable()
      table.double('tool_score').nullable()
      table.text('comments').nullable()
      table.specificType('comment_format', 'SMALLINT').nullable()
      table.text('test_output').nullable()
      table.text('container_logs').nullable()
      table.integer('exit_code').nullable()
      table.double('cpu_usage').nullable()
      table.bigInteger('ram_usage').nullable()
      table.integer('runtime_ms').nullable()
      table.string('pod_name', 255).nullable()
      table.string('node_ip', 50).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
