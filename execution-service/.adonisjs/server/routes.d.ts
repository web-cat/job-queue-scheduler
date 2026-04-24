import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'images.index': { paramsTuple?: []; params?: {} }
    'images.store': { paramsTuple?: []; params?: {} }
    'images.stats': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'images.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'images.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'images.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.store': { paramsTuple?: []; params?: {} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.payload': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'access_token.store': { paramsTuple?: []; params?: {} }
    'access_token.destroy': { paramsTuple?: []; params?: {} }
    'config.index': { paramsTuple?: []; params?: {} }
    'config.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'images.index': { paramsTuple?: []; params?: {} }
    'images.stats': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'images.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.payload': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.index': { paramsTuple?: []; params?: {} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'images.index': { paramsTuple?: []; params?: {} }
    'images.stats': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'images.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.payload': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.index': { paramsTuple?: []; params?: {} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'images.store': { paramsTuple?: []; params?: {} }
    'jobs.store': { paramsTuple?: []; params?: {} }
    'access_token.store': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'images.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
  }
  DELETE: {
    'images.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'access_token.destroy': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}