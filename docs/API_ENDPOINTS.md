# API Endpoints

Base URL: `https://web-cat-execution-service.discovery.cs.vt.edu/api/v1`
All responses are wrapped in `{ data: ... }` by the API provider.
Error responses: `{ error: { code: string, message: string } }`

---

## Service-to-service authentication (required)

This service expects requests from the other team’s backend (not direct end-user auth).

**All `/api/v1/*` endpoints require a shared API key**, except:
- `GET /api/v1/health`

Send the key using the header:
- `X-API-Key: <SERVICE_API_KEY>`

If missing/invalid, the API returns `401` with:

```json
{
  "errors": [{ "message": "Unauthorized access" }]
}
```

---

## Job Submission

### POST /api/v1/jobs

Submit a new grading job.

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| files | File(s) | Yes | Student code files to grade |
| docker_image_tag | string | Yes | Docker image to use for grading |
| submission_id | integer | Yes | Frontend's submission ID for correlation |
| callback_url | string | No | URL to POST results to when done |
| user_id | integer | No | Student's user ID (for metrics) |
| course_id | integer | No | Course ID (for metrics) |
| assignment_name | string | No | Assignment name (for metrics) |
| priority | integer | No | Override default priority (1-10) |

**Response: 201 Created**
```json
{
  "data": {
    "job_id": 142,
    "submission_id": 5678,
    "status": "pending",
    "docker_image_tag": "webcat/java-grader:cs2114-p3",
    "estimated_runtime": 15.0,
    "queue_position": 3,
    "submitted_at": "2026-03-15T23:58:00Z"
  }
}
```

**Error Responses:**
- `400` — Missing required fields or invalid file
- `404` — docker_image_tag not found in image_configs
- `409` — docker_image_tag exists but is_active = false
- `413` — File upload exceeds size limit

---

### DELETE /api/v1/jobs/{jobId}

Cancel a pending job.

**Response: 200 OK**
```json
{
  "data": {
    "job_id": 142,
    "status": "cancelled"
  }
}
```

**Error Responses:**
- `404` — Job not found
- `409` — Job is not in 'pending' status (already processing, completed, etc.)

---

## Job Status & Results

### GET /api/v1/jobs/{jobId}

Get full job details including results if completed.

**Response: 200 OK (pending job)**
```json
{
  "data": {
    "job_id": 142,
    "submission_id": 5678,
    "status": "pending",
    "docker_image_tag": "webcat/java-grader:cs2114-p3",
    "priority": 5,
    "estimated_runtime": 15.0,
    "submitted_at": "2026-03-15T23:58:00Z",
    "started_at": null,
    "completed_at": null,
    "retry_count": 0,
    "queue_position": 3,
    "estimated_wait_seconds": 45.0,
    "result": null
  }
}
```

**Response: 200 OK (completed job)**
```json
{
  "data": {
    "job_id": 142,
    "submission_id": 5678,
    "status": "completed",
    "docker_image_tag": "webcat/java-grader:cs2114-p3",
    "priority": 5,
    "estimated_runtime": 15.0,
    "actual_runtime": 12.3,
    "submitted_at": "2026-03-15T23:58:00Z",
    "started_at": "2026-03-15T23:58:05Z",
    "completed_at": "2026-03-15T23:58:17Z",
    "retry_count": 0,
    "queue_position": null,
    "estimated_wait_seconds": null,
    "result": {
      "correctness_score": 85.0,
      "tool_score": 92.0,
      "comments": "2 test cases failed. Check edge case handling.",
      "comment_format": 0,
      "test_output": "TestAdd: PASS\nTestSubtract: PASS\nTestEdgeCase: FAIL...",
      "exit_code": 0,
      "runtime_ms": 12300
    }
  }
}
```

**Error Responses:**
- `404` — Job not found

---

### GET /api/v1/jobs/{jobId}/results

Get just the grading results for a job.

**Response: 200 OK**
```json
{
  "data": {
    "job_id": 142,
    "correctness_score": 85.0,
    "tool_score": 92.0,
    "comments": "2 test cases failed.",
    "comment_format": 0,
    "test_output": "TestAdd: PASS\nTestSubtract: PASS\nTestEdgeCase: FAIL...",
    "exit_code": 0,
    "runtime_ms": 12300
  }
}
```

**Error Responses:**
- `404` — Job not found
- `202` — Job exists but not yet completed (body includes current status)

---

### GET /api/v1/jobs

List jobs with optional filters.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| submission_id | integer | — | Filter by frontend submission ID |
| user_id | integer | — | Filter by user |
| status | string | — | Filter by status |
| docker_image_tag | string | — | Filter by image |
| limit | integer | 20 | Max results (max 100) |
| offset | integer | 0 | Pagination offset |

**Response: 200 OK**
```json
{
  "data": {
    "total": 156,
    "limit": 20,
    "offset": 0,
    "jobs": [
      {
        "job_id": 142,
        "submission_id": 5678,
        "status": "completed",
        "docker_image_tag": "webcat/java-grader:cs2114-p3",
        "priority": 5,
        "submitted_at": "2026-03-15T23:58:00Z",
        "completed_at": "2026-03-15T23:58:17Z",
        "actual_runtime": 12.3
      }
    ]
  }
}
```

