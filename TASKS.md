# Task Tracker

## How to Use

1. Pick an unassigned task that has its dependencies met
2. Write your name next to it
3. Create a branch: `feature/task-XX-short-description`
4. Tell Claude Code: "Read CLAUDE.md and then read tasks/task-XX-whatever.md and implement it"
5. Check off the task when done and PR is merged

---

## Foundation (do these first)

- [ ] [Task 1: Update Database Schema & Migrations](tasks/task-01-update-schema.md) — **Assignee:**
- [ ] [Task 2: Documentation Setup](tasks/task-02-docs-setup.md) — **Assignee:**

## API Endpoints (can be done in parallel after Task 1)

- [ ] [Task 3: Job Submission Endpoint](tasks/task-03-job-submission.md) — **Assignee:**
- [ ] [Task 4: Job Status & Results Endpoints](tasks/task-04-job-status-results.md) — **Assignee:**
- [ ] [Task 5: Queue Endpoints](tasks/task-05-queue-endpoints.md) — **Assignee:**
- [ ] [Task 6: Image Config CRUD Endpoints](tasks/task-06-image-config-crud.md) — **Assignee:**
- [ ] [Task 7: System Config & Metrics Endpoints](tasks/task-07-config-metrics.md) — **Assignee:**

## Core Services (can start after Task 1)

- [ ] [Task 8: HRRN Scheduler Service](tasks/task-08-hrrn-scheduler.md) — **Assignee:**
- [ ] [Task 9: Job Lifecycle Service](tasks/task-09-job-lifecycle.md) — **Assignee:**
- [ ] [Task 10: Timeout & Cleanup Background Service](tasks/task-10-timeout-cleanup.md) — **Assignee:**
- [ ] [Task 11: Callback/Webhook Service](tasks/task-11-callback-service.md) — **Assignee:**

## Dispatcher & Kubernetes (depends on Tasks 8, 9, 13, 14)

- [ ] [Task 12: Dispatcher Service — Core Loop](tasks/task-12-dispatcher.md) — **Assignee:**
- [ ] [Task 13: Kubernetes Integration](tasks/task-13-k8s-integration.md) — **Assignee:**
- [ ] [Task 14: File Management Service](tasks/task-14-file-management.md) — **Assignee:**

## Testing & Deployment (do these last)

- [ ] [Task 15: Integration Tests](tasks/task-15-integration-tests.md) — **Assignee:**
- [ ] [Task 16: Kubernetes Manifests & Deployment](tasks/task-16-k8s-manifests.md) — **Assignee:**

---

## Dependency Graph

```
Task 1 (Schema) ──┬──→ Task 3 (Job Submit)
                   ├──→ Task 4 (Job Status)
Task 2 (Docs)      ├──→ Task 5 (Queue)
  (parallel)       ├──→ Task 6 (Image Config)
                   ├──→ Task 7 (Config/Metrics)
                   ├──→ Task 8 (HRRN Scheduler)
                   ├──→ Task 9 (Job Lifecycle)
                   ├──→ Task 10 (Timeout) ←── Task 9
                   ├──→ Task 11 (Callback) ←── Task 9
                   ├──→ Task 13 (K8s Integration)
                   └──→ Task 14 (File Management)

Tasks 8, 9, 13, 14 ──→ Task 12 (Dispatcher)

All tasks ──→ Task 15 (Integration Tests)
All tasks ──→ Task 16 (K8s Deployment)
```

## Suggested Team Distribution

With 5 teammates, here's one way to split the initial work (after Tasks 1 & 2 are done):

| Person | Tasks | Focus Area |
|---|---|---|
| Person A | 3, 14 | Job submission + file handling |
| Person B | 4, 5 | Job status, results, queue |
| Person C | 6, 7 | Image config, system config, metrics |
| Person D | 8, 9 | Scheduler + job lifecycle (core logic) |
| Person E | 10, 11, 13 | Background services + K8s integration |

Then everyone converges on Tasks 12, 15, 16 together.
