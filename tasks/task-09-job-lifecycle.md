# Task 9: Job Lifecycle Service

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** HIGH — manages job state transitions
**Dependencies:** Task 1 (schema must exist)

## Context

This service manages every state transition a job goes through. It's used by controllers (for submission and cancellation) and by the dispatcher (for marking jobs as completed or failed).

## What to Build

### Service: `app/services/job_lifecycle_service.ts`

**`markProcessing(jobId, workerPodName)`**
- Update status to 'processing'
- Set started_at = NOW()
- Set worker_pod_name
- This is called by the scheduler when dequeuing (may already be handled in the HRRN query — coordinate with Task 8)

**`markCompleted(jobId, results, actualRuntime)`**
- Use a database transaction for atomicity
- Update job: status = 'completed', completed_at = NOW(), actual_runtime = actualRuntime
- Insert job_results row with correctness_score, tool_score, comments, comment_format, test_output, container_logs, exit_code, cpu_usage, ram_usage, runtime_ms, pod_name, node_ip
- Update image_configs rolling average:
  ```
  new_avg = ((avg * total_completed) + actualRuntime) / (total_completed + 1)
  total_completed_jobs += 1
  ```
- If job has a callback_url, trigger the callback service (Task 11)

**`markFailed(jobId, errorMessage)`**
- Load the job and its image_config
- If retry_count < image_config.max_retries:
  - Increment retry_count
  - Reset status to 'pending' (re-enter the queue)
  - Clear worker_pod_name and started_at
  - Log: "Job {jobId} failed, retrying (attempt {retry_count}/{max_retries}): {errorMessage}"
- Otherwise:
  - Set status to 'failed'
  - Set error_message
  - Set completed_at = NOW()
  - Log: "Job {jobId} permanently failed after {max_retries} retries: {errorMessage}"

**`cancelJob(jobId)`**
- Load job, throw 404 if not found
- If status is not 'pending', throw 409
- Set status to 'cancelled', updated_at = NOW()
- Clean up files if they exist (call file_service)
- Return updated job

**`getQueuePosition(jobId)`**
- Count how many pending jobs have a higher HRRN score than this job
- Return position (1-indexed), hrrn_score, estimated_wait_seconds, total_pending
- estimated_wait = position × avg execution time from recent completed jobs

## Edge Cases to Handle

- markCompleted called on a job that's not in 'processing' status — log warning, skip
- markFailed called on a job that's already 'completed' — log warning, skip
- cancelJob on a job that was just dequeued (race condition) — 409 is correct
- Image config has no avg_runtime_seconds yet (first job) — use default_estimated_runtime

## Acceptance Criteria

- [ ] markCompleted updates both jobs and job_results tables atomically
- [ ] markCompleted updates image_configs rolling average correctly
- [ ] markFailed retries when under max_retries, permanently fails when at max
- [ ] Retried jobs re-enter the queue as 'pending' and can be picked up again
- [ ] cancelJob only works on pending jobs
- [ ] getQueuePosition returns accurate HRRN ranking
