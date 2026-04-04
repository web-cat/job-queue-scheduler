# Task 7: System Config & Metrics Endpoints

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** MEDIUM
**Dependencies:** Task 1 (schema must exist)

## What to Build

### 1. Controller: `app/controllers/config_controller.ts`

**`index` — GET /api/v1/config** — Return all system_settings rows.

**`update` — PUT /api/v1/config/{key}** — Update a setting's value. Return 404 if key not found. Validate that the value is appropriate for the key (e.g., scheduler_strategy must be HRRN, FIFO, or PRIORITY. max_concurrent_jobs must be a positive integer).

### 2. Controller: `app/controllers/metrics_controller.ts`

**`overview` — GET /api/v1/metrics/overview**

Run these queries against the jobs table:
- `total_pending`: COUNT where status = 'pending'
- `total_processing`: COUNT where status = 'processing'
- `total_completed_24h`: COUNT where status = 'completed' AND completed_at >= NOW() - 24 hours
- `total_failed_24h`: COUNT where status = 'failed' AND updated_at >= NOW() - 24 hours
- `avg_wait_seconds_24h`: AVG(EXTRACT(EPOCH FROM (started_at - submitted_at))) where completed in last 24h
- `avg_execution_seconds_24h`: AVG(actual_runtime) where completed in last 24h
- `throughput_per_hour`: total_completed_24h / 24
- `failed_rate_24h`: total_failed_24h / (total_completed_24h + total_failed_24h)
- `oldest_pending_age_seconds`: EXTRACT(EPOCH FROM (NOW() - MIN(submitted_at))) where status = 'pending'

**`imageBreakdown` — GET /api/v1/metrics/images**

Group by docker_image_tag for jobs in the last 24h:
- total_jobs, avg_runtime_seconds, success_rate, avg_wait_seconds

### 3. Controller: `app/controllers/health_controller.ts`

**`check` — GET /api/v1/health**
- Test database connectivity with a simple `SELECT 1`
- Read scheduler_strategy from system_settings
- Return 200 if healthy, 503 if database unreachable

### 4. Service: `app/services/metrics_service.ts`

Put all the aggregation queries here. Controllers just call the service and return the result.

### 5. Routes

```typescript
router.get('/api/v1/config', [ConfigController, 'index'])
router.put('/api/v1/config/:key', [ConfigController, 'update'])
router.get('/api/v1/metrics/overview', [MetricsController, 'overview'])
router.get('/api/v1/metrics/images', [MetricsController, 'imageBreakdown'])
router.get('/api/v1/health', [HealthController, 'check'])
```

## Acceptance Criteria

- [ ] GET /api/v1/config returns all settings
- [ ] PUT /api/v1/config/{key} updates a setting and returns the updated value
- [ ] Invalid setting values are rejected (e.g., scheduler_strategy = "INVALID")
- [ ] GET /api/v1/metrics/overview returns accurate aggregate metrics
- [ ] GET /api/v1/metrics/images returns per-image breakdown
- [ ] GET /api/v1/health returns 200 when DB is connected, 503 when not
