# Deploying the execution service on Kubernetes (k3s)

This guide covers deploying the AdonisJS execution service from `execution-service/` onto Kubernetes using the manifests in `infra/k8s/` and `infra/Makefile`.

## Prerequisites

- A working cluster with `kubectl` pointed at it (for example [k3s](https://k3s.io/) on a single department server).
- Docker (or another OCI builder) to build the API image.
- The `webcat/execution-service` image available to every node that can run the API or dispatcher (push to a registry nodes can pull from, or `docker save` / `k3s ctr images import` on the node).
- Host directories (used by the bundled Postgres and submission `PersistentVolume`):
  - `/data/webcat/postgres` — Postgres data
  - `/data/webcat/submissions` — shared submission files for the API, dispatcher, and grading Job pods (hostPath-backed PV)

## Build and push the image

From the repository root:

```bash
docker build -t webcat/execution-service:latest -f execution-service/Dockerfile execution-service
```

Tag and push to your registry if nodes do not build locally, for example:

```bash
docker tag webcat/execution-service:latest <registry>/webcat/execution-service:latest
docker push <registry>/webcat/execution-service:latest
```

Then set `image:` in `infra/k8s/api-deployment.yaml` and `infra/k8s/dispatcher-deployment.yaml` to that reference.

## Configure secrets for production

`infra/k8s/secret.yaml` is gitignored. Copy the tracked template, then edit **before** `make deploy`:

```bash
cp infra/k8s/secret.example.yaml infra/k8s/secret.yaml
```

Alternatively, maintain secrets outside Git (Sealed Secrets, External Secrets, `kubectl create secret`, and so on):

- `DB_PASSWORD` / `POSTGRES_PASSWORD` — strong password; must stay in sync with Postgres.
- `DB_USER` / `POSTGRES_USER` — database role (defaults are aligned in the sample file).
- `POSTGRES_DB` / `DB_NAME` — must match the ConfigMap `DB_NAME` (`webcat`).
- `APP_KEY` — generate with `cd execution-service && node ace generate:key` and paste the value. Rotating this key invalidates existing encrypted cookies and similar data.

Never commit production credentials. Prefer Sealed Secrets, External Secrets, or `kubectl create secret generic` with `--from-literal` in a secure pipeline.

## Deploy

```bash
cd infra
make deploy
```

This applies namespace `webcat`, ConfigMap, Secret, submission PV/PVC, Postgres Service + Deployment, dispatcher RBAC, API + dispatcher Deployments, API NodePort service, and the optional grading network policy.

### Database migrations

After the first successful deploy (Postgres ready, API pod running):

```bash
cd infra
make migrate
```

## Verify the deployment

1. **Pods**

   ```bash
   kubectl get pods -n webcat
   ```

   Expect `postgres`, `webcat-api`, and `webcat-dispatcher` in `Running` (dispatcher may restart until Postgres and migrations exist).

2. **Health**

   The API Service is `NodePort` **30333**. From a machine that can reach a cluster node:

   ```bash
   curl -sS "http://<node-ip>:30333/api/v1/health"
   ```

3. **Dispatcher**

   ```bash
   make logs-dispatcher
   ```

   Confirm it connects to the database and, when jobs exist, interacts with the Kubernetes API (no repeated permission errors).

4. **Grading jobs**

   Grading pods use `hostPath` volumes rooted under `K8S_SUBMISSIONS_ROOT` / `K8S_OUTPUT_ROOT` (both set to `/data/submissions` in the ConfigMap). The API and dispatcher mount the same PVC at `/data/submissions`, so paths written by the API are visible to worker pods on the **same node** as the PV hostPath.

## Update the deployment (rolling update)

After pushing a new image tag:

```bash
kubectl set image deployment/webcat-api api=<registry>/webcat/execution-service:<new-tag> -n webcat
kubectl set image deployment/webcat-dispatcher dispatcher=<registry>/webcat/execution-service:<new-tag> -n webcat
```

Or edit `image:` in the YAML and run:

```bash
kubectl apply -f infra/k8s/api-deployment.yaml
kubectl apply -f infra/k8s/dispatcher-deployment.yaml
```

Watch rollout:

```bash
kubectl rollout status deployment/webcat-api -n webcat
kubectl rollout status deployment/webcat-dispatcher -n webcat
```

## Rollback

```bash
kubectl rollout undo deployment/webcat-api -n webcat
kubectl rollout undo deployment/webcat-dispatcher -n webcat
```

## Logs

```bash
cd infra
make logs-api
make logs-dispatcher
```

## Remove everything

```bash
cd infra
make destroy
```

This deletes the `webcat` namespace and its resources. The hostPath directories on the node are **not** removed automatically.

## Troubleshooting

| Symptom | Things to check |
|--------|-------------------|
| `ImagePullBackOff` | Image name, registry auth, or import the image on the node. |
| API pod `CrashLoopBackOff` | `kubectl logs deployment/webcat-api -n webcat` — often missing/invalid `APP_KEY`, wrong `DB_*`, or migrations not run. |
| Dispatcher `Forbidden` on Jobs/Pods | RBAC: `kubectl describe rolebinding webcat-dispatcher-binding -n webcat` and confirm the pod uses `serviceAccountName: webcat-dispatcher-sa`. |
| Grading pod cannot see files | All pods must schedule on the node that owns `/data/webcat/submissions` (single-node k3s is the intended layout). |
| `Pending` PVC | PV capacity and `storageClassName` must match the PVC; hostPath PV is node-local. |
| Network policy has no effect | k3s with some CNIs may not enforce `NetworkPolicy` egress; treat `network-policy.yaml` as optional hardening. |

## Related documentation

- [Architecture](./ARCHITECTURE.md)
- [API endpoints](./API_ENDPOINTS.md)
- Task spec: `tasks/task-16-k8s-manifests.md`
