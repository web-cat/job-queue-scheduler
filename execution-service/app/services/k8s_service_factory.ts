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

const useMock =
  process.env.NODE_ENV === 'development' || process.env.USE_K8S_MOCK === 'true'

const k8sService = useMock ? k8sMock : k8sReal

export default k8sService
