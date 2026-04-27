# Task 17: Payload File Support in Grading Contract

**Status:** Completed
**Assignee:** (pick up)
**Priority:** HIGH — professor-specified requirement
**Dependencies:** Task 12 (dispatcher), Task 14 (file management)

## Context

The professor has clarified that grading containers produce a **payload file** — the output of running the student's code (likely a zip file). We don't know or care what's inside it. Our job is to grab it from the container's output directory, store it on disk, and give the frontend a URL to download it.

This is a binary file so we cannot store it in the database. We store it on disk and serve it through a download endpoint.

## What Changes

### 1. Updated Grading Contract

The container now writes two things to `/grading/output/`:

```
/grading/output/
├── results.json      ← structured scores (already in our contract)
└── payload.*         ← binary output file (zip, tar, etc.) for the frontend
```

We don't know the file extension in advance. The dispatcher should look for any file in the output directory that isn't `results.json` and treat it as the payload.

### 2. Database Changes

New migration file. Do not modify existing migrations.

Add columns to `job_results`:

```sql
ALTER TABLE job_results ADD COLUMN payload_path VARCHAR(500) NULL;
ALTER TABLE job_results ADD COLUMN payload_filename VARCHAR(255) NULL;
ALTER TABLE job_results ADD COLUMN payload_size_bytes BIGINT NULL;
```

- `payload_path` — where the file is stored on disk (e.g., `/data/payloads/142/payload.zip`)
- `payload_filename` — original filename from the container (e.g., `payload.zip`)
- `payload_size_bytes` — file size for validation and metrics

### 3. Update Lucid Model

In `app/models/job_result.ts`, add:

```typescript
@column()
declare payloadPath: string | null

@column()
declare payloadFilename: string | null

@column()
declare payloadSizeBytes: number | null
```

### 4. File Service Changes (`app/services/file_service.ts`)

Add two new methods:

**`extractPayloadFile(jobId)`**
- Scan `/data/submissions/{jobId}/output/` for any file that is NOT `results.json`
- If no such file exists: return null (payload is optional)
- If found: move it to a persistent location at `/data/payloads/{jobId}/{original_filename}`
- Validate size is under a configurable limit (e.g., 100MB)
- If over the limit: log a warning, don't store it, return null
- Return: `{ path, filename, sizeBytes }`

**`getPayloadFilePath(jobId)`**
- Look up the `payload_path` from `job_results`
- Return the path if the file exists on disk
- Return null if the file doesn't exist (already cleaned up or never produced)

**`cleanupPayload(jobId)`**
- Delete `/data/payloads/{jobId}/` directory
- Called by the cleanup service when old jobs are archived

### 5. Dispatcher Changes (`app/services/dispatcher_service.ts`)

Update `processJob` — after reading results.json and before cleanup:

```typescript
// Read results.json (existing logic)
const results = await this.fileService.readResults(job.jobId)

// NEW: extract payload file if one exists
const payload = await this.fileService.extractPayloadFile(job.jobId)

// Mark completed with payload info
await this.jobLifecycleService.markCompleted(job.jobId, {
  ...results,
  payloadPath: payload?.path ?? null,
  payloadFilename: payload?.filename ?? null,
  payloadSizeBytes: payload?.sizeBytes ?? null,
}, actualRuntime)

// Clean up submission directory (but NOT the payload — it lives in /data/payloads/)
await this.fileService.cleanupSubmission(job.jobId)
```

### 6. Job Lifecycle Changes (`app/services/job_lifecycle_service.ts`)

Update `markCompleted` to accept and store the payload fields:

```typescript
async markCompleted(jobId: number, results: ResultData, actualRuntime: number): Promise<void> {
  // ... existing logic ...
  
  const jobResult = await JobResult.create({
    jobId,
    correctnessScore: results.correctnessScore,
    toolScore: results.toolScore,
    comments: results.comments,
    // ... other existing fields ...
    payloadPath: results.payloadPath,           // NEW
    payloadFilename: results.payloadFilename,   // NEW
    payloadSizeBytes: results.payloadSizeBytes, // NEW
  })
}
```

### 7. API Changes

**Add GET /api/v1/jobs/{jobId}/payload**

This endpoint serves the raw file as a download. It does NOT return JSON — it streams the binary file.

