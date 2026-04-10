/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
const QueueController = () => import('#controllers/queue_controller')
const ConfigController = () => import('#controllers/config_controller')
const MetricsController = () => import('#controllers/metrics_controller')
const HealthController = () => import('#controllers/health_controller')

router.get('/', () => {
  return { hello: 'world' }
})

const JobsController = () => import('#controllers/jobs_controller')

router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])

router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])

router.get('/api/v1/config', [ConfigController, 'index'])
router.put('/api/v1/config/:key', [ConfigController, 'update'])

router.get('/api/v1/metrics/overview', [MetricsController, 'overview'])
router.get('/api/v1/metrics/images', [MetricsController, 'imageBreakdown'])

router.get('/api/v1/health', [HealthController, 'check'])