---

## Queue

### GET /api/v1/queue/status

Queue overview. No authentication required.

**Response: 200 OK**
```json
{
  "data": {
    "pending_count": 23,
    "processing_count": 5,
    "completed_today": 342,
    "failed_today": 3,
    "avg_wait_seconds": 12.5,
    "active_workers": 5,
    "estimated_drain_time_seconds": 55.2
  }
}
```

---

### GET /api/v1/queue/position/{jobId}

Get a pending job's position in the HRRN ordering.

**Response: 200 OK**
```json
{
  "data": {
    "job_id": 142,
    "position": 3,
    "hrrn_score": 4.2,
    "estimated_wait_seconds": 45.0,
    "total_pending": 23
  }
}
```

**Error Responses:**
- `404` — Job not found
- `409` — Job is not pending

---

## Image Configuration (Admin)

### GET /api/v1/images

List all configured docker images.

**Response: 200 OK**
```json
{
  "data": [
    {
      "id": 1,
      "docker_image_tag": "webcat/java-grader:cs2114-p3",
      "display_name": "CS2114 Project 3 Java Grader",
      "timeout_seconds": 30,
      "memory_limit_mb": 512,
      "cpu_limit_millicores": 1000,
      "max_retries": 3,
      "default_priority": 5,
      "default_estimated_runtime": 15.0,
      "avg_runtime_seconds": 12.3,
      "total_completed_jobs": 456,
      "is_active": true
    }
  ]
}
```

---

### POST /api/v1/images

Register a new docker image configuration.

**Request Body:**
```json
{
  "docker_image_tag": "webcat/python-grader:cs1064-hw5",
  "display_name": "CS1064 HW5 Python Grader",
  "timeout_seconds": 20,
  "memory_limit_mb": 256,
  "cpu_limit_millicores": 500,
  "max_retries": 3,
  "default_priority": 5,
  "default_estimated_runtime": 10.0
}
```

**Response: 201 Created** — Returns the created image config.

**Error Responses:**
- `400` — Missing required fields
- `409` — docker_image_tag already exists

---

### GET /api/v1/images/{imageId}

Get a single image configuration.

---

### PUT /api/v1/images/{imageId}

Update an image configuration. All fields optional — only provided fields are updated.

---

### DELETE /api/v1/images/{imageId}

Soft delete. Sets `is_active = false`. Does not remove the record.

---

### GET /api/v1/images/{imageId}/stats

Per-image performance metrics.

**Response: 200 OK**
```json
{
  "data": {
    "docker_image_tag": "webcat/java-grader:cs2114-p3",
    "total_jobs": 456,
    "completed_jobs": 440,
    "failed_jobs": 16,
    "success_rate": 0.965,
    "avg_runtime_seconds": 12.3,
    "avg_wait_seconds": 8.1,
    "p95_runtime_seconds": 22.5
  }
}
```

---

## System Configuration (Admin)

### GET /api/v1/config

Get all system settings.

**Response: 200 OK**
```json
{
  "data": [
    { "key": "scheduler_strategy", "value": "HRRN", "description": "Active scheduling algorithm" },
    { "key": "max_concurrent_jobs", "value": "10", "description": "Max grading pods at once" }
  ]
}
```

---

### PUT /api/v1/config/{key}

Update a system setting.

**Request Body:**
```json
{
  "value": "FIFO"
}
```

**Response: 200 OK** — Returns the updated setting.

**Error Responses:**
- `404` — Setting key not found

---

## Metrics

### GET /api/v1/metrics/overview

System-wide metrics for dashboards.

**Response: 200 OK**
```json
{
  "data": {
    "total_pending": 23,
    "total_processing": 5,
    "total_completed_24h": 1200,
    "total_failed_24h": 15,
    "avg_wait_seconds_24h": 11.3,
    "avg_execution_seconds_24h": 14.7,
    "throughput_per_hour": 50.0,
    "failed_rate_24h": 0.012,
    "oldest_pending_age_seconds": 45.2
  }
}
```

---

### GET /api/v1/metrics/images

Per-image metrics breakdown.

**Response: 200 OK**
```json
{
  "data": [
    {
      "docker_image_tag": "webcat/java-grader:cs2114-p3",
      "total_jobs_24h": 200,
      "avg_runtime_seconds": 12.3,
      "success_rate": 0.97,
      "avg_wait_seconds": 8.5
    }
  ]
}
```

---

## Health

### GET /api/v1/health

Liveness check for K8s probes and monitoring.

**Response: 200 OK**
```json
{
  "data": {
    "status": "healthy",
    "database": "connected",
    "scheduler_strategy": "HRRN",
    "active_pods": 5,
    "timestamp": "2026-03-15T23:58:00Z"
  }
}
```

**Response: 503 Service Unavailable**
```json
{
  "data": {
    "status": "unhealthy",
    "database": "disconnected",
    "timestamp": "2026-03-15T23:58:00Z"
  }
}
```
