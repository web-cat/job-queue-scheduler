/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  queue: {
    status: typeof routes['queue.status']
    position: typeof routes['queue.position']
  }
}
