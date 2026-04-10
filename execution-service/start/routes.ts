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

router.get('/', () => {
  return { hello: 'world' }
})

router.post('/api/v1/jobs', [JobsController, 'store'])
