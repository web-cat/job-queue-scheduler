# Task 3: Job Submission Endpoint

**Status:** Completed
**Assignee:** (pick up)
**Priority:** HIGH — core functionality
**Dependencies:** Task 1 (schema must exist)

## Context

Read `/docs/API_ENDPOINTS.md` for the full endpoint spec. This is the primary entry point — the frontend sends grading jobs here.

## What to Build

### 1. Validator: `app/validators/job_validator.ts`

Create VineJS validator for the job submission request:

- `docker_image_tag`: required, string, max 255
- `submission_id`: required, integer
- `callback_url`: optional, valid URL
- `user_id`: optional, integer
- `course_id`: optional, integer
- `assignment_name`: optional, string, max 255
- `priority`: optional, integer, min 1, max 10

### 2. Service: `app/services/file_service.ts` (partial — submission part only)

Implement `storeSubmissionFiles(jobId: number, files: MultipartFile[])`:

- Create directory `/data/submissions/{jobId}/input/`
- Move uploaded files into that directory
- Return the full path as a string
- Handle errors: disk full, invalid files, oversized uploads

### 3. Service: `app/services/job_lifecycle_service.ts` (partial — submit only)

Implement `submitJob(payload)`:

- Look up `image_configs` by `docker_image_tag`
- If not found, throw 404
- If found but `is_active = false`, throw 409
- Get `estimated_runtime` from `image_configs.avg_runtime_seconds` (or `default_estimated_runtime` if avg is null)
- Get `image_config_id` for the FK
- Call `fileService.storeSubmissionFiles()` to store uploaded files
- Insert row into `jobs` table with status = 'pending'
- Calculate queue position (count of pending jobs with higher HRRN score + 1)
- Return the created job with queue_position

### 4. Controller: `app/controllers/jobs_controller.ts` (partial — store method)

Implement the `store` method:

- Parse multipart form data (files + fields)
- Validate using `createJobValidator`
- Call `jobLifecycleService.submitJob()`
- Return 201 with job data

### 5. Route: Add to `start/routes.ts`

```typescript
router.post('/api/v1/jobs', [JobsController, 'store'])
```

## File Upload Notes

Use AdonisJS multipart handling:

```typescript
const files = request.files('files', { size: '50mb', extnames: ['java', 'py', 'cpp', 'c', 'h', 'js', 'ts', 'zip', 'tar', 'gz'] })
```

Be generous with allowed extensions — professors may use any language. Consider accepting all extensions or using a configurable allowlist.

## Acceptance Criteria

- `POST /api/v1/jobs` with valid multipart form returns 201 with job_id and status
- Files are stored to `/data/submissions/{jobId}/input/`
- Invalid docker_image_tag returns 404
- Inactive docker_image_tag returns 409
- Missing required fields return 400 with descriptive errors
- estimated_runtime is correctly pulled from image_configs
- Queue position is returned in the response

