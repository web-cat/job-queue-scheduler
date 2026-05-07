/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'images.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/images',
    tokens: [{"old":"/api/v1/images","type":0,"val":"api","end":""},{"old":"/api/v1/images","type":0,"val":"v1","end":""},{"old":"/api/v1/images","type":0,"val":"images","end":""}],
    types: placeholder as Registry['images.index']['types'],
  },
  'images.store': {
    methods: ["POST"],
    pattern: '/api/v1/images',
    tokens: [{"old":"/api/v1/images","type":0,"val":"api","end":""},{"old":"/api/v1/images","type":0,"val":"v1","end":""},{"old":"/api/v1/images","type":0,"val":"images","end":""}],
    types: placeholder as Registry['images.store']['types'],
  },
  'images.stats': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/images/:id/stats',
    tokens: [{"old":"/api/v1/images/:id/stats","type":0,"val":"api","end":""},{"old":"/api/v1/images/:id/stats","type":0,"val":"v1","end":""},{"old":"/api/v1/images/:id/stats","type":0,"val":"images","end":""},{"old":"/api/v1/images/:id/stats","type":1,"val":"id","end":""},{"old":"/api/v1/images/:id/stats","type":0,"val":"stats","end":""}],
    types: placeholder as Registry['images.stats']['types'],
  },
  'images.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/images/:id',
    tokens: [{"old":"/api/v1/images/:id","type":0,"val":"api","end":""},{"old":"/api/v1/images/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/images/:id","type":0,"val":"images","end":""},{"old":"/api/v1/images/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['images.show']['types'],
  },
  'images.update': {
    methods: ["PUT"],
    pattern: '/api/v1/images/:id',
    tokens: [{"old":"/api/v1/images/:id","type":0,"val":"api","end":""},{"old":"/api/v1/images/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/images/:id","type":0,"val":"images","end":""},{"old":"/api/v1/images/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['images.update']['types'],
  },
  'images.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/images/:id',
    tokens: [{"old":"/api/v1/images/:id","type":0,"val":"api","end":""},{"old":"/api/v1/images/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/images/:id","type":0,"val":"images","end":""},{"old":"/api/v1/images/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['images.destroy']['types'],
  },
  'jobs.store': {
    methods: ["POST"],
    pattern: '/api/v1/jobs',
    tokens: [{"old":"/api/v1/jobs","type":0,"val":"api","end":""},{"old":"/api/v1/jobs","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs","type":0,"val":"jobs","end":""}],
    types: placeholder as Registry['jobs.store']['types'],
  },
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
  'jobs.payload': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/jobs/:id/payload',
    tokens: [{"old":"/api/v1/jobs/:id/payload","type":0,"val":"api","end":""},{"old":"/api/v1/jobs/:id/payload","type":0,"val":"v1","end":""},{"old":"/api/v1/jobs/:id/payload","type":0,"val":"jobs","end":""},{"old":"/api/v1/jobs/:id/payload","type":1,"val":"id","end":""},{"old":"/api/v1/jobs/:id/payload","type":0,"val":"payload","end":""}],
    types: placeholder as Registry['jobs.payload']['types'],
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
  'access_token.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/token',
    tokens: [{"old":"/api/v1/auth/token","type":0,"val":"api","end":""},{"old":"/api/v1/auth/token","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/token","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/token","type":0,"val":"token","end":""}],
    types: placeholder as Registry['access_token.store']['types'],
  },
  'access_token.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/auth/token',
    tokens: [{"old":"/api/v1/auth/token","type":0,"val":"api","end":""},{"old":"/api/v1/auth/token","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/token","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/token","type":0,"val":"token","end":""}],
    types: placeholder as Registry['access_token.destroy']['types'],
  },
  'config.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/config',
    tokens: [{"old":"/api/v1/config","type":0,"val":"api","end":""},{"old":"/api/v1/config","type":0,"val":"v1","end":""},{"old":"/api/v1/config","type":0,"val":"config","end":""}],
    types: placeholder as Registry['config.index']['types'],
  },
  'config.store': {
    methods: ["POST"],
    pattern: '/api/v1/config',
    tokens: [{"old":"/api/v1/config","type":0,"val":"api","end":""},{"old":"/api/v1/config","type":0,"val":"v1","end":""},{"old":"/api/v1/config","type":0,"val":"config","end":""}],
    types: placeholder as Registry['config.store']['types'],
  },
  'config.update': {
    methods: ["PUT"],
    pattern: '/api/v1/config/:key',
    tokens: [{"old":"/api/v1/config/:key","type":0,"val":"api","end":""},{"old":"/api/v1/config/:key","type":0,"val":"v1","end":""},{"old":"/api/v1/config/:key","type":0,"val":"config","end":""},{"old":"/api/v1/config/:key","type":1,"val":"key","end":""}],
    types: placeholder as Registry['config.update']['types'],
  },
  'metrics.overview': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/metrics/overview',
    tokens: [{"old":"/api/v1/metrics/overview","type":0,"val":"api","end":""},{"old":"/api/v1/metrics/overview","type":0,"val":"v1","end":""},{"old":"/api/v1/metrics/overview","type":0,"val":"metrics","end":""},{"old":"/api/v1/metrics/overview","type":0,"val":"overview","end":""}],
    types: placeholder as Registry['metrics.overview']['types'],
  },
  'metrics.image_breakdown': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/metrics/images',
    tokens: [{"old":"/api/v1/metrics/images","type":0,"val":"api","end":""},{"old":"/api/v1/metrics/images","type":0,"val":"v1","end":""},{"old":"/api/v1/metrics/images","type":0,"val":"metrics","end":""},{"old":"/api/v1/metrics/images","type":0,"val":"images","end":""}],
    types: placeholder as Registry['metrics.image_breakdown']['types'],
  },
  'health.check': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/health',
    tokens: [{"old":"/api/v1/health","type":0,"val":"api","end":""},{"old":"/api/v1/health","type":0,"val":"v1","end":""},{"old":"/api/v1/health","type":0,"val":"health","end":""}],
    types: placeholder as Registry['health.check']['types'],
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
