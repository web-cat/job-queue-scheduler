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

router.get('/api/v1/queue/status', [QueueController, 'status'])
router.get('/api/v1/queue/position/:id', [QueueController, 'position'])
