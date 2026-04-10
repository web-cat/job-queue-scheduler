/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'jobs.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/jobs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/job_validator').listJobsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'jobs.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/jobs/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
    }
  }
  'jobs.results': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/jobs/:id/results'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['results']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['results']>>>
    }
  }
  'jobs.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/jobs/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroy']>>>
    }
  }
  'queue.status': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/queue/status'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queue_controller').default['status']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queue_controller').default['status']>>>
    }
  }
  'queue.position': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/queue/position/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/queue_controller').default['position']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/queue_controller').default['position']>>>
    }
  }
  'config.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/config'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/config_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/config_controller').default['index']>>>
    }
  }
  'config.update': {
    methods: ["PUT"]
    pattern: '/api/v1/config/:key'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { key: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/config_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/config_controller').default['update']>>>
    }
  }
  'metrics.overview': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/metrics/overview'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/metrics_controller').default['overview']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/metrics_controller').default['overview']>>>
    }
  }
  'metrics.image_breakdown': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/metrics/images'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/metrics_controller').default['imageBreakdown']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/metrics_controller').default['imageBreakdown']>>>
    }
  }
  'health.check': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/health'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/health_controller').default['check']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/health_controller').default['check']>>>
    }
  }
}
