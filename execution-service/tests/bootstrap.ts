import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import type { Registry } from '../.adonisjs/client/registry/schema.d.ts'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */
declare module '@japa/api-client/types' {
  interface RoutesRegistry extends Registry {}
}

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    async () => {
      // Functional tests must not write to `/data/*` on developer machines/CI.
      // Keep the default singleton FileService behaviour, but point it at tmp.
      const submissions = app.tmpPath('test-submissions')
      const payloads = app.tmpPath('test-payloads')
      process.env.SUBMISSIONS_PATH = submissions
      process.env.PAYLOADS_PATH = payloads
      await mkdir(submissions, { recursive: true })
      await mkdir(payloads, { recursive: true })
    },
  ],
  teardown: [
    async () => {
      const submissions = process.env.SUBMISSIONS_PATH
      const payloads = process.env.PAYLOADS_PATH
      // Best-effort cleanup. Individual tests also clean up job-specific dirs.
      if (submissions && submissions.includes(path.join('tmp', ''))) {
        await rm(submissions, { recursive: true, force: true })
      }
      if (payloads && payloads.includes(path.join('tmp', ''))) {
        await rm(payloads, { recursive: true, force: true })
      }
    },
  ],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
