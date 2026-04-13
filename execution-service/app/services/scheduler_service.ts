import type Job from '#models/job'
import { HrrnStrategy } from './strategies/hrrn_strategy.js'

export class SchedulerService {
  private strategy = new HrrnStrategy()

  async dequeueNext(workerId: string): Promise<Job | null> {
    return this.strategy.dequeueNext(workerId)
  }
}

export default new SchedulerService()
