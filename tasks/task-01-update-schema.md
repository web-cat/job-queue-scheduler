# Task 1: Update Database Schema & Migrations

**Status:** Completed
**Assignee:** Tomas
**Priority:** HIGH — blocks most other tasks
**Dependencies:** None

## Context

Read `/docs/DATABASE.md` for the full schema. The current repo has two tables (`submitted_jobs` and `job_results`) that need to be replaced with our new 5-table design.

## What to Build

### 1. Drop old migrations and create new ones

Since there's no production data, create fresh migrations that drop the old tables and create new ones. Create the following migrations in order:

1. `drop_old_tables` — Drop `submitted_jobs` and `job_results` if they exist
2. `create_image_configs` — Create the `image_configs` table
3. `create_jobs` — Create the `jobs` table (depends on image_configs FK)
4. `create_job_results` — Create the `job_results` table (depends on jobs FK)
5. `create_system_settings` — Create the `system_settings` table
6. `create_callback_log` — Create the `callback_log` table (depends on jobs FK)

### 2. Create Lucid models

Create ORM models for all 5 tables in `app/models/`:

- `app/models/job.ts`
- `app/models/job_result.ts`
- `app/models/image_config.ts`
- `app/models/system_setting.ts`
- `app/models/callback_log.ts`

Define relationships:
- Job `belongsTo` ImageConfig
- Job `hasOne` JobResult
- Job `hasMany` CallbackLog
- ImageConfig `hasMany` Job
- JobResult `belongsTo` Job
- CallbackLog `belongsTo` Job

### 3. Seed data

Create a seeder that populates:

**system_settings:**
- `scheduler_strategy` = `HRRN`
- `max_concurrent_jobs` = `10`
- `default_timeout_seconds` = `30`
- `callback_retry_max` = `3`
- `callback_retry_delay_seconds` = `5`

**image_configs (sample data for development):**
- `webcat/java-grader:example` — timeout 30s, memory 512MB, CPU 1000m, estimated_runtime 15.0
- `webcat/python-grader:example` — timeout 20s, memory 256MB, CPU 500m, estimated_runtime 10.0
- `webcat/cpp-grader:example` — timeout 45s, memory 1024MB, CPU 1500m, estimated_runtime 25.0

**Sample jobs (10 jobs in various states for testing):**
- 4 pending with different submitted_at timestamps (spread over last 2 hours)
- 2 processing
- 3 completed (with matching job_results rows)
- 1 failed

### 4. Add indexes

All indexes from `/docs/DATABASE.md`, particularly the partial index on jobs where status = 'pending'.

## Acceptance Criteria

- [ ] `node ace migration:run` succeeds on a fresh database
- [ ] `node ace migration:rollback` cleanly reverses all migrations
- [ ] `node ace db:seed` populates all seed data
- [ ] All Lucid models correctly map to their tables
- [ ] Relationships work (e.g., `job.related('imageConfig')` loads the image config)
- [ ] The HRRN dequeue query runs successfully against the seed data
