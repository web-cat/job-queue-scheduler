# Task 11: Callback/Webhook Service

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** MEDIUM — needed for pushing results to frontend
**Dependencies:** Task 1, Task 9 (triggered by markCompleted)

## What to Build

### 1. Service: `app/services/callback_service.ts`

**`deliverResult(jobId)`**
- Load the job and its job_result
- If job has no callback_url, skip
- If result_delivered is already true, skip
- POST to the callback_url with the result payload:
  ```json
  {
    "job_id": 142,
    "submission_id": 5678,
    "status": "completed",
    "correctness_score": 85.0,
    "tool_score": 92.0,
    "comments": "...",
    "comment_format": 0,
    "test_output": "...",
    "exit_code": 0,
    "runtime_ms": 12300,
    "completed_at": "2026-03-15T23:58:17Z"
  }
  ```
- Log the attempt to callback_log (attempt_number, response_code, success)
- If response is 2xx: set result_delivered = true on the job
- If response is non-2xx or request fails: do not set result_delivered

**`retryPendingCallbacks()`**
- Query for jobs where: callback_url IS NOT NULL, result_delivered = false, status = 'completed'
- For each job, count existing callback_log entries
- If attempts < callback_retry_max (from system_settings): call deliverResult again
- If attempts >= callback_retry_max: log warning and skip (don't retry forever)

### 2. HTTP Client

Use AdonisJS's HTTP client or the `got`/`undici` package for making outbound HTTP requests. Set a timeout of 10 seconds on callback requests so a slow frontend doesn't block the service.

### 3. Background Task

Register a background task that calls `retryPendingCallbacks()` every N seconds (read `callback_retry_delay_seconds` from system_settings, default 5s).

### 4. Integration with Job Lifecycle

In Task 9's `markCompleted`, after inserting the job_result, call `callbackService.deliverResult(jobId)`. This attempts immediate delivery. If it fails, the background retry task picks it up.

## Acceptance Criteria

- [ ] Completed jobs with callback_url get results POSTed to that URL
- [ ] Successful delivery sets result_delivered = true
- [ ] Failed deliveries are retried up to the configured max attempts
- [ ] Every attempt is logged in callback_log with response code
- [ ] Jobs without callback_url are skipped silently
- [ ] Slow/unresponsive callback URLs don't block the service (10s timeout)
