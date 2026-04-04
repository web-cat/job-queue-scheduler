# Task 5: Queue Endpoints

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** MEDIUM
**Dependencies:** Task 1 (schema must exist)

## What to Build

### 1. Controller: `app/controllers/queue_controller.ts`

**`status` — GET /api/v1/queue/status**
- No authentication required
- Query the database for:
  - `pending_count`: COUNT where status = 'pending'
  - `processing_count`: COUNT where status = 'processing'
  - `completed_today`: COUNT where status = 'completed' AND completed_at >= start of today
  - `failed_today`: COUNT where status = 'failed' AND completed_at >= start of today
  - `avg_wait_seconds`: AVG(started_at - submitted_at) for jobs completed in last hour
  - `active_workers`: COUNT DISTINCT worker_pod_name where status = 'processing'
  - `estimated_drain_time_seconds`: pending_count × avg execution time from recent completed jobs

**`position` — GET /api/v1/queue/position/{jobId}**
- Load job, return 404 if not found, 409 if not pending
- Run the HRRN ordering on all pending jobs
- Find this job's rank in the ordering
- Calculate estimated_wait = position × avg recent execution time
- Return: job_id, position, hrrn_score, estimated_wait_seconds, total_pending

### 2. Service: `app/services/queue_service.ts`

Implement `getQueueStatus()` and `getQueuePosition(jobId)` with the queries above.

### 3. Routes

```typescript
router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])
```

## Acceptance Criteria

- [ ] GET /api/v1/queue/status returns all metrics with correct counts
- [ ] GET /api/v1/queue/position/{id} returns correct HRRN position for a pending job
- [ ] Position endpoint returns 409 for non-pending jobs
- [ ] Metrics are accurate against seed data
