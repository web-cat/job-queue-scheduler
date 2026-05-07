# Database Schema

PostgreSQL 16. All tables use `snake_case`. Timestamps are `TIMESTAMPTZ`.

## Table: `jobs`

The queue table. Every grading request is a row here. This is the most important table in the system.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| job_id | BIGSERIAL | PK | auto | Primary key |
| submission_id | BIGINT | NOT NULL | | Frontend's submission ID for correlation |
| docker_image_tag | VARCHAR(255) | NOT NULL | | Docker image to run (e.g. "webcat/java-grader:cs2114-p3") |
| status | VARCHAR(20) | NOT NULL | 'pending' | Job state. CHECK: pending, queued, processing, completed, failed, cancelled |
| priority | SMALLINT | NOT NULL | 5 | Higher = more important, tiebreaker for HRRN |
| source_path | VARCHAR(500) | NOT NULL | | Path to uploaded files on disk |
| callback_url | VARCHAR(500) | NULL | | If set, POST results here when done |
| result_delivered | BOOLEAN | NOT NULL | false | Has callback been successfully delivered |
| submitted_at | TIMESTAMPTZ | NOT NULL | NOW() | When the job entered the queue (used for HRRN wait time) |
| started_at | TIMESTAMPTZ | NULL | | When a worker picked it up |
| completed_at | TIMESTAMPTZ | NULL | | When grading finished |
| estimated_runtime | DOUBLE PRECISION | NOT NULL | | HRRN burst time (from image_configs avg or default) |
| actual_runtime | DOUBLE PRECISION | NULL | | Actual seconds it took |
| hrrn_score_at_dequeue | DOUBLE PRECISION | NULL | | Logged for analysis |
| worker_pod_name | VARCHAR(255) | NULL | | K8s pod name running this job |
| retry_count | INTEGER | NOT NULL | 0 | Number of retry attempts so far |
| error_message | TEXT | NULL | | Why it failed |
| image_config_id | BIGINT | FK → image_configs | NOT NULL | Links to resource limits and timeout |
| user_id | BIGINT | NULL | | Optional, from frontend, for metrics filtering |
| course_id | BIGINT | NULL | | Optional, from frontend, for metrics filtering |
| assignment_name | VARCHAR(255) | NULL | | Optional, from frontend, for metrics filtering |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### Indexes

- `idx_jobs_pending` — Partial index: `CREATE INDEX idx_jobs_pending ON jobs (submitted_at) WHERE status = 'pending'` — **Critical for HRRN query performance**
- `idx_jobs_submission_id` — `CREATE INDEX ON jobs (submission_id)`
- `idx_jobs_image_config_id` — `CREATE INDEX ON jobs (image_config_id)`
- `idx_jobs_user_id` — `CREATE INDEX ON jobs (user_id)`
- `idx_jobs_status` — `CREATE INDEX ON jobs (status)`

### Constraints

- `CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'))`
- `FOREIGN KEY (image_config_id) REFERENCES image_configs(id)`

### HRRN Dequeue Query

```sql
UPDATE jobs
SET status = 'processing',
    started_at = NOW(),
    worker_pod_name = :podName,
    hrrn_score_at_dequeue = (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime,
    updated_at = NOW()
WHERE job_id = (
    SELECT job_id FROM jobs
    WHERE status = 'pending'
    ORDER BY (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
) RETURNING *;
```

---

## Table: `job_results`

Grading output. One row per completed job. Schema aligns with the professor's `submission_result` format.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | BIGSERIAL | PK | auto | |
| job_id | BIGINT | FK → jobs, UNIQUE | NOT NULL | One result per job, CASCADE delete |
| correctness_score | DOUBLE PRECISION | NULL | | Score from correctness tests |
| tool_score | DOUBLE PRECISION | NULL | | Score from automated tools (style checks, etc.) |
| comments | TEXT | NULL | | Feedback text for the student |
| comment_format | SMALLINT | NULL | | Format type (0 = plain text, 1 = HTML, 2 = markdown) |
| test_output | TEXT | NULL | | Raw test runner output |
| container_logs | TEXT | NULL | | Container stdout/stderr, truncated to 10KB |
| exit_code | INTEGER | NULL | | Container exit code |
| cpu_usage | DOUBLE PRECISION | NULL | | CPU usage metric from container |
| ram_usage | BIGINT | NULL | | Memory usage in bytes |
| runtime_ms | INTEGER | NULL | | Wall-clock duration in milliseconds |
| pod_name | VARCHAR(255) | NULL | | K8s pod that ran this job |
| node_ip | VARCHAR(50) | NULL | | K8s node IP |
| payload_path | VARCHAR(500) | NULL | | Absolute path to payload file on the submissions PVC (internal) |
| payload_filename | VARCHAR(255) | NULL | | Filename clients should download as |
| payload_size_bytes | BIGINT | NULL | | Payload size in bytes |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### Constraints

- `UNIQUE (job_id)` — one result per job
- `FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE`

---

## Table: `image_configs`

Per-docker-image configuration. Stores resource limits, timeouts, and runtime averages.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | BIGSERIAL | PK | auto | |
| docker_image_tag | VARCHAR(255) | UNIQUE, NOT NULL | | Must match what frontend sends |
| display_name | VARCHAR(255) | NULL | | Human-readable name for dashboards |
| timeout_seconds | INTEGER | NOT NULL | 30 | Wall-clock kill limit |
| memory_limit_mb | INTEGER | NOT NULL | 512 | Container memory cap |
| cpu_limit_millicores | INTEGER | NOT NULL | 1000 | 1000 = 1 full core |
| max_retries | INTEGER | NOT NULL | 3 | Before marking job as failed |
| default_priority | SMALLINT | NOT NULL | 5 | Default priority for jobs using this image |
| default_estimated_runtime | DOUBLE PRECISION | NOT NULL | 15.0 | Fallback HRRN burst time when no history exists |
| avg_runtime_seconds | DOUBLE PRECISION | NULL | | Rolling average from completed jobs |
| total_completed_jobs | INTEGER | NOT NULL | 0 | Count for computing rolling average |
| is_active | BOOLEAN | NOT NULL | true | Can this image accept new jobs? |
| created_at | TIMESTAMPTZ | NOT NULL | NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### Rolling Average Update

After each completed job:

```sql
UPDATE image_configs
SET avg_runtime_seconds = CASE
      WHEN total_completed_jobs = 0 THEN :actualRuntime
      ELSE ((avg_runtime_seconds * total_completed_jobs) + :actualRuntime) / (total_completed_jobs + 1)
    END,
    total_completed_jobs = total_completed_jobs + 1,
    updated_at = NOW()
WHERE id = :imageConfigId;
```

---

## Table: `system_settings`

Key-value store for runtime configuration. Changed via API without restart.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | BIGSERIAL | PK | auto | |
| key | VARCHAR(100) | UNIQUE, NOT NULL | | Setting name |
| value | VARCHAR(500) | NOT NULL | | Setting value |
| description | TEXT | NULL | | What this setting does |
| updated_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### Seed Data

| key | value | description |
|---|---|---|
| scheduler_strategy | HRRN | Active scheduling algorithm (HRRN, FIFO, PRIORITY) |
| max_concurrent_jobs | 10 | Maximum grading pods running simultaneously |
| callback_retry_max | 3 | Max webhook delivery attempts |

---

## Table: `callback_log`

Tracks webhook delivery attempts. Only populated when a job has a callback_url.

| Column | Type | Nullable | Default | Description |
|---|---|---|---|---|
| id | BIGSERIAL | PK | auto | |
| job_id | BIGINT | FK → jobs | NOT NULL | |
| url | VARCHAR(500) | NOT NULL | | The callback URL |
| attempt_number | INTEGER | NOT NULL | | 1, 2, 3... |
| response_code | INTEGER | NULL | | HTTP status code from the callback |
| response_body | TEXT | NULL | | Truncated response for debugging |
| success | BOOLEAN | NOT NULL | false | |
| attempted_at | TIMESTAMPTZ | NOT NULL | NOW() | |

### Constraints

- `FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE`

---

## Entity Relationships

```
image_configs 1 ←──── N jobs 1 ────→ 1 job_results
                              1 ────→ N callback_log

system_settings (standalone, no FKs)
```

---

## Migration Notes

The existing `submitted_jobs` table needs to be renamed/replaced with `jobs`. The existing `job_results` table needs additional columns. Write new migrations rather than modifying existing ones — drop the old tables and create fresh ones since there's no production data to preserve.
