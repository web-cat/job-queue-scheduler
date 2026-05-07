# Infra (Discovery) — Ops Notes

This directory contains the Kubernetes manifests used on Virginia Tech Discovery.

## Quick reference

- **Namespace**: `cs4094-22646-s26-web-cat-execution-service`
- **API+dispatcher deployment**: `webcat-execution-service-api` (see `infra/api-dispatcher-deployment.yaml`)
- **Postgres deployment**: `postgres-db` (see `infra/db-deployment.yaml`)
- **Submissions PVC**: `webcat-submissions-pvc` (see `infra/api-dispatcher-deployment.yaml`)
- **Postgres PVC**: `webcat-execution-service-pgdata` (see `infra/db-deployment.yaml`)

---

## Deploy / redeploy on Discovery (day-to-day)

Some commands are meant to be run **on Discovery** (open kubectl shell on Discovery).

### 0) Prereqs (once per shell)

```bash
NS="cs4094-22646-s26-web-cat-execution-service"

kubectl config current-context
kubectl -n "$NS" get deploy
```

If `kubectl -n "$NS" get deploy` fails, fix your kubeconfig/context first.

---

## Redeploy: Postgres (`postgres-db`)

Use this after:

- editing `infra/db-deployment.yaml`
- changing DB secrets/PVC configuration
- wiping the Postgres PVC and needing a clean start

### Apply the manifest on Discovery
- click on **Edit YAML** for the `postgres-db` deployment
- click on **Read From File**
- upload `infra/db-deployment.yaml`
- click **Save**

Then wait for deployment to complete.

### Troubleshooting quick checks (open kubectl shell on Discovery)

```bash
NS="cs4094-22646-s26-web-cat-execution-service"

kubectl -n "$NS" get pods -l app=postgres-db -o wide
kubectl -n "$NS" logs deploy/postgres-db --tail=200
```

---

## Redeploy: API + dispatcher (`webcat-execution-service-api`)

This Deployment runs:

- **initContainer** `migrate` (runs DB migrations)
- container `api` (AdonisJS HTTP server)
- container `dispatcher` (poll loop that spawns grading Jobs)

Discovery storage is **ReadWriteOnce (RWO)**. To avoid multi-attach issues, keep this Deployment at **1 replica** unless you redesign storage.

### 1) Build and push the API image (developer machine)

**Note:** The current setup requires Sy's GitHub personal access token for authentication before pushing the api image to the repo's private registry. Future developers should put the image under a GitHub organization (or a shared “webcat” repo/package) so they can each authenticate with their own GitHub personal access tokens. Or use any other private registry. Please keep in mind to change the cluster imagePullSecret on Discovery if changes are ever made regarding images registry.

Make sure to be in job-queue-scheduler directory and run these commands from your laptop (not on Discovery). Replace tag as desired.
```bash
gh auth login
gh auth token | docker login ghcr.io -u sytraore --password-stdin

IMAGE="ghcr.io/sytraore/job-queue-scheduler/execution-service:latest"

docker buildx build \
  --platform linux/amd64 \
  -t "$IMAGE" \
  --push \
  ./execution-service
```

Notes:

- `--platform linux/amd64` is important because Discovery nodes run Linux/amd64.


### 2) Deploy the new image on Discovery

### Apply the manifest on Discovery
- click on **Edit YAML** for the `webcat-execution-service-api` deployment
- click on **Read From File**
- upload `infra/api-dispatcher-deployment.yaml`
- click **Save**

Then wait for deployment to complete.

### 3) Verify
Go to https://web-cat-execution-service.discovery.cs.vt.edu/api/v1/health and check json response.

Alternatively, run this in your terminal
```bash
BASE="https://web-cat-execution-service.discovery.cs.vt.edu/api/v1"
curl -sS "$BASE/health"
```

If rollout is stuck, check the initContainer first (migrations often reveal DB/PVC issues). Run these commmands on Discovery kubtl shell:

```bash
NS="cs4094-22646-s26-web-cat-execution-service"
POD="$(kubectl -n "$NS" get pods -l app=webcat-execution-service-api -o jsonpath='{.items[0].metadata.name}')"

kubectl -n "$NS" describe pod "$POD"
kubectl -n "$NS" logs "$POD" -c migrate --tail=200
```

---

## Fresh restart (wipe PVC contents)

This procedure keeps the **same PVCs** but deletes their contents for a clean restart:

- **Submissions PVC**: clears uploaded submissions and payloads.
- **Postgres PVC**: deletes the entire database data directory (full reset).

This is preferred over deleting/recreating PVCs on Discovery, since PVC deletion can get stuck in `Terminating` due to PVC protection and live mounts.

## Step 1: Scale down workloads that mount PVCs

Set the scale to **0** for both deployments.

Wait until the pods are gone before wiping.
Run this command on Discovery kubtl shell to check:
```bash
NS="cs4094-22646-s26-web-cat-execution-service"
kubectl -n "$NS" get pods
```

---

## Step 2: Wipe the submissions PVC

Run this command on Discovery kubtl shell

```bash
NS="cs4094-22646-s26-web-cat-execution-service"
SUBS_PVC="webcat-submissions-pvc"

kubectl -n "$NS" apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: wipe-submissions-pvc
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: wipe
          image: busybox:1.36
          command: ["sh","-c","set -eu; echo 'WIPING SUBMISSIONS PVC...'; rm -rf /wipe/*; echo 'DONE';"]
          volumeMounts:
            - name: subs
              mountPath: /wipe
      volumes:
        - name: subs
          persistentVolumeClaim:
            claimName: ${SUBS_PVC}
EOF

kubectl -n "$NS" logs -f job/wipe-submissions-pvc
kubectl -n "$NS" delete job/wipe-submissions-pvc
```

---

## Step 3: Wipe the Postgres PVC (FULL DB RESET)

Run this command on Discovery kubtl shell

```bash
NS="cs4094-22646-s26-web-cat-execution-service"
PG_PVC="webcat-execution-service-pgdata"

kubectl -n "$NS" apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: wipe-postgres-pvc
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: wipe
          image: busybox:1.36
          command: ["sh","-c","set -eu; echo 'WIPING POSTGRES PVC...'; rm -rf /pg/*; echo 'DONE';"]
          volumeMounts:
            - name: pg
              mountPath: /pg
      volumes:
        - name: pg
          persistentVolumeClaim:
            claimName: ${PG_PVC}
EOF

kubectl -n "$NS" logs -f job/wipe-postgres-pvc
kubectl -n "$NS" delete job/wipe-postgres-pvc
```

If the pod is stuck in `ContainerCreating`, inspect events:

```bash
kubectl -n "$NS" get pods -l job-name=wipe-postgres-pvc
POD="$(kubectl -n "$NS" get pods -l job-name=wipe-postgres-pvc -o jsonpath='{.items[0].metadata.name}')"
kubectl -n "$NS" describe pod "$POD"
```

---

## Step 4: Scale back up + verify

Set the scale to **1** for both deployments.


## Sanity Check
Go to https://web-cat-execution-service.discovery.cs.vt.edu/api/v1/health and check json response.