```typescript
// In jobs_controller.ts
async payload({ params, response }: HttpContext) {
  const jobResult = await JobResult.query()
    .where('job_id', params.id)
    .firstOrFail()
  
  if (!jobResult.payloadPath) {
    return response.notFound({ error: { code: 'NO_PAYLOAD', message: 'No payload file for this job' } })
  }
  
  if (!fs.existsSync(jobResult.payloadPath)) {
    return response.notFound({ error: { code: 'PAYLOAD_DELETED', message: 'Payload file has been cleaned up' } })
  }
  
  response.header('Content-Disposition', `attachment; filename="${jobResult.payloadFilename}"`)
  response.header('Content-Length', String(jobResult.payloadSizeBytes))
  return response.stream(fs.createReadStream(jobResult.payloadPath))
}
```

Add route:
```typescript
router.get('/api/v1/jobs/:id/payload', [JobsController, 'payload'])
```

**Update GET /api/v1/jobs/{jobId}/results**

Add payload metadata (not the file itself) to the response:

```json
{
  "data": {
    "job_id": 142,
    "correctness_score": 85.0,
    "tool_score": 92.0,
    "comments": "...",
    "test_output": "...",
    "exit_code": 0,
    "has_payload": true,
    "payload_filename": "payload.zip",
    "payload_size_bytes": 245760,
    "payload_url": "/api/v1/jobs/142/payload"
  }
}
```

**Update GET /api/v1/jobs/{jobId}**

Include the same payload metadata when status is completed.

### 8. Callback Changes (`app/services/callback_service.ts`)

Update the callback payload to include the download URL, not the file contents:

```typescript
const callbackBody = {
  job_id: job.jobId,
  submission_id: job.submissionId,
  status: 'completed',
  correctness_score: result.correctnessScore,
  tool_score: result.toolScore,
  comments: result.comments,
  test_output: result.testOutput,
  exit_code: result.exitCode,
  runtime_ms: result.runtimeMs,
  cpu_usage: result.cpuUsage,
  ram_usage: result.ramUsage,
  has_payload: result.payloadPath !== null,
  payload_filename: result.payloadFilename,
  payload_size_bytes: result.payloadSizeBytes,
  payload_url: `${BASE_URL}/api/v1/jobs/${job.jobId}/payload`,
  completed_at: job.completedAt,
}
```

The frontend uses `payload_url` to download the file when they need it.

### 9. Cleanup Service Changes (`app/services/cleanup_service.ts`)

Update the daily cleanup to also delete old payload files:

```typescript
async cleanupOldJobs(olderThanDays: number = 30): Promise<void> {
  // ... existing logic to find old jobs ...
  
  for (const job of oldJobs) {
    await this.fileService.cleanupPayload(job.jobId)
    await job.delete()
  }
}
```

### 10. Update Documentation

**`docs/ARCHITECTURE.md`** — Add payload file to the grading contract section.

**`docs/API_ENDPOINTS.md`** — Add the new `/jobs/{id}/payload` endpoint. Update results endpoint to show payload metadata.

**`docs/DATABASE.md`** — Add the new columns to job_results.

**`CLAUDE.md`** — Update the grading contract summary.

## File Storage Layout

```
/data/
├── submissions/          ← temporary, cleaned up right after grading
│   └── 142/
│       ├── input/
│       └── output/
│           ├── results.json
│           └── payload.zip
│
└── payloads/             ← persistent, cleaned up after 30 days
    ├── 142/
    │   └── payload.zip
    ├── 143/
    │   └── output.tar.gz
    └── 144/
        └── results.zip
```

`/data/submissions/` is temporary — cleaned up right after the dispatcher reads results and extracts the payload. `/data/payloads/` is persistent — only cleaned up by the daily cleanup service after the retention period.

## Edge Cases

- Container doesn't produce a payload file → that's fine. `has_payload` is false, `payload_url` is null. Not an error.
- Container produces multiple non-results.json files → take the largest one, or the first one found. Log a warning.
- Payload file is extremely large (>100MB) → log a warning, store null, include an error note in the callback.
- Frontend requests payload after it's been cleaned up (>30 days) → return 404 with `PAYLOAD_DELETED` message.
- Disk runs low on space → the cleanup service should be aggressive about removing old payloads. Consider adding a disk usage check that triggers early cleanup.

## Acceptance Criteria

- [ ] Migration adds payload columns to job_results
- [ ] Dispatcher extracts payload file from output directory and moves to /data/payloads/
- [ ] Payload metadata stored in job_results (path, filename, size)
- [ ] GET /api/v1/jobs/{id}/payload streams the raw file as a download
- [ ] GET /api/v1/jobs/{id}/results includes payload metadata (has_payload, filename, size, url)
- [ ] Callback to frontend includes payload_url
- [ ] Missing payload is handled gracefully (null, not an error)
- [ ] Oversized payloads are rejected with a warning
- [ ] Cleanup service deletes old payload files
- [ ] Submission output directory is cleaned up after payload is extracted
- [ ] Documentation is updated
