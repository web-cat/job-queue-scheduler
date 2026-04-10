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

router.get('/', () => {
  return { hello: 'world' }
})

router.get('/api/v1/images', '#controllers/images_controller.index')
router.post('/api/v1/images', '#controllers/images_controller.store')
router.get('/api/v1/images/:id/stats', '#controllers/images_controller.stats')
router.get('/api/v1/images/:id', '#controllers/images_controller.show')
router.put('/api/v1/images/:id', '#controllers/images_controller.update')
router.delete('/api/v1/images/:id', '#controllers/images_controller.destroy')
const JobsController = () => import('#controllers/jobs_controller')

router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])

router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])
