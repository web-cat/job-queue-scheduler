/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  images: {
    index: typeof routes['images.index']
    store: typeof routes['images.store']
    stats: typeof routes['images.stats']
    show: typeof routes['images.show']
    update: typeof routes['images.update']
    destroy: typeof routes['images.destroy']
  }
  jobs: {
    store: typeof routes['jobs.store']
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    results: typeof routes['jobs.results']
    payload: typeof routes['jobs.payload']
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
