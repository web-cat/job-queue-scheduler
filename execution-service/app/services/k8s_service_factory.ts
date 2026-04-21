/**
 * Exports the active K8s service implementation.
 *
 * Use the mock when:
 *   - NODE_ENV=development (default local dev)
 *   - USE_K8S_MOCK=true  (opt-in for any env, e.g. CI)
 *
 * In production (NODE_ENV=production without USE_K8S_MOCK) the real
 * K8sService is used and talks to the live cluster.
 */

import k8sMock from './k8s_service_mock.js'
import k8sReal from './k8s_service.js'

export function shouldUseK8sMock(
  env: Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'USE_K8S_MOCK'>> = process.env
): boolean {
  return env.NODE_ENV === 'development' || env.USE_K8S_MOCK === 'true'
}

export function getK8sService(
  env: Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'USE_K8S_MOCK'>> = process.env
) {
  return shouldUseK8sMock(env) ? k8sMock : k8sReal
}

const k8sService = getK8sService()

export default k8sService
