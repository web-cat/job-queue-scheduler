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

router.get('/api/v1/images', '#controllers/images_controller.index')
router.post('/api/v1/images', '#controllers/images_controller.store')
router.get('/api/v1/images/:id/stats', '#controllers/images_controller.stats')
router.get('/api/v1/images/:id', '#controllers/images_controller.show')
router.put('/api/v1/images/:id', '#controllers/images_controller.update')
router.delete('/api/v1/images/:id', '#controllers/images_controller.destroy')
