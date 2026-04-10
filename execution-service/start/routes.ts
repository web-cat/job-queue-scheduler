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
const JobsController = () => import('#controllers/jobs_controller')
const QueueController = () => import('#controllers/queue_controller')

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

// Job status & results (Task 4)
router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])

// Queue (Task 5)
router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])
