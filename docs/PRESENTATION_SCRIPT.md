## Job Queue Scheduler — Presentation Script (5 speakers)

This script matches the current codebase and demo tooling in this repo.

### Prereqs (do this once before presenting)

- **API is deployed** on Discovery and reachable at your base URL.
- **You have `SERVICE_API_KEY`** set in your shell (sent as `X-API-Key`).
- **You pushed graders** to GHCR:

```bash
chmod +x scripts/*.sh
./scripts/push-test-graders.sh
```

- **Register grader images in the DB** (idempotent; `409` means already exists):

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/register-image-configs.sh
```

Notes:
- `POST /api/v1/jobs` will return `404` until the `docker_image_tag` is registered in `image_configs`.
- Payload files persist on Discovery because the deployment sets `PAYLOADS_PATH` inside the submissions PVC.

---

## Speaker assignments

- **Speaker 1**: Problem + architecture overview (2 min)
- **Speaker 2**: API + authentication + endpoints (3 min)
- **Speaker 3**: Scheduling/dispatcher + queue behavior (3 min)
- **Speaker 4**: Zip submissions + payload artifacts demo (4–5 min)
- **Speaker 5**: Security/isolation + limitations + next steps (2–3 min)

Total: ~14–16 minutes (adjust by trimming demos).

---

## Speaker 1 (2 min): Goal + architecture

**Say**
- We built a Kubernetes-based job scheduling/execution platform for grading workloads.
- Clients submit a job (code files or a zip). Jobs queue in Postgres, and a dispatcher launches grading pods as Kubernetes Jobs.
- Each grading job is isolated in its own container with CPU/memory/timeouts and produces `results.json` and optional artifacts.

**Key point**
- Compared to a threaded worker, isolation and failure containment is dramatically improved: one bad submission won’t crash the service.

Handoff: “Let’s look at the API and how it’s secured.”

---

## Speaker 2 (3 min): API + auth + job model

**Say**
- All `GET/POST /api/v1/*` endpoints require service-to-service auth using:
  - `X-API-Key: <SERVICE_API_KEY>`
- Main endpoints:
  - `POST /api/v1/jobs` submit
  - `GET /api/v1/jobs/:id` status
  - `GET /api/v1/jobs/:id/payload` artifact download (binary)
  - `GET /api/v1/queue/status` queue overview
  - `GET /api/v1/metrics/overview` system metrics

**Quick live check**
- In Postman: `GET {{baseURL}}/queue/status` (should return 200).

Handoff: “Now we’ll submit jobs and explain how scheduling and scaling works today.”

---

## Speaker 3 (3 min): Dispatcher + scaling behavior (current design)

**Say**
- The dispatcher polls the DB queue and creates Kubernetes Job resources (`app=grading-worker`).
- Throughput is controlled by concurrency (e.g., `max_concurrent_jobs`), not by KEDA/HPA.
- On Discovery, a shared submissions PVC is ReadWriteOnce (RWO), so we avoid horizontal replica scaling across nodes.

**Demo: Test 1 (4 languages, flat files)**

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/submit-test-grader-jobs.sh
```

Then in Postman:
- `GET /jobs?limit=20`
- `GET /queue/status` (watch pending/processing change briefly)

Handoff: “Now we’ll demo real-world zip submissions (folder structure) and payload artifacts.”

---

## Speaker 4 (4–5 min): Zip submissions + payload zip download

### What the system supports

- **True folder structure** via a **single zip upload** in the `files` field.
- The server safely extracts zips (zip-slip protections + size/file-count caps).
- Graders always write `results.json`.
- Any other file in `/grading/output/` becomes a **payload artifact** (e.g., `payload-*.zip`).

### Demo: Test 2 (zip submissions that return payload zip)

Run:

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/demo-test2-zip-payloads.sh
```

Pick a returned `job_id` and in Postman:
- `GET /api/v1/jobs/<id>` until `status=completed`
- `GET /api/v1/jobs/<id>/payload`

**Important**
- The payload response is **binary**. In Postman, use “Save Response” and save as `payload.zip`, then unzip locally to show contents (e.g., `metadata.txt`, `run.log`).

### Demo (optional): Test 3 (10 zip submissions, same grader)

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
COUNT=10 CONCURRENCY=5 \
./scripts/demo-test3-10-zip-payloads.sh
```

Then show queue drain:
- `GET /api/v1/queue/status`
- `GET /api/v1/metrics/overview`

Handoff: “We’ll close with security/isolation, known limitations, and next steps.”

---

## Speaker 5 (2–3 min): Security + limitations + next steps

**Say**
- Isolation: each submission runs in its own pod with CPU/memory limits and a hard timeout.
- Grading pods do not need cluster access; service account tokens are not mounted.
- Payloads persist (for a retention window) so clients can download artifacts after completion.

**Limitations**
- Full horizontal autoscaling across nodes is constrained by Discovery’s **RWO** storage model for submissions.
- The current safe scaling mechanism is increasing concurrency rather than scaling replicas.

**Next steps (if environment allowed)**
- Object storage for submissions/artifacts (e.g., MinIO/S3) would unlock true worker autoscaling (KEDA/HPA).
- NetworkPolicy for graders to block egress by default, plus tighter pod security settings.

---

## Appendix: useful commands

### Register new image configs (DB only)

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
./scripts/register-image-configs.sh
```

### Submit N jobs for one grader (file or directory)

```bash
BASE_URL="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1" \
CONCURRENCY=10 OUT_DIR=./tmp/submit-n \
./scripts/submit-n-jobs.sh 10 \
  "ghcr.io/sytraore/job-queue-scheduler/test-grader-java8-zip:latest" \
  "test-graders/java8/sample-submission-java8.zip"
```

### List failed jobs

```bash
BASE="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1"
curl -sS -H "X-API-Key: $SERVICE_API_KEY" "$BASE/jobs?status=failed&limit=50"
```

