/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

const JobsController = () => import('#controllers/jobs_controller')
const QueueController = () => import('#controllers/queue_controller')

router.get('/', () => {
  return { hello: 'world' }
})

// Job submission (Task 3)
router.post('/api/v1/jobs', [JobsController, 'store'])

// Job status & results (Task 4)
router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])

// Queue (Task 5)
router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])
