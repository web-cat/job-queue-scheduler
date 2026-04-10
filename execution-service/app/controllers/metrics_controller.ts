import type { HttpContext } from '@adonisjs/core/http'
import metricsService from '#services/metrics_service'

export default class MetricsController {
  async overview() {
    return metricsService.getOverview()
  }

  async imageBreakdown() {
    return metricsService.getImageBreakdown()
  }
}
