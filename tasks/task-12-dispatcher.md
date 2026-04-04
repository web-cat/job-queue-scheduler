# Task 12: Dispatcher Service — Core Loop

**Status:** Not Started
**Assignee:** (pick up)
**Priority:** HIGH — this is what actually runs grading jobs
**Dependencies:** Task 8 (scheduler), Task 9 (lifecycle), Task 13 (K8s integration), Task 14 (file management)

## Context

The dispatcher is the main background process that connects the queue to Kubernetes. It polls for pending jobs, creates K8s pods to grade them, and processes the results.

## What to Build

### 1. Service: `app/services/dispatcher_service.ts`

**Main loop:**
```typescript
async run(): Promise<void> {
  while (this.isRunning) {
    try {
      // 1. Check capacity
      const activeCount = await this.k8sService.getActiveJobCount()
      const maxConcurrent = await this.getMaxConcurrentJobs() // from system_settings
      
      if (activeCount >= maxConcurrent) {
        await this.sleep(1000)
        continue
      }

      // 2. Dequeue next job using HRRN
      const job = await this.schedulerService.dequeueNext('dispatcher')
      if (!job) {
        await this.sleep(1000)
        continue
      }

      // 3. Process the job (don't await — run in background so we can dequeue more)
      this.processJob(job).catch(err => {
        logger.error(`Error processing job ${job.jobId}: ${err.message}`)
      })

    } catch (err) {
      logger.error(`Dispatcher loop error: ${err.message}`)
      await this.sleep(5000) // back off on errors
    }
  }
}
```

**Process a single job:**
```typescript
async processJob(job: Job): Promise<void> {
  const imageConfig = await job.related('imageConfig').query().firstOrFail()
  
  // 1. Ensure output directory exists
  await this.fileService.prepareOutputDirectory(job.jobId)
  
  // 2. Create K8s Job pod
  const podName = await this.k8sService.createGradingJob({
    jobId: job.jobId,
    dockerImageTag: job.dockerImageTag,
    inputPath: job.sourcePath,
    outputPath: this.fileService.getOutputPath(job.jobId),
    timeoutSeconds: imageConfig.timeoutSeconds,
    memoryLimitMb: imageConfig.memoryLimitMb,
    cpuLimitMillicores: imageConfig.cpuLimitMillicores,
  })
  
  // Update job with pod name
  job.workerPodName = podName
  await job.save()
  
  // 3. Wait for pod to complete
  const result = await this.k8sService.waitForJobCompletion(podName, imageConfig.timeoutSeconds)
  
  // 4. Process result
  if (result.succeeded) {
    const resultData = await this.fileService.readResults(job.jobId)
    const logs = await this.k8sService.getJobLogs(podName)
    await this.jobLifecycleService.markCompleted(job.jobId, {
      ...resultData,
      containerLogs: logs?.substring(0, 10240), // truncate to 10KB
      exitCode: result.exitCode,
      podName: podName,
    }, result.durationSeconds)
  } else {
    const logs = await this.k8sService.getJobLogs(podName)
    await this.jobLifecycleService.markFailed(
      job.jobId,
      `Container exited with code ${result.exitCode}. Logs: ${logs?.substring(0, 2048)}`
    )
  }
  
  // 5. Cleanup
  await this.k8sService.deleteJob(podName)
  await this.fileService.cleanupSubmission(job.jobId)
}
```

### 2. Graceful Shutdown

Handle SIGTERM/SIGINT:
- Set `this.isRunning = false`
- Wait for currently processing jobs to finish (with a timeout)
- Don't dequeue new jobs during shutdown

### 3. Startup

Register the dispatcher to start when the application boots:
- Only start if an environment variable `ENABLE_DISPATCHER=true` is set
- This allows running the API without the dispatcher during development
- Log: "Dispatcher started. Max concurrent jobs: {maxConcurrent}. Strategy: {strategy}"

## Important Notes

- The dispatcher calls `processJob` without awaiting so it can dequeue multiple jobs in parallel up to the concurrency limit
- Each `processJob` call is independent — one failure doesn't affect others
- The dispatcher should be resilient to K8s API errors (retry with backoff)
- During development without K8s, you can mock the k8sService to just sleep and return fake results

## Acceptance Criteria

- [ ] Dispatcher polls for pending jobs and creates K8s pods
- [ ] Respects max_concurrent_jobs from system_settings
- [ ] Processes multiple jobs in parallel
- [ ] Reads results from completed containers and stores them
- [ ] Handles container failures by calling markFailed (which handles retries)
- [ ] Cleans up K8s resources and files after each job
- [ ] Gracefully shuts down without losing in-progress work
- [ ] Only starts when ENABLE_DISPATCHER=true
