# Task 4: Job Status & Results Endpoints

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** HIGH — core functionality
**Dependencies:** Task 1 (schema must exist)

## Context

Read `/docs/API_ENDPOINTS.md` for full specs on these endpoints.

## What to Build

### 1. Controller methods in `app/controllers/jobs_controller.ts`

**`show` — GET /api/v1/jobs/{jobId}**
- Load job by ID, include related `jobResult` if status is 'completed'
- If status is 'pending', calculate queue position and estimated wait time
- Queue position = count of pending jobs with a higher HRRN score than this job
- Estimated wait = queue_position × avg recent execution time
- Return 404 if not found

**`results` — GET /api/v1/jobs/{jobId}/results**
- Load job_result by job_id
- Return 404 if job doesn't exist
- Return 202 with `{ status: "processing" }` if job exists but not completed
- Return 200 with result data if completed

**`index` — GET /api/v1/jobs**
- Accept query params: submission_id, user_id, status, docker_image_tag, limit (default 20, max 100), offset (default 0)
- Build query dynamically based on which filters are provided
- Order by submitted_at DESC
- Return paginated response: `{ total, limit, offset, jobs: [...] }`

**`destroy` — DELETE /api/v1/jobs/{jobId}**
- Load job by ID, return 404 if not found
- If status is not 'pending', return 409 with message
- Update status to 'cancelled'
- Return 200 with updated job

### 2. Service methods in `app/services/job_lifecycle_service.ts`

**`getJob(jobId)`** — Load job with optional result, compute queue position if pending

**`getJobResults(jobId)`** — Load just the job_result row

**`listJobs(filters, pagination)`** — Build filtered, paginated query

**`cancelJob(jobId)`** — Validate status and update to cancelled

**`getQueuePosition(jobId)`** — Run HRRN ordering query and find this job's rank. This can be done by counting how many pending jobs have a higher HRRN score.

### 3. Validator: `app/validators/job_validator.ts` (add list validator)

Add validation for the list query params:
- `status`: optional, must be one of: pending, queued, processing, completed, failed, cancelled
- `limit`: optional, integer, min 1, max 100
- `offset`: optional, integer, min 0

### 4. Routes

```typescript
router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])
```

## Acceptance Criteria

- [ ] GET /api/v1/jobs/{id} returns full job details with result if completed
- [ ] GET /api/v1/jobs/{id} returns queue position and estimated wait if pending
- [ ] GET /api/v1/jobs/{id}/results returns 202 if not completed, 200 if completed
- [ ] GET /api/v1/jobs with filters correctly narrows results
- [ ] GET /api/v1/jobs pagination works (total count, limit, offset)
- [ ] DELETE /api/v1/jobs/{id} cancels pending jobs and rejects non-pending
- [ ] All endpoints return 404 for non-existent jobs
