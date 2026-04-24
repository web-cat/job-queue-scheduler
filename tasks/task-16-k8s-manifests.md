# Task 16: Kubernetes Manifests & Deployment Config

**Status:** Completed
**Assignee:** Sy
**Priority:** LOW — do this last, after everything works locally
**Dependencies:** All other tasks (this deploys what they build)

## Context

This task is about turning “it works locally (docker-compose)” into “it runs on Kubernetes”.

Originally, this task targeted **Endeavour (single-node k3s)**, where `hostPath` volumes are a reasonable default. During deployment, we adapted the work to **Discovery (Virginia Tech)**, which requires:

- **Ingress** for external access
- **Dynamically provisioned PVCs** (no `hostPath`)
- A storage class (`ceph-rbd`) that is **ReadWriteOnce (RWO)**, which strongly influences pod topology
- **Restricted RBAC** (e.g. `pods/log` cannot have `delete`)

Because of Discovery’s RWO constraint, the “separate dispatcher Deployment” pattern becomes problematic if both API and dispatcher need to mount the same submissions volume. The final architecture uses a **sidecar dispatcher** in the same Pod as the API.

## What to Build

### 1) Deliverables (what must exist in-repo)

These files are the “source of truth” for how the execution service is deployed on Discovery:

```
infra/
├── api-dispatcher-deployment.yaml   # API + dispatcher sidecar + initContainer(migrate) + Service + Ingress + submissions PVC
├── dispatcher-rbac.yaml             # ServiceAccount + Role + RoleBinding for dispatcher (Discovery-compliant verbs)
└── db-deployment.yaml               # Postgres Deployment + Service + pgdata PVC

docs/
└── DEPLOYMENT.md                    # how to build/push + deploy + debug
```

> Note: earlier task templates referenced `infra/k8s/*`. In this repo, we consolidated to `infra/*.yaml`.

### 2) Kubernetes resources to define (Discovery)

**A) PostgreSQL (`infra/db-deployment.yaml`)**

- **PVC** for pgdata (RWO, `ceph-rbd`)
- **Deployment** `postgres-db`
- **Service** `db-service` (ClusterIP)
- Reads `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB` from `database-secrets`

**B) Execution service (API + dispatcher in one Pod) (`infra/api-dispatcher-deployment.yaml`)**

- **PVC** for submissions (RWO, `ceph-rbd`)
- **Deployment** `webcat-execution-service-api`
  - `strategy.type: Recreate` (required for RWO PVC)
  - `imagePullSecrets: registry-credential` (GHCR pull)
  - `serviceAccountName: webcat-dispatcher-sa`
  - `initContainer: migrate` runs `node ace.js migration:run --force`
  - **API container** runs HTTP server; `ENABLE_DISPATCHER=false`
  - **Dispatcher container (sidecar)** runs `node ace.js dispatcher:run`; `ENABLE_DISPATCHER=true`
  - Both containers mount submissions PVC at `/data/submissions`
  - Both containers set:
    - `K8S_NAMESPACE` to Discovery namespace
    - `K8S_SUBMISSIONS_PVC` to the submissions PVC name
    - `APP_URL` to the Discovery ingress hostname (`*.discovery.cs.vt.edu`)
- **Service** `webcat-execution-service-api` (ClusterIP)
- **Ingress** routes host `web-cat-execution-service.discovery.cs.vt.edu` → service port 3333

**C) Dispatcher RBAC (`infra/dispatcher-rbac.yaml`)**

- **ServiceAccount** `webcat-dispatcher-sa`
- **Role** allowing:
  - `batch/jobs`: `create,delete,get,list,watch`
  - `pods`: `get,list,watch,delete`
  - `pods/log`: **`get` only** (Discovery restriction)
- **RoleBinding** binding SA → Role in the namespace

### 3) Required application-level changes (Discovery compatibility)

These changes are needed so the runtime behavior matches Discovery constraints:

- **No-port-conflict dispatcher entrypoint**
  - Add `execution-service/commands/dispatcher_run.ts` with Ace command `dispatcher:run`
  - Must *not* start an HTTP server
  - Must set `static options = { startApp: true }` so Lucid/providers boot

- **Grading Jobs must mount PVC/subPath (not hostPath)**
  - Update `execution-service/app/services/k8s_service.ts` so `createGradingJob()`:
    - uses PVC + `subPath` when `K8S_SUBMISSIONS_PVC` is set
    - retains `hostPath` fallback for non-Discovery environments

### 4) Docker image requirements

- Must build/push an image usable on Discovery nodes:
  - `docker buildx build --platform linux/amd64 ... --push`
- Image must contain the production build artifacts (including `ace.js`)

### 5) Documentation requirements

`docs/DEPLOYMENT.md` should cover (at minimum):

- Prereqs for Discovery (namespace, secrets, registry credentials, storageclass expectations)
- How to build/push the `linux/amd64` image to GHCR
- How to apply manifests in `infra/`
- How to confirm health (`/api/v1/health`)
- How to read logs for `api` vs `dispatcher` containers
- Troubleshooting:
  - migrations not run (and initContainer behavior)
  - Multi-attach PVC / why `Recreate` is required
  - Ingress/DNS hostname rules on Discovery
  - RBAC permission failures
  - grading Job mount issues

> Optional (original Endeavour/k3s scope): Makefile wrappers and NetworkPolicy are useful in a single-node k3s environment, but were not required for the Discovery deployment path captured in this repo.

## Acceptance Criteria

- [ ] `kubectl apply -f infra/db-deployment.yaml` results in a ready Postgres pod and `db-service` resolves in-cluster
- [ ] `kubectl apply -f infra/dispatcher-rbac.yaml` applies cleanly in Discovery (no forbidden RBAC verbs)
- [ ] `kubectl apply -f infra/api-dispatcher-deployment.yaml` produces a ready pod with:
  - [ ] initContainer migrations completed successfully
  - [ ] API container ready and serving `/api/v1/health`
  - [ ] dispatcher sidecar running without port conflicts
- [ ] Deployment uses correct Discovery ingress hostname (`*.discovery.cs.vt.edu`)
- [ ] Deployment uses RWO-safe strategy (`Recreate`)
- [ ] Dispatcher can create and manage grading `Job`s in the configured namespace (RBAC works)
- [ ] Grading Jobs use PVC/subPath mounting when `K8S_SUBMISSIONS_PVC` is set (no `hostPath` dependency on Discovery)
- [ ] Documentation in `docs/DEPLOYMENT.md` is sufficient for a clean redeploy/debug cycle
