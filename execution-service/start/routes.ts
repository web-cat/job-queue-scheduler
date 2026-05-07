/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const ImagesController = () => import('#controllers/images_controller')
import { middleware } from '#start/kernel'

const JobsController = () => import('#controllers/jobs_controller')
const QueueController = () => import('#controllers/queue_controller')
const ConfigController = () => import('#controllers/config_controller')
const MetricsController = () => import('#controllers/metrics_controller')
const HealthController = () => import('#controllers/health_controller')
const AccessTokenController = () => import('#controllers/access_token_controller')

router.get('/', () => {
  return { hello: 'world' }
})

// Image config CRUD (Task 6)
router.get('/api/v1/images', [ImagesController, 'index']).use(middleware.serviceAuth())
router.post('/api/v1/images', [ImagesController, 'store']).use(middleware.serviceAuth())
router.get('/api/v1/images/:id/stats', [ImagesController, 'stats']).use(middleware.serviceAuth())
router.get('/api/v1/images/:id', [ImagesController, 'show']).use(middleware.serviceAuth())
router.put('/api/v1/images/:id', [ImagesController, 'update']).use(middleware.serviceAuth())
router.delete('/api/v1/images/:id', [ImagesController, 'destroy']).use(middleware.serviceAuth())
// Job submission (Task 3)
router.post('/api/v1/jobs', [JobsController, 'store']).use(middleware.serviceAuth())

// Job status & results (Task 4)
router.get('/api/v1/jobs', [JobsController, 'index']).use(middleware.serviceAuth())
router.get('/api/v1/jobs/:id', [JobsController, 'show']).use(middleware.serviceAuth())
router.get('/api/v1/jobs/:id/results', [JobsController, 'results']).use(middleware.serviceAuth())
router.get('/api/v1/jobs/:id/payload', [JobsController, 'payload']).use(middleware.serviceAuth())
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy']).use(middleware.serviceAuth())

// Queue (Task 5)
router.get('/api/v1/queue/status', [QueueController, 'status']).use(middleware.serviceAuth())
router.get('/api/v1/queue/position/:id', [QueueController, 'position']).use(middleware.serviceAuth())

// Auth (API access tokens)
router.post('/api/v1/auth/token', [AccessTokenController, 'store']).use(middleware.serviceAuth())
router
  .delete('/api/v1/auth/token', [AccessTokenController, 'destroy'])
  .use(middleware.serviceAuth())
  .use(middleware.auth())

router.get('/api/v1/config', [ConfigController, 'index']).use(middleware.serviceAuth())
router.post('/api/v1/config', [ConfigController, 'store']).use(middleware.serviceAuth())
router.put('/api/v1/config/:key', [ConfigController, 'update']).use(middleware.serviceAuth())

router.get('/api/v1/metrics/overview', [MetricsController, 'overview']).use(middleware.serviceAuth())
router.get('/api/v1/metrics/images', [MetricsController, 'imageBreakdown']).use(middleware.serviceAuth())

router.get('/api/v1/health', [HealthController, 'check'])
