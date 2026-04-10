import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('job_id')
      table.bigInteger('submission_id').notNullable()
      table.string('docker_image_tag', 255).notNullable()
      table
        .string('status', 20)
        .notNullable()
        .defaultTo('pending')
        .checkIn(['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'])
      table.specificType('priority', 'SMALLINT').notNullable().defaultTo(5)
      table.string('source_path', 500).notNullable()
      table.string('callback_url', 500).nullable()
      table.boolean('result_delivered').notNullable().defaultTo(false)
      table.timestamp('submitted_at', { useTz: true }).notNullable().defaultTo(this.now())
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
        .onDelete('RESTRICT')
      table.bigInteger('user_id').nullable()
      table.bigInteger('course_id').nullable()
      table.string('assignment_name', 255).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })

    // Indexes
    this.schema.raw(
      `CREATE INDEX idx_jobs_pending ON jobs (submitted_at) WHERE status = 'pending'`
    )
    this.schema.raw(`CREATE INDEX idx_jobs_submission_id ON jobs (submission_id)`)
    this.schema.raw(`CREATE INDEX idx_jobs_image_config_id ON jobs (image_config_id)`)
    this.schema.raw(`CREATE INDEX idx_jobs_user_id ON jobs (user_id)`)
    this.schema.raw(`CREATE INDEX idx_jobs_status ON jobs (status)`)
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS idx_jobs_pending')
    this.schema.raw('DROP INDEX IF EXISTS idx_jobs_submission_id')
    this.schema.raw('DROP INDEX IF EXISTS idx_jobs_image_config_id')
    this.schema.raw('DROP INDEX IF EXISTS idx_jobs_user_id')
    this.schema.raw('DROP INDEX IF EXISTS idx_jobs_status')
    this.schema.dropTable(this.tableName)
  }
}
