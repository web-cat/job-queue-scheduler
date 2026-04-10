# Task 6: Image Config CRUD Endpoints (Admin)

**Status:** Completed
**Assignee:** Sy
**Priority:** MEDIUM
**Dependencies:** Task 1 (schema must exist)

## What to Build

### 1. Controller: `app/controllers/images_controller.ts`

**`index` — GET /api/v1/images** — List all image configs.

**`store` — POST /api/v1/images** — Create a new image config. Validate docker_image_tag is unique. Return 409 if tag already exists.

**`show` — GET /api/v1/images/{imageId}** — Get one image config.

**`update` — PUT /api/v1/images/{imageId}** — Update config fields. Only update fields that are provided. Return 404 if not found.

**`destroy` — DELETE /api/v1/images/{imageId}** — Soft delete: set `is_active = false`. Do not actually delete the row (existing jobs may reference it).

**`stats` — GET /api/v1/images/{imageId}/stats** — Query jobs table for this image's metrics: total_jobs, completed_jobs, failed_jobs, success_rate, avg_runtime_seconds, avg_wait_seconds. Optionally compute p95_runtime using `PERCENTILE_CONT(0.95)`.

### 2. Validator: `app/validators/image_config_validator.ts`

Create validator:
- `docker_image_tag`: required, string, max 255
- `display_name`: optional, string, max 255
- `timeout_seconds`: required, integer, min 5, max 600
- `memory_limit_mb`: required, integer, min 64, max 4096
- `cpu_limit_millicores`: required, integer, min 100, max 4000
- `max_retries`: optional, integer, min 0, max 10, default 3
- `default_priority`: optional, integer, min 1, max 10, default 5
- `default_estimated_runtime`: required, number, min 1.0

Create a separate update validator where all fields are optional.

### 3. Routes

```typescript
router.get('/api/v1/images', [ImagesController, 'index'])
router.post('/api/v1/images', [ImagesController, 'store'])
router.get('/api/v1/images/:id', [ImagesController, 'show'])
router.put('/api/v1/images/:id', [ImagesController, 'update'])
router.delete('/api/v1/images/:id', [ImagesController, 'destroy'])
router.get('/api/v1/images/:id/stats', [ImagesController, 'stats'])
```

## Acceptance Criteria

- [ ] Full CRUD works for image configs
- [ ] Duplicate docker_image_tag returns 409
- [ ] DELETE soft-deletes (is_active = false), does not remove the row
- [ ] Stats endpoint returns accurate metrics from jobs table
- [ ] Validation rejects invalid resource limits
