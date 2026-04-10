import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('job_id').notNullable()
      table.bigInteger('submission_id').notNullable().index()
      table.string('docker_image_tag', 255).notNullable()
      table.string('status', 20).notNullable().defaultTo('pending').index()
      table.integer('priority').notNullable().defaultTo(5)
      table.string('source_path', 500).notNullable()
      table.string('callback_url', 500).nullable()
      table.boolean('result_delivered').notNullable().defaultTo(false)
      table.timestamp('submitted_at', { useTz: true }).notNullable()
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('completed_at', { useTz: true }).nullable()
      table.double('estimated_runtime').notNullable()
      table.double('actual_runtime').nullable()
      table.double('hrrn_score_at_dequeue').nullable()
      table.string('worker_pod_name', 255).nullable()
      table.integer('retry_count').notNullable().defaultTo(0)
      table.text('error_message').nullable()
      table
        .bigInteger('image_config_id')
        .notNullable()
        .references('id')
        .inTable('image_configs')
        .index()
      table.bigInteger('user_id').nullable().index()
      table.bigInteger('course_id').nullable()
      table.string('assignment_name', 255).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT jobs_status_check
      CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'))
    `)

    this.schema.raw(`
      CREATE INDEX idx_jobs_pending ON ${this.tableName} (submitted_at)
      WHERE status = 'pending'
    `)
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
