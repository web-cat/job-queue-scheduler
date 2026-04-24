import * as k8s from '@kubernetes/client-node'
import logger from '@adonisjs/core/services/logger'
import path from 'node:path'

const MAX_LOG_BYTES = 10 * 1024 // 10KB

export interface CreateGradingJobParams {
  jobId: number
  dockerImageTag: string
  inputPath: string
  outputPath: string
  timeoutSeconds: number
  memoryLimitMb: number
  cpuLimitMillicores: number
}

export interface JobCompletionResult {
  succeeded: boolean
  exitCode: number
  durationSeconds: number
}

class K8sService {
  private batchApi!: k8s.BatchV1Api
  private coreApi!: k8s.CoreV1Api
  private namespace!: string
  private initialized = false

  initialize(): void {
    const kc = new k8s.KubeConfig()

    if (process.env.KUBERNETES_SERVICE_HOST) {
      // Running inside a K8s cluster
      kc.loadFromCluster()
    } else {
      // Local development — load from ~/.kube/config
      kc.loadFromDefault()
    }

    this.batchApi = kc.makeApiClient(k8s.BatchV1Api)
    this.coreApi = kc.makeApiClient(k8s.CoreV1Api)
    this.namespace = process.env.K8S_NAMESPACE || 'default'
    this.initialized = true

    logger.info({ namespace: this.namespace }, 'K8sService initialized')
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize()
    }
  }

  /**
   * Build the K8s Job name for a grading job.
   */
  getJobName(jobId: number): string {
    return `grading-job-${jobId}`
  }

  private resolveAndValidateHostPath(hostPath: string, rootEnvVar: string): string {
    const resolved = path.resolve(hostPath)

    const root = process.env[rootEnvVar]
    if (!root) {
      // We still normalize to an absolute path so the manifest is deterministic.
      return resolved
    }

    const resolvedRoot = path.resolve(root)
    const relative = path.relative(resolvedRoot, resolved)

    // Reject anything outside the configured root (including traversals).
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Refusing to mount hostPath outside ${rootEnvVar}. root=${resolvedRoot} path=${resolved}`
      )
    }

    return resolved
  }

  private get submissionsPvcName(): string | null {
    const raw = process.env.K8S_SUBMISSIONS_PVC
    return raw && raw.trim().length > 0 ? raw.trim() : null
  }

  private get imagePullSecretName(): string | null {
    const raw = process.env.K8S_IMAGE_PULL_SECRET
    return raw && raw.trim().length > 0 ? raw.trim() : null
  }

  private resolveAndValidateSubPath(absPath: string, rootAbsPath: string): string {
    const resolved = path.resolve(absPath)
    const resolvedRoot = path.resolve(rootAbsPath)
    const relative = path.relative(resolvedRoot, resolved)

    // Reject anything outside the configured root (including traversals).
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to mount path outside submissions root. root=${resolvedRoot} path=${resolved}`)
    }

    // K8s subPath must be a relative path.
    return relative
  }

  /**
   * Create a K8s Job resource to run the grading container.
   * Returns the Job name.
   */
  async createGradingJob(params: CreateGradingJobParams): Promise<string> {
    this.ensureInitialized()

    const {
      jobId,
      dockerImageTag,
      inputPath,
      outputPath,
      timeoutSeconds,
      memoryLimitMb,
      cpuLimitMillicores,
    } = params

    const resolvedInputPath = path.resolve(inputPath)
    const resolvedOutputPath = path.resolve(outputPath)

    const jobName = this.getJobName(jobId)

    const memoryRequest = `${Math.floor(memoryLimitMb / 2)}Mi`
    const memoryLimit = `${memoryLimitMb}Mi`
    const cpuRequest = `${Math.floor(cpuLimitMillicores / 2)}m`
    const cpuLimit = `${cpuLimitMillicores}m`

    const submissionsRoot = process.env.SUBMISSIONS_PATH ?? '/data/submissions'
    const pvcName = this.submissionsPvcName

    const volumes: k8s.V1Volume[] = [
      {
        name: 'tmp',
        emptyDir: {},
      },
    ]

    const volumeMounts: k8s.V1VolumeMount[] = [
      {
        name: 'tmp',
        mountPath: '/tmp',
        readOnly: false,
      },
    ]

    if (pvcName) {
      const inputSubPath = this.resolveAndValidateSubPath(resolvedInputPath, submissionsRoot)
      const outputSubPath = this.resolveAndValidateSubPath(resolvedOutputPath, submissionsRoot)

      volumes.unshift({
        name: 'submissions',
        persistentVolumeClaim: { claimName: pvcName, readOnly: false },
      })

      volumeMounts.unshift(
        {
          name: 'submissions',
          mountPath: '/grading/submission',
          subPath: inputSubPath,
          readOnly: true,
        },
        {
          name: 'submissions',
          mountPath: '/grading/output',
          subPath: outputSubPath,
          readOnly: false,
        }
      )
    } else {
      const hostInput = this.resolveAndValidateHostPath(resolvedInputPath, 'K8S_SUBMISSIONS_ROOT')
      const hostOutput = this.resolveAndValidateHostPath(resolvedOutputPath, 'K8S_OUTPUT_ROOT')

      volumes.unshift(
        { name: 'submission-input', hostPath: { path: hostInput, type: 'Directory' } },
        { name: 'grading-output', hostPath: { path: hostOutput, type: 'DirectoryOrCreate' } }
      )

      volumeMounts.unshift(
        { name: 'submission-input', mountPath: '/grading/submission', readOnly: true },
        { name: 'grading-output', mountPath: '/grading/output', readOnly: false }
      )
    }

    const manifest: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: this.namespace,
        labels: {
          app: 'grading-worker',
          'job-id': String(jobId),
        },
      },
      spec: {
        // K8s-level hard timeout: add 30s grace beyond the container timeout
        activeDeadlineSeconds: timeoutSeconds + 30,
        // We handle retries in application logic
        backoffLimit: 0,
        ttlSecondsAfterFinished: 300, // auto-clean after 5 minutes
        template: {
          metadata: {
            labels: {
              app: 'grading-worker',
              'job-id': String(jobId),
            },
          },
          spec: {
            restartPolicy: 'Never',
            // Discovery uses ceph-rbd which is RWO at the node-attachment level.
            // When we mount the same submissions PVC with subPath, the grading pod
            // must schedule onto the same node as the API/dispatcher pod that
            // already attached the volume, otherwise we hit Multi-Attach errors.
            affinity: pvcName
              ? {
                  podAffinity: {
                    requiredDuringSchedulingIgnoredDuringExecution: [
                      {
                        labelSelector: {
                          matchExpressions: [
                            {
                              key: 'app',
                              operator: 'In',
                              values: ['webcat-execution-service-api'],
                            },
                          ],
                        },
                        topologyKey: 'kubernetes.io/hostname',
                      },
                    ],
                  },
                }
              : undefined,
            // Disable all automounted service-account tokens — grading pods
            // have no reason to talk to the K8s API.
            automountServiceAccountToken: false,
            ...(this.imagePullSecretName
              ? { imagePullSecrets: [{ name: this.imagePullSecretName }] }
              : {}),
            volumes,
            containers: [
              {
                name: 'grader',
                image: dockerImageTag,
                env: [
                  { name: 'SUBMISSION_ID', value: String(jobId) },
                  { name: 'TIMEOUT', value: String(timeoutSeconds) },
                ],
                resources: {
                  requests: { memory: memoryRequest, cpu: cpuRequest },
                  limits: { memory: memoryLimit, cpu: cpuLimit },
                },
                volumeMounts,
                securityContext: {
                  runAsNonRoot: true,
                  readOnlyRootFilesystem: true,
                  allowPrivilegeEscalation: false,
                },
              },
            ],
          },
        },
      },
    }

    try {
      await this.batchApi.createNamespacedJob({ namespace: this.namespace, body: manifest })
      logger.info({ jobId, jobName }, `Created K8s Job ${jobName}`)
      return jobName
    } catch (error) {
      logger.error({ jobId, jobName, error }, `Failed to create K8s Job ${jobName}`)
      throw error
    }
  }

  /**
   * Poll the K8s Job until it succeeds, fails, or the deadline passes.
   */
  async waitForJobCompletion(
    jobName: string,
    timeoutSeconds: number
  ): Promise<JobCompletionResult> {
    this.ensureInitialized()

    const hardDeadline = Date.now() + (timeoutSeconds + 60) * 1000
    const pollIntervalMs = 2000
    const startedAt = Date.now()

    while (Date.now() < hardDeadline) {
      try {
        const { status } = await this.batchApi.readNamespacedJob({
          name: jobName,
          namespace: this.namespace,
        })

        if (status?.succeeded && status.succeeded > 0) {
          const durationSeconds = (Date.now() - startedAt) / 1000
          logger.info({ jobName, durationSeconds }, `K8s Job ${jobName} succeeded`)
          return { succeeded: true, exitCode: 0, durationSeconds }
        }

        if (status?.failed && status.failed > 0) {
          const durationSeconds = (Date.now() - startedAt) / 1000
          const exitCode = await this.getPodExitCode(jobName)
          logger.warn(
            { jobName, exitCode, durationSeconds },
            `K8s Job ${jobName} failed with exit code ${exitCode}`
          )
          return { succeeded: false, exitCode, durationSeconds }
        }
      } catch (error: any) {
        if (error?.response?.statusCode === 404) {
          // Job was already cleaned up externally
          logger.warn({ jobName }, `K8s Job ${jobName} not found while polling`)
          return { succeeded: false, exitCode: -1, durationSeconds: (Date.now() - startedAt) / 1000 }
        }
        logger.error({ jobName, error }, `Error polling K8s Job ${jobName}`)
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    // Hard deadline exceeded — force-delete and return failure
    logger.error({ jobName }, `K8s Job ${jobName} exceeded hard deadline, force-deleting`)
    try {
      await this.deleteJob(jobName, { force: true })
    } catch (error) {
      // Cleanup failures shouldn't mask the timeout result.
      logger.warn({ jobName, error }, `Failed to cleanup timed-out K8s Job ${jobName}`)
    }
    return {
      succeeded: false,
      exitCode: 124, // Matches timeout exit code convention
      durationSeconds: (Date.now() - startedAt) / 1000,
    }
  }

  /**
   * Read the exit code from the pod that ran a Job.
   */
  private async getPodExitCode(jobName: string): Promise<number> {
    try {
      const { items } = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `job-name=${jobName}`,
      })

      const pod = items?.[0]
      const containerStatus = pod?.status?.containerStatuses?.[0]
      return containerStatus?.state?.terminated?.exitCode ?? 1
    } catch {
      return 1
    }
  }

  /**
   * Count active (non-terminal) grading Job pods.
   */
  async getActiveJobCount(): Promise<number> {
    this.ensureInitialized()

    try {
      const { items } = await this.batchApi.listNamespacedJob({
        namespace: this.namespace,
        labelSelector: 'app=grading-worker',
      })

      const activeJobs = items.filter((job: k8s.V1Job) => {
        const { active, succeeded, failed } = job.status ?? {}
        // A job is active if it has running pods and hasn't finished
        return (active ?? 0) > 0 || (!succeeded && !failed)
      })

      return activeJobs.length
    } catch (error) {
      logger.error({ error }, 'Failed to get active K8s job count')
      return 0
    }
  }

  /**
   * Fetch logs from the pod that ran the given Job.
   * Returns null if logs are unavailable.
   */
  async getJobLogs(jobName: string): Promise<string | null> {
    this.ensureInitialized()

    try {
      const { items } = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `job-name=${jobName}`,
      })

      const pod = items?.[0]
      if (!pod?.metadata?.name) {
        return null
      }

      const logs = await this.coreApi.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace: this.namespace,
        container: 'grader',
      })

      if (typeof logs !== 'string') {
        return null
      }

      // Truncate to MAX_LOG_BYTES
      if (Buffer.byteLength(logs, 'utf8') > MAX_LOG_BYTES) {
        return Buffer.from(logs, 'utf8').subarray(0, MAX_LOG_BYTES).toString('utf8')
      }

      return logs
    } catch (error) {
      logger.warn({ jobName, error }, `Could not retrieve logs for K8s Job ${jobName}`)
      return null
    }
  }

  /**
   * Delete a K8s Job and its associated pod(s).
   * Uses Foreground propagation so the pod is deleted before the Job object.
   * Silently ignores 404 — the job may have already been cleaned up.
   */
  async deleteJob(jobName: string, options?: { force?: boolean }): Promise<void> {
    this.ensureInitialized()

    try {
      const force = options?.force === true
      await this.batchApi.deleteNamespacedJob({
        name: jobName,
        namespace: this.namespace,
        // DeleteOptions:
        // - Foreground: ensures pods are removed alongside the Job object.
        // - gracePeriodSeconds=0: best-effort "force" delete for stuck workloads.
        body: {
          propagationPolicy: 'Foreground',
          ...(force ? { gracePeriodSeconds: 0 } : {}),
        },
      })
      logger.info({ jobName, force }, `Deleted K8s Job ${jobName}`)
    } catch (error: any) {
      if (error?.response?.statusCode === 404) {
        // Already gone — not an error
        logger.debug({ jobName }, `K8s Job ${jobName} already deleted`)
        return
      }
      logger.error({ jobName, error }, `Failed to delete K8s Job ${jobName}`)
      throw error
    }
  }
}

export default new K8sService()
