/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'jobs.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/jobs',
    tokens: [{"old":"/api/v1/jobs","type":0,"val":"api","end":""},{"old":"/api/v1/jobs","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs","type":0,"val":"jobs","end":""}],
    types: placeholder as Registry['jobs.index']['types'],
  },
  'jobs.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/jobs/:id',
    tokens: [{"old":"/api/v1/jobs/:id","type":0,"val":"api","end":""},{"old":"/api/v1/jobs/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs/:id","type":0,"val":"jobs","end":""},{"old":"/api/v1/jobs/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['jobs.show']['types'],
  },
  'jobs.results': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/jobs/:id/results',
    tokens: [{"old":"/api/v1/jobs/:id/results","type":0,"val":"api","end":""},{"old":"/api/v1/jobs/:id/results","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs/:id/results","type":0,"val":"jobs","end":""},{"old":"/api/v1/jobs/:id/results","type":1,"val":"id","end":""},{"old":"/api/v1/jobs/:id/results","type":0,"val":"results","end":""}],
    types: placeholder as Registry['jobs.results']['types'],
  },
  'jobs.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/jobs/:id',
    tokens: [{"old":"/api/v1/jobs/:id","type":0,"val":"api","end":""},{"old":"/api/v1/jobs/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs/:id","type":0,"val":"jobs","end":""},{"old":"/api/v1/jobs/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['jobs.destroy']['types'],
  },
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
