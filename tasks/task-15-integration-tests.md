# Task 15: Integration Tests

**Status:** Complete
**Assignee:** Raaghav
**Priority:** MEDIUM — should be done after core features are built
**Dependencies:** Tasks 3-14 (tests the features those tasks build)

## Context

Write end-to-end tests that validate the full system works correctly. Use the AdonisJS test runner (Japa). Tests should run against a real PostgreSQL database (the Docker Compose dev setup).

## What to Build

### 1. Test Setup

- Create a test database (or use a separate schema)
- Run migrations before tests
- Seed with test data
- Clean up after each test (truncate tables or use transactions)

### 2. Job Submission Tests — `tests/functional/jobs/submit.spec.ts`

- Submit a valid job → 201, job appears in DB as pending
- Submit with invalid docker_image_tag → 404
- Submit with inactive docker_image_tag → 409
- Submit without required fields → 400
- Submit with files → files stored to correct directory
- Submit with callback_url → callback_url stored on job
- Submit with optional metadata (user_id, course_id) → metadata stored

### 3. Job Status Tests — `tests/functional/jobs/status.spec.ts`

- Get a pending job → includes queue_position and estimated_wait
- Get a completed job → includes result data
- Get a failed job → includes error_message
- Get a non-existent job → 404
- Get results for completed job → 200 with scores
- Get results for pending job → 202
- Cancel a pending job → 200, status = cancelled
- Cancel a processing job → 409
- Cancel a non-existent job → 404

### 4. Job List Tests — `tests/functional/jobs/list.spec.ts`

- List all jobs → returns paginated results
- Filter by status → only matching jobs
- Filter by user_id → only that user's jobs
- Filter by docker_image_tag → only jobs with that image
- Pagination → limit and offset work correctly
- Total count is accurate

### 5. Queue Tests — `tests/functional/queue/queue.spec.ts`

- Queue status returns correct counts
- Queue position for pending job returns valid position
- Queue position for non-pending job returns 409
- Queue position for non-existent job returns 404

### 6. HRRN Scheduling Tests — `tests/functional/scheduler/hrrn.spec.ts`

- Create 5 jobs with different submitted_at and estimated_runtime
- Dequeue them one by one
- Verify they come out in HRRN order (highest response ratio first)
- Concurrent dequeue test: start 5 dequeue calls simultaneously, verify each gets a different job

### 7. Image Config Tests — `tests/functional/images/images.spec.ts`

- CRUD operations all work
- Duplicate docker_image_tag returns 409
- Delete soft-deletes (is_active = false)
- Stats endpoint returns accurate metrics

### 8. Lifecycle Tests — `tests/functional/lifecycle/lifecycle.spec.ts`

- markCompleted updates job status and creates job_result
- markCompleted updates image_configs rolling average
- markFailed with retries remaining resets job to pending
- markFailed at max retries sets status to failed
- Full lifecycle: submit → dequeue → complete → verify results

### 9. Callback Tests — `tests/functional/callback/callback.spec.ts`

- Job with callback_url: mock the URL, verify POST is made with correct payload
- Successful callback sets result_delivered = true
- Failed callback logs attempt to callback_log
- Retry logic respects max attempts

## Test Utilities

Create helper functions:
- `createTestJob(overrides?)` — quickly create a job with sensible defaults
- `createTestImageConfig(overrides?)` — create an image config
- `seedTestData()` — populate database with standard test data
- `cleanDatabase()` — truncate all tables

## Acceptance Criteria

- [x] All test suites pass (205 tests: 57 unit + 148 functional)
- [x] Tests run against a real Postgres database (docker-compose postgres:16)
- [x] Tests are independent (each group resets via `cleanDatabase()` / tag-scoped `.each.setup`)
- [x] Tests clean up after themselves (dir cleanup in e2e + lifecycle, DB rows in every group)
- [x] HRRN ordering is verified with concrete examples (5-job ordered dequeue in `tests/functional/scheduler/hrrn.spec.ts`)
- [x] Concurrent dequeue is tested for race conditions (5 workers / 5 jobs + overflow cases)
- [x] Edge cases (missing data, invalid states) are covered (404/409/422 across submit/status/queue; markFailed no-op on completed; no-callback-url path)

## Deliverables

- `tests/helpers/test_utils.ts` — `createTestJob`, `createTestImageConfig`, `seedTestData`, `cleanDatabase` (tag-namespaced so suites don't collide)
- `tests/functional/scheduler/hrrn.spec.ts` — HRRN ordering + concurrent dequeue
- `tests/functional/lifecycle/lifecycle.spec.ts` — full submit→dequeue→complete, rolling avg, retry semantics, getJob shape
- `tests/functional/callback/callback.spec.ts` — markCompleted triggers POST, failure logging, retry cap
