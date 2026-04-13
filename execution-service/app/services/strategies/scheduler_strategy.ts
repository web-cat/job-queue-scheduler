import type Job from '#models/job'

export interface SchedulerStrategy {
  dequeueNext(workerId: string): Promise<Job | null>
}
