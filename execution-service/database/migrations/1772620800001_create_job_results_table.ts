import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'job_results'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table
        .bigInteger('job_id')
        .primary()
        .references('job_id')
        .inTable('submitted_jobs')
        .onDelete('CASCADE')

      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('ended_at', { useTz: true }).nullable()
      table.jsonb('job_results').nullable()
      table.integer('exit_code').nullable()
      table.text('termination_cause').nullable()
      table.double('cpu_usage').nullable()
      table.bigInteger('ram_usage').nullable()
      table.integer('runtime_ms').nullable()
      table.text('pod_name').nullable()
      table.text('node_ip').nullable()
      table.integer('retry_count').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
