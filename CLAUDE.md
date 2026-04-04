# Web-CAT Job Queue Scheduler — Claude Code Context

> **Read this file first.** It gives you full context on the project. For detailed specs, read the files in `/docs/` and `/tasks/`.

## What This Project Is

A Kubernetes-based grading-as-a-service backend for Web-CAT, an automated grading platform used by 10,000+ students across 39 institutions. We receive grading jobs from a frontend application, schedule them using the HRRN algorithm, execute them in isolated Docker containers on Kubernetes, and return results.

**We do NOT handle:** user accounts, authentication, course management, assignment configuration, or any student-facing UI. That is all the frontend team's responsibility. We are purely the grading pipeline.

## Tech Stack

- **Runtime:** Node.js 24 + TypeScript 6
- **Framework:** AdonisJS 7
- **ORM:** Lucid (AdonisJS built-in)
- **Database:** PostgreSQL 16
- **Container Orchestration:** Kubernetes (k3s, single-node)
- **Containers:** Docker (one ephemeral container per grading job)
- **K8s Client:** @kubernetes/client-node

## Architecture Overview

```
Frontend POSTs job (files + docker image tag)
    ↓
AdonisJS REST API (validates, stores files, inserts into DB)
    ↓
PostgreSQL `jobs` table (status = 'pending')
    ↓
Dispatcher Service (polls DB with HRRN query)
    ↓
Creates K8s Job pod (ephemeral, one per grading job)
    ↓
Container grades code, writes results.json, exits
    ↓
Dispatcher reads results, stores in `job_results`, updates job status
    ↓
If callback_url set: POST results to frontend
Frontend can also poll GET /api/v1/jobs/{id} anytime
```

Each grading job runs in its own Kubernetes pod with a language-specific Docker image (Java grader, Python grader, etc.). Pods are created when a job is dequeued and destroyed after completion. This is NOT a persistent worker pool — workers are ephemeral.

## HRRN Scheduling

Response Ratio = (wait_time + estimated_burst_time) / estimated_burst_time

Jobs waiting longer get progressively higher priority, preventing starvation. Computed live in SQL:

```sql
UPDATE jobs
SET status = 'processing', started_at = NOW(), worker_pod_name = :podName
WHERE job_id = (
    SELECT job_id FROM jobs
    WHERE status = 'pending'
    ORDER BY (EXTRACT(EPOCH FROM (NOW() - submitted_at)) + estimated_runtime) / estimated_runtime DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
) RETURNING *;
```

`FOR UPDATE SKIP LOCKED` prevents race conditions when multiple dispatcher threads poll simultaneously.

The system supports pluggable scheduling strategies (HRRN, FIFO, Priority) switchable at runtime via the `system_settings` table.

## Database Tables

5 tables total. See `/docs/DATABASE.md` for full schema.

- **jobs** — The queue. Every grading request is a row. Tracks full lifecycle from pending → completed/failed.
- **job_results** — Grading output (scores, comments, test output). One per completed job.
- **image_configs** — Per-docker-image settings (timeout, memory, CPU limits, runtime averages).
- **system_settings** — Key-value store for runtime config (scheduler strategy, max concurrent jobs).
- **callback_log** — Tracks webhook delivery attempts when pushing results to frontend.

## API Endpoints

See `/docs/API_ENDPOINTS.md` for the full spec. Summary:

- `POST /api/v1/jobs` — Submit a grading job
- `GET /api/v1/jobs/{jobId}` — Job status and results
- `GET /api/v1/jobs` — List jobs with filters
- `DELETE /api/v1/jobs/{jobId}` — Cancel a pending job
- `GET /api/v1/queue/status` — Queue overview
- `GET /api/v1/queue/position/{jobId}` — HRRN position
- `GET/POST/PUT/DELETE /api/v1/images` — Image config CRUD
- `GET/PUT /api/v1/config` — System settings
- `GET /api/v1/metrics/overview` — System metrics
- `GET /api/v1/health` — Health check

## Grading Container Contract

Grading Docker images follow a standard interface:

- **Input:** Student files mounted at `/grading/submission/` (read-only). ENV vars: `SUBMISSION_ID`, `TIMEOUT`.
- **Output:** Write results to `/grading/output/results.json`
- **Exit codes:** 0 = success, 1 = error, 124 = timeout
- **Security:** `--network=none`, memory/CPU limits, non-root user

## File Structure

```
/
├── CLAUDE.md                    ← You are here
├── docs/
│   ├── ARCHITECTURE.md          ← Detailed architecture
│   ├── DATABASE.md              ← Full schema with all columns
│   ├── API_ENDPOINTS.md         ← Every endpoint with request/response
│   └── CONVENTIONS.md           ← Code style and patterns
├── tasks/
│   ├── task-01-update-schema.md
│   ├── task-02-docs-setup.md    ← (this task creates the docs)
│   ├── task-03-job-submission.md
│   ├── ... (16 total)
│   └── task-16-k8s-manifests.md
└── execution-service/           ← AdonisJS application
    ├── app/
    │   ├── controllers/
    │   ├── models/
    │   ├── services/
    │   └── validators/
    ├── database/
    │   └── migrations/
    ├── config/
    ├── start/
    │   └── routes.ts
    └── ...
```

## Key Conventions

See `/docs/CONVENTIONS.md` for full details. Quick rules:

- All responses wrapped in `{ data: ... }` (existing API provider handles this)
- Use Lucid models for all DB access, no raw SQL except the HRRN dequeue query
- Service classes in `app/services/` contain business logic, controllers are thin
- Validators in `app/validators/` for all request validation
- Use environment variables for all config, never hardcode values
- Error responses: `{ error: { code: string, message: string } }`

## Team

- Tomas Odio — PM + Backend
- Raaghav Om — Backend
- Arnav Pant — Backend
- Sy Traore — Backend
- Viraj Singh — Backend

Separate frontend team handles UI, user management, course structure, and submission tracking.

## Current State

The AdonisJS skeleton is set up with Docker, Postgres, middleware, and ORM configured. Two database tables exist (`submitted_jobs` and `job_results`) but need to be updated to match the new schema. No controllers or services have been written yet. The HRRN algorithm exists as a standalone example but isn't wired into the app.
