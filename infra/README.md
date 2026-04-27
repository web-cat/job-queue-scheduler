# Infra (Discovery) — Ops Notes

## Fresh restart (wipe PVC contents)

This procedure keeps the **same PVCs** but deletes their contents for a clean restart:
- **Submissions PVC**: clears uploaded submissions and payloads.
- **Postgres PVC**: deletes the entire database data directory (full reset).

This is preferred over deleting/recreating PVCs on Discovery, since PVC deletion can get stuck in `Terminating` due to PVC protection and live mounts.

### Names (from this repo’s manifests)

- **Namespace**: `cs4094-22646-s26-web-cat-execution-service`
- **API/dispatcher deployment**: `webcat-execution-service-api` (see `infra/api-dispatcher-deployment.yaml`)
- **Postgres deployment**: `postgres-db` (see `infra/db-deployment.yaml`)
- **Submissions PVC**: `webcat-submissions-pvc` (see `infra/api-dispatcher-deployment.yaml`)
- **Postgres PVC**: `webcat-execution-service-pgdata` (see `infra/db-deployment.yaml`)

---

## Step 1: Scale down workloads that mount PVCs

```bash
NS="cs4094-22646-s26-web-cat-execution-service"

kubectl -n "$NS" scale deploy/webcat-execution-service-api --replicas=0
kubectl -n "$NS" scale deploy/postgres-db --replicas=0

kubectl -n "$NS" get pods
```

Wait until the pods are gone before wiping.

---

## Step 2: Wipe the submissions PVC

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

```bash
NS="cs4094-22646-s26-web-cat-execution-service"

kubectl -n "$NS" scale deploy/postgres-db --replicas=1
kubectl -n "$NS" rollout status deploy/postgres-db

kubectl -n "$NS" scale deploy/webcat-execution-service-api --replicas=1
kubectl -n "$NS" rollout status deploy/webcat-execution-service-api
```

Sanity checks:
- `GET /api/v1/health`
- `GET /api/v1/queue/status`

