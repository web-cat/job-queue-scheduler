import SystemSetting from '#models/system_setting'
import type Job from '#models/job'
import type { SchedulerStrategy } from './strategies/scheduler_strategy.js'
import { HrrnStrategy } from './strategies/hrrn_strategy.js'
import { FifoStrategy } from './strategies/fifo_strategy.js'
import { PriorityStrategy } from './strategies/priority_strategy.js'

const REFRESH_INTERVAL = 30_000 // ms

export class SchedulerService {
  private strategy: SchedulerStrategy = new HrrnStrategy()
  private activeStrategyName: string = 'HRRN'
  private lastRefreshedAt: number = 0

  async initialize(): Promise<void> {
    await this.refreshStrategy()
  }

  async dequeueNext(workerId: string): Promise<Job | null> {
    if (Date.now() - this.lastRefreshedAt >= REFRESH_INTERVAL) {
      await this.refreshStrategy()
    }
    return this.strategy.dequeueNext(workerId)
  }

  async getActiveStrategy(): Promise<string> {
    const setting = await SystemSetting.findBy('key', 'scheduler_strategy')
    return setting?.value ?? 'HRRN'
  }

  private async refreshStrategy(): Promise<void> {
    const name = await this.getActiveStrategy()
    if (name !== this.activeStrategyName) {
      this.strategy = this.buildStrategy(name)
      this.activeStrategyName = name
    }
    this.lastRefreshedAt = Date.now()
  }

  private buildStrategy(name: string): SchedulerStrategy {
    switch (name.toUpperCase()) {
      case 'FIFO':
        return new FifoStrategy()
      case 'PRIORITY':
        return new PriorityStrategy()
      default:
        return new HrrnStrategy()
    }
  }
}

export default new SchedulerService()
