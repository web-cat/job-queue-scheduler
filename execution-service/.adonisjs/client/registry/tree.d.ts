/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  jobs: {
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    results: typeof routes['jobs.results']
    destroy: typeof routes['jobs.destroy']
  }
  queue: {
    status: typeof routes['queue.status']
    position: typeof routes['queue.position']
  }
  config: {
    index: typeof routes['config.index']
    update: typeof routes['config.update']
  }
  metrics: {
    overview: typeof routes['metrics.overview']
    imageBreakdown: typeof routes['metrics.image_breakdown']
  }
  health: {
    check: typeof routes['health.check']
  }
}
