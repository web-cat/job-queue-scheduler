/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'queue.status': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/queue/status',
    tokens: [{"old":"/api/v1/queue/status","type":0,"val":"api","end":""},{"old":"/api/v1/queue/status","type":0,"val":"v1","end":""},{"old":"/api/v1/queue/status","type":0,"val":"queue","end":""},{"old":"/api/v1/queue/status","type":0,"val":"status","end":""}],
    types: placeholder as Registry['queue.status']['types'],
  },
  'queue.position': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/queue/position/:id',
    tokens: [{"old":"/api/v1/queue/position/:id","type":0,"val":"api","end":""},{"old":"/api/v1/queue/position/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/queue/position/:id","type":0,"val":"queue","end":""},{"old":"/api/v1/queue/position/:id","type":0,"val":"position","end":""},{"old":"/api/v1/queue/position/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['queue.position']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
