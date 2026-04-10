import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'callback_log'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('job_id')
        .notNullable()
        .references('job_id')
        .inTable('jobs')
        .onDelete('CASCADE')
      table.string('url', 500).notNullable()
      table.integer('attempt_number').notNullable()
      table.integer('response_code').nullable()
      table.text('response_body').nullable()
      table.boolean('success').notNullable().defaultTo(false)
      table.timestamp('attempted_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
