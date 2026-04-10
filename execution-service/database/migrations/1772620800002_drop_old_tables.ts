import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.raw('DROP TABLE IF EXISTS job_results CASCADE')
    this.schema.raw('DROP TABLE IF EXISTS submitted_jobs CASCADE')
    if (this.db.dialect.name === 'postgres') {
      this.schema.raw('DROP TYPE IF EXISTS submitted_job_status')
    }
  }

  async down() {
    // Old tables are not restored — this migration is a one-way cleanup
  }
}
