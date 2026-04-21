import { test } from '@japa/runner'
import { shouldUseK8sMock } from '#services/k8s_service_factory'

test.group('k8s_service_factory', () => {
  test('uses mock in development', async ({ assert }) => {
    assert.isTrue(shouldUseK8sMock({ NODE_ENV: 'development', USE_K8S_MOCK: 'false' }))
  })

  test('uses mock when USE_K8S_MOCK=true (any env)', async ({ assert }) => {
    assert.isTrue(shouldUseK8sMock({ NODE_ENV: 'production', USE_K8S_MOCK: 'true' }))
    assert.isTrue(shouldUseK8sMock({ NODE_ENV: 'test', USE_K8S_MOCK: 'true' }))
  })

  test('uses real service by default', async ({ assert }) => {
    assert.isFalse(shouldUseK8sMock({ NODE_ENV: 'production', USE_K8S_MOCK: 'false' }))
    assert.isFalse(shouldUseK8sMock({ NODE_ENV: undefined, USE_K8S_MOCK: undefined }))
  })
})

