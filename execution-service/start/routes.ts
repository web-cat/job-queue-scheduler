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

router.get('/', () => {
  return { hello: 'world' }
})

// Image config CRUD (Task 6)
router.get('/api/v1/images', [ImagesController, 'index'])
router.post('/api/v1/images', [ImagesController, 'store'])
router.get('/api/v1/images/:id/stats', [ImagesController, 'stats'])
router.get('/api/v1/images/:id', [ImagesController, 'show'])
router.put('/api/v1/images/:id', [ImagesController, 'update'])
router.delete('/api/v1/images/:id', [ImagesController, 'destroy'])
// Job submission (Task 3)
router.post('/api/v1/jobs', [JobsController, 'store'])

// Job status & results (Task 4)
router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.get('/api/v1/jobs/:id/payload', [JobsController, 'payload'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])

// Queue (Task 5)
router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])

router.get('/api/v1/config', [ConfigController, 'index']).use(middleware.auth())
router.put('/api/v1/config/:key', [ConfigController, 'update']).use(middleware.auth())

router.get('/api/v1/metrics/overview', [MetricsController, 'overview']).use(middleware.auth())
router.get('/api/v1/metrics/images', [MetricsController, 'imageBreakdown']).use(middleware.auth())

router.get('/api/v1/health', [HealthController, 'check'])
