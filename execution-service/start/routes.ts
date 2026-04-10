/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

router.get('/', () => {
  return { hello: 'world' }
})

const JobsController = () => import('#controllers/jobs_controller')

router.get('/api/v1/jobs', [JobsController, 'index'])
router.get('/api/v1/jobs/:id', [JobsController, 'show'])
router.get('/api/v1/jobs/:id/results', [JobsController, 'results'])
router.delete('/api/v1/jobs/:id', [JobsController, 'destroy'])
