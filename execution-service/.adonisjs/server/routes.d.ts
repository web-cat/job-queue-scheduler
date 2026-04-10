import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.index': { paramsTuple?: []; params?: {} }
    'config.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.index': { paramsTuple?: []; params?: {} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'jobs.index': { paramsTuple?: []; params?: {} }
    'jobs.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'jobs.results': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'config.index': { paramsTuple?: []; params?: {} }
    'metrics.overview': { paramsTuple?: []; params?: {} }
    'metrics.image_breakdown': { paramsTuple?: []; params?: {} }
    'health.check': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'config.update': { paramsTuple: [ParamValue]; params: {'key': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}