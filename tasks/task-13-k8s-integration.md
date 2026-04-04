# Task 13: Kubernetes Integration

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** HIGH — interfaces with K8s to run grading containers
**Dependencies:** Task 1

## Context

This service wraps the `@kubernetes/client-node` library and provides methods to create, monitor, and clean up K8s Job resources for grading.

## What to Build

### 1. Install dependency

```bash
npm install @kubernetes/client-node
```

### 2. Service: `app/services/k8s_service.ts`

**`initialize()`**
- Load kubeconfig (in-cluster config when running in K8s, local config for development)
- Create BatchV1Api and CoreV1Api clients
- Set the namespace (configurable via env var, default 'default')

**`createGradingJob(params)`**

Create a K8s Job resource:

```typescript
interface CreateGradingJobParams {
  jobId: number
  dockerImageTag: string
  inputPath: string    // host path to student files
  outputPath: string   // host path for results
  timeoutSeconds: number
  memoryLimitMb: number
  cpuLimitMillicores: number
}
```

The K8s Job manifest should include:
- Name: `grading-job-{jobId}`
- Label: `app=grading-worker, job-id={jobId}`
- Container image: `dockerImageTag`
- Volume mounts:
  - inputPath → /grading/submission/ (readOnly: true)
  - outputPath → /grading/output/
- Env vars: SUBMISSION_ID={jobId}, TIMEOUT={timeoutSeconds}
- Resource limits: memory={memoryLimitMb}Mi, cpu={cpuLimitMillicores}m
- Resource requests: set to 50% of limits
- activeDeadlineSeconds: timeoutSeconds + 30 (K8s-level timeout)
- restartPolicy: Never
- backoffLimit: 0 (we handle retries ourselves)

Security constraints (apply via securityContext):
- runAsNonRoot: true
- readOnlyRootFilesystem: true (except output mount and /tmp)
- allowPrivilegeEscalation: false

Network policy: If possible, apply a NetworkPolicy that blocks all egress for pods with label `app=grading-worker`. If NetworkPolicy isn't available on k3s, document this as a known limitation.

Return the pod name.

**`waitForJobCompletion(jobName, timeoutSeconds)`**

Watch the K8s Job until it succeeds, fails, or times out:
- Use the K8s watch API or poll every 2 seconds
- Return: `{ succeeded: boolean, exitCode: number, durationSeconds: number }`
- If the job doesn't complete within timeout + 60s, force-delete it and return failure

**`getActiveJobCount()`**
- List K8s Jobs with label `app=grading-worker` that are still active
- Return the count

**`getJobLogs(jobName)`**
- Get the pod associated with the Job
- Read its logs via CoreV1Api
- Return as string (truncated to 10KB if necessary)
- Return null if logs aren't available (pod already deleted, etc.)

**`deleteJob(jobName)`**
- Delete the K8s Job resource (with propagationPolicy: 'Foreground' to also delete the pod)
- Handle "not found" gracefully (job may have already been cleaned up)

### 3. Development Mock

Create `app/services/k8s_service_mock.ts` that implements the same interface but:
- `createGradingJob` — logs "Would create pod for job {id}" and returns a fake pod name
- `waitForJobCompletion` — sleeps for 3 seconds and returns success with exit code 0
- `getActiveJobCount` — returns 0
- `getJobLogs` — returns "Mock grading output"
- `deleteJob` — logs "Would delete pod {name}"

Use the mock when `NODE_ENV=development` or `USE_K8S_MOCK=true` so teammates can test the dispatcher without a real K8s cluster.

## Acceptance Criteria

- [ ] createGradingJob creates a properly configured K8s Job resource
- [ ] Volume mounts correctly map host paths to container paths
- [ ] Resource limits are applied from the params
- [ ] waitForJobCompletion correctly detects success and failure
- [ ] getActiveJobCount returns accurate count of running grading pods
- [ ] getJobLogs retrieves container output
- [ ] deleteJob cleans up both Job and Pod resources
- [ ] Mock service allows development without K8s
- [ ] Errors from the K8s API are handled gracefully (logged, not crashed)
