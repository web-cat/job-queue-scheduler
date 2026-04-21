import logger from '@adonisjs/core/services/logger'
import type { CreateGradingJobParams, JobCompletionResult } from './k8s_service.js'

const MOCK_COMPLETION_DELAY_MS = 3000

/**
 * Mock K8s service for local development and CI environments where a real
 * Kubernetes cluster is not available.
 *
 * Activate by setting NODE_ENV=development or USE_K8S_MOCK=true.
 */
class K8sMockService {
  initialize(): void {
    logger.info('K8sMockService initialized (no real K8s cluster)')
  }

  getJobName(jobId: number): string {
    return `grading-job-${jobId}`
  }

  async createGradingJob(params: CreateGradingJobParams): Promise<string> {
    const jobName = this.getJobName(params.jobId)
    logger.info(
      {
        jobId: params.jobId,
        dockerImageTag: params.dockerImageTag,
        inputPath: params.inputPath,
        outputPath: params.outputPath,
      },
      `[MOCK] Would create K8s Job ${jobName}`
    )
    return jobName
  }

  async waitForJobCompletion(
    jobName: string,
    _timeoutSeconds: number
  ): Promise<JobCompletionResult> {
    logger.info({ jobName }, `[MOCK] Waiting ${MOCK_COMPLETION_DELAY_MS}ms for Job ${jobName}`)
    await new Promise<void>((resolve) => setTimeout(resolve, MOCK_COMPLETION_DELAY_MS))
    logger.info({ jobName }, `[MOCK] Job ${jobName} completed successfully`)
    return { succeeded: true, exitCode: 0, durationSeconds: MOCK_COMPLETION_DELAY_MS / 1000 }
  }

  async getActiveJobCount(): Promise<number> {
    return 0
  }

  async getJobLogs(_jobName: string): Promise<string | null> {
    return 'Mock grading output'
  }

  async deleteJob(jobName: string): Promise<void> {
    logger.info({ jobName }, `[MOCK] Would delete K8s Job ${jobName}`)
  }
}

export default new K8sMockService()
