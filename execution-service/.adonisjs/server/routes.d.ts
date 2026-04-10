import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'queue.status': { paramsTuple?: []; params?: {} }
    'queue.position': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}