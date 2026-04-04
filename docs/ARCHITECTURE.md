# Architecture

## System Overview

This backend is a grading-as-a-service API. It receives grading jobs from a frontend application, schedules them fairly using HRRN, executes them in isolated Docker containers on Kubernetes, and returns results.

We own the grading pipeline only. User management, authentication, course structure, assignment configuration, and the student UI are all handled by a separate frontend team with their own database.

## Request Flow

### Job Submission

```
1. Frontend sends POST /api/v1/jobs
   - Multipart form: files, docker_image_tag, submission_id, optional metadata
2. API validates:
   - docker_image_tag exists in image_configs and is_active
   - Files are present and within size limits
3. API stores uploaded files to /data/submissions/{job_id}/input/
4. API looks up image_configs for estimated_runtime and resource limits
5. API inserts row into jobs table with status = 'pending'
6. API returns 201 with job_id and queue position
```

### Job Execution

```
1. Dispatcher polls jobs table using HRRN query (every 1 second)
2. Checks: active K8s pods < max_concurrent_jobs (from system_settings)
3. If capacity available, dequeues the highest HRRN-scored pending job
4. Creates /data/submissions/{job_id}/output/ directory
5. Creates a K8s Job pod:
   - Image: the docker_image_tag from the job row
   - Mount: /data/submissions/{job_id}/input/ → /grading/submission/ (read-only)
   - Mount: /data/submissions/{job_id}/output/ → /grading/output/ (writable)
   - ENV: SUBMISSION_ID, TIMEOUT
   - Resource limits from image_configs (memory, CPU)
   - Network: disabled (--network=none equivalent in K8s)
6. Waits for pod to complete or timeout
7. On success (exit code 0):
   - Reads /data/submissions/{job_id}/output/results.json
   - Parses results into job_results row
   - Updates job status to 'completed', sets actual_runtime
   - Updates image_configs.avg_runtime_seconds rolling average
8. On failure:
   - If retry_count < max_retries: increment retry_count, reset to 'pending'
   - Otherwise: set status to 'failed', store error_message
9. Cleans up K8s Job resource and submission files
```

### Result Delivery

```
1. If job has a callback_url:
   - POST results to that URL
   - Retry up to N times (from system_settings) on failure
   - Log every attempt to callback_log
   - Set result_delivered = true on success
2. Frontend can also poll GET /api/v1/jobs/{jobId} at any time
```

## Components

### AdonisJS REST API

The HTTP interface. Handles job submission, status queries, metrics, and configuration management.

- Controllers: thin, delegate to services
- Services: contain all business logic
- Validators: request validation using VineJS
- Models: Lucid ORM models mapping to Postgres tables

### Scheduler Service

Implements the HRRN scheduling algorithm. Pluggable strategy pattern supports HRRN, FIFO, and Priority scheduling. The active strategy is read from the `system_settings` table and can be switched at runtime without restarting the application.

### Dispatcher Service

A long-running background process that:
- Polls the database for pending jobs
- Manages concurrency (respects max_concurrent_jobs limit)
- Creates and monitors K8s Job pods
- Reads results from completed containers
- Handles retries for failed jobs

### Timeout & Cleanup Service

Background tasks that run on intervals:
- Every 30 seconds: detect stuck jobs (processing longer than timeout + grace period)
- Daily: clean up old completed/failed job records and leftover files

### Callback Service

Handles pushing results back to the frontend via webhooks:
- Checks for completed jobs with callback_url where result_delivered = false
- POSTs results with retry logic
- Logs all attempts for debugging

### Kubernetes Integration

Uses `@kubernetes/client-node` to interact with the k3s cluster:
- Create ephemeral Job pods for grading
- Monitor pod status
- Retrieve logs
- Clean up completed resources

### File Management

Handles the full file lifecycle:
- Receive and store uploaded files
- Prepare mount directories for K8s pods
- Read results from output directories
- Clean up after results are stored

## Deployment

Single server (Endeavour) running k3s. Two always-on pods (API + dispatcher) and ephemeral grading pods that come and go.

```
Endeavour (k3s single-node cluster)
├── API pod (always running, 1 replica)
├── Dispatcher pod (always running, 1 replica)
├── PostgreSQL (host service or pod)
├── grading-job-142 pod (Java grader, temporary)
├── grading-job-143 pod (Python grader, temporary)
└── ... (pods come and go)
```

For local development, use Docker Compose (docker-compose.dev.yml) which runs the API + Postgres. The dispatcher and K8s integration are not needed for API development.

## HRRN Scheduling Algorithm

Response Ratio = (W + S) / S

Where:
- W = time the job has been waiting (NOW() - submitted_at)
- S = estimated service time (estimated_runtime from image_configs)

The job with the highest response ratio is dequeued next. This prevents starvation: even a job with a long estimated runtime will eventually be prioritized if it waits long enough.

The estimated_runtime comes from image_configs. It starts at a configured default and updates as a rolling average after each completed job using:

```
new_avg = ((avg * total_completed) + actual_runtime) / (total_completed + 1)
```

## Pluggable Scheduling Strategies

The scheduler uses a strategy pattern:

```typescript
interface SchedulerStrategy {
  dequeueNext(workerId: string): Promise<Job | null>
}

class HRRNStrategy implements SchedulerStrategy { ... }
class FIFOStrategy implements SchedulerStrategy { ... }
class PriorityStrategy implements SchedulerStrategy { ... }
```

The active strategy is determined by the `scheduler_strategy` key in `system_settings`. Switching strategies takes effect on the next dequeue call.

## Grading Container Contract

Docker images must follow this interface:

**Inputs provided by the system:**
- `/grading/submission/` — student files (read-only mount)
- `/grading/output/` — writable directory for results
- `SUBMISSION_ID` env var
- `TIMEOUT` env var (seconds)

**Expected output:**
- `/grading/output/results.json` with structure matching job_results schema
- Exit code 0 for success, non-zero for failure

**Security constraints applied by the system:**
- No network access
- Memory limit from image_configs
- CPU limit from image_configs
- Wall-clock timeout enforced by dispatcher
- Non-root user
- Read-only filesystem except /grading/output/ and /tmp
