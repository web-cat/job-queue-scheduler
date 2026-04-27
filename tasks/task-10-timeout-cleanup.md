# Task 10: Timeout & Cleanup Background Service

**Status:** Completed
**Assignee:** (pick up)
**Priority:** MEDIUM — important for reliability
**Dependencies:** Task 1, Task 9 (uses markFailed)

## What to Build

### 1. Timeout Detection: `app/services/timeout_service.ts`

Create a service that runs on an interval (every 30 seconds):

**`detectStuckJobs()`**
- Query for jobs where:
  - status = 'processing'
  - `NOW() - started_at > timeout_seconds + 30` (30 second grace period)
  - Join with image_configs to get timeout_seconds
- For each stuck job:
  - Call `jobLifecycleService.markFailed(jobId, 'Job timed out after {timeout}s')`
  - Log: "Detected stuck job {jobId}, running for {seconds}s (timeout: {timeout}s)"

### 2. Cleanup Service: `app/services/cleanup_service.ts`

Create a service that runs daily (or configurable interval):

**`cleanupOldJobs(olderThanDays: number = 30)`**
- Delete completed/failed/cancelled jobs older than N days
- This cascades to job_results and callback_log via FK constraints
- Log how many records were cleaned up

**`cleanupOrphanedFiles()`**
- Scan `/data/submissions/` directory
- For each subdirectory, check if a matching job exists in the database
- If no matching job (or job is completed/failed), delete the directory
- This catches files left behind by crashed dispatchers

### 3. Register Background Tasks

Use AdonisJS scheduling or a simple `setInterval` to register these tasks:

```typescript
// In a provider or preload file
setInterval(() => timeoutService.detectStuckJobs(), 30_000)    // every 30s
setInterval(() => cleanupService.cleanupOldJobs(), 86_400_000) // daily
setInterval(() => cleanupService.cleanupOrphanedFiles(), 3_600_000) // hourly
```

Or use AdonisJS Scheduler if available. The exact mechanism isn't critical — what matters is the tasks run reliably.

### 4. Make intervals configurable

Read cleanup intervals from system_settings if they exist, fall back to defaults.

## Acceptance Criteria

- [ ] Stuck jobs (processing past timeout + grace) are detected and marked failed
- [ ] Stuck jobs with remaining retries are reset to pending
- [ ] Old completed/failed jobs are cleaned up after the configured retention period
- [ ] Orphaned file directories are cleaned up
- [ ] All timeout and cleanup events are logged
- [ ] Background tasks don't crash the main application if they encounter errors
