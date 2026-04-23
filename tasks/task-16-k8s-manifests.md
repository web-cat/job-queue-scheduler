# Task 16: Kubernetes Manifests & Deployment Config

**Status:** Completed
**Assignee:** Sy
**Priority:** LOW — do this last, after everything works locally
**Dependencies:** All other tasks (this deploys what they build)

## Context

Everything runs on Endeavour, a single CS department server running k3s. This task creates the K8s manifests and deployment tooling to go from "works on docker-compose" to "runs on Endeavour."

## What to Build

### 1. Directory Structure

```
infra/
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── dispatcher-deployment.yaml
│   ├── postgres-statefulset.yaml    (if running PG as a pod)
│   ├── postgres-service.yaml
│   ├── pv-submissions.yaml
│   └── network-policy.yaml
├── Makefile
└── README.md
```

### 2. Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: webcat
```

### 3. ConfigMap

Non-sensitive configuration:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: webcat-config
  namespace: webcat
data:
  NODE_ENV: "production"
  PORT: "3333"
  DB_HOST: "postgres-service"
  DB_PORT: "5432"
  DB_DATABASE: "webcat"
  SUBMISSIONS_PATH: "/data/submissions"
  ENABLE_DISPATCHER: "true"
  LOG_LEVEL: "info"
```

### 4. Secret

Sensitive configuration:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: webcat-secrets
  namespace: webcat
type: Opaque
stringData:
  DB_USER: "webcat_admin"
  DB_PASSWORD: "CHANGE_ME_IN_PRODUCTION"
  APP_KEY: "GENERATE_A_REAL_KEY"
```

### 5. API Deployment + Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webcat-api
  namespace: webcat
spec:
  replicas: 1
  selector:
    matchLabels:
      app: webcat-api
  template:
    metadata:
      labels:
        app: webcat-api
    spec:
      containers:
        - name: api
          image: webcat/execution-service:latest
          ports:
            - containerPort: 3333
          envFrom:
            - configMapRef:
                name: webcat-config
            - secretRef:
                name: webcat-secrets
          env:
            - name: ENABLE_DISPATCHER
              value: "false"    # API pod does NOT run the dispatcher
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /api/v1/health
              port: 3333
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/v1/health
              port: 3333
            initialDelaySeconds: 5
            periodSeconds: 10
          volumeMounts:
            - name: submissions
              mountPath: /data/submissions
      volumes:
        - name: submissions
          hostPath:
            path: /data/webcat/submissions
            type: DirectoryOrCreate
```

Service to expose the API:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: webcat-api-service
  namespace: webcat
spec:
  type: NodePort
  selector:
    app: webcat-api
  ports:
    - port: 3333
      targetPort: 3333
      nodePort: 30333    # accessible at endeavour:30333
```

### 6. Dispatcher Deployment

Same image as the API but with `ENABLE_DISPATCHER=true`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webcat-dispatcher
  namespace: webcat
spec:
  replicas: 1    # only one dispatcher
  selector:
    matchLabels:
      app: webcat-dispatcher
  template:
    metadata:
      labels:
        app: webcat-dispatcher
    spec:
      serviceAccountName: webcat-dispatcher-sa    # needs K8s API access
      containers:
        - name: dispatcher
          image: webcat/execution-service:latest
          envFrom:
            - configMapRef:
                name: webcat-config
            - secretRef:
                name: webcat-secrets
          env:
            - name: ENABLE_DISPATCHER
              value: "true"
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
          volumeMounts:
            - name: submissions
              mountPath: /data/submissions
      volumes:
        - name: submissions
          hostPath:
            path: /data/webcat/submissions
            type: DirectoryOrCreate
```

### 7. Dispatcher ServiceAccount + RBAC

The dispatcher needs permission to create/delete/watch K8s Jobs and Pods:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: webcat-dispatcher-sa
  namespace: webcat
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: webcat-dispatcher-role
  namespace: webcat
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: webcat-dispatcher-binding
  namespace: webcat
subjects:
  - kind: ServiceAccount
    name: webcat-dispatcher-sa
    namespace: webcat
roleRef:
  kind: Role
  name: webcat-dispatcher-role
  apiGroup: rbac.authorization.k8s.io
```

### 8. Network Policy (optional, depends on k3s CNI)

Block egress for grading pods:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: grading-pods-no-egress
  namespace: webcat
spec:
  podSelector:
    matchLabels:
      app: grading-worker
  policyTypes:
    - Egress
  egress: []    # empty = block all egress
```

### 9. Makefile

```makefile
NAMESPACE = webcat

.PHONY: deploy destroy status logs

deploy:
	kubectl apply -f infra/k8s/namespace.yaml
	kubectl apply -f infra/k8s/configmap.yaml
	kubectl apply -f infra/k8s/secret.yaml
	kubectl apply -f infra/k8s/pv-submissions.yaml
	kubectl apply -f infra/k8s/api-deployment.yaml
	kubectl apply -f infra/k8s/api-service.yaml
	kubectl apply -f infra/k8s/dispatcher-deployment.yaml
	kubectl apply -f infra/k8s/network-policy.yaml
	@echo "Deployed. API available at http://localhost:30333"

destroy:
	kubectl delete namespace $(NAMESPACE) --ignore-not-found

status:
	kubectl get all -n $(NAMESPACE)

logs-api:
	kubectl logs -f deployment/webcat-api -n $(NAMESPACE)

logs-dispatcher:
	kubectl logs -f deployment/webcat-dispatcher -n $(NAMESPACE)
```

### 10. Deployment Documentation

Create `docs/DEPLOYMENT.md` covering:
- Prerequisites (k3s installed, Docker images built and available)
- How to build and push the Docker image
- How to configure secrets for production
- Step-by-step deployment commands
- How to verify the deployment is working
- How to update the deployment (rolling update)
- How to rollback
- How to check logs
- Troubleshooting common issues

## Acceptance Criteria

- [ ] `make deploy` successfully deploys all resources to k3s
- [ ] API pod starts and responds to health checks
- [ ] Dispatcher pod starts and can create grading Job pods
- [ ] Grading pods can read files from the shared hostPath volume
- [ ] RBAC allows dispatcher to manage Jobs and Pods
- [ ] `make destroy` cleanly removes everything
- [ ] `make status` shows all running resources
- [ ] Deployment documentation is clear enough for someone unfamiliar with the system
