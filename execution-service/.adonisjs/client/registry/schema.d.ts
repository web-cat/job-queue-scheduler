/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
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
}
