import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'submitted_jobs'

  async up() {
    this.schema.raw(
      "CREATE TYPE submitted_job_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed')"
    )

    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('job_id')
      table.bigInteger('submission_id').notNullable().index()
      table.double('priority').notNullable()
      table
        .specificType('status', 'submitted_job_status')
        .notNullable()
        .defaultTo(this.raw("'pending'::submitted_job_status"))
      table.text('worker_image').notNullable()
      table.integer('estimated_service_time').notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['status', 'created_at'])
    })

    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT submitted_jobs_estimated_service_time_positive
      CHECK (estimated_service_time > 0)
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
    this.schema.raw('DROP TYPE IF EXISTS submitted_job_status')
  }
}
