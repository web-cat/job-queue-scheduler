import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import SystemSetting from '#models/system_setting'
import User from '#models/user'

const TEST_USER_EMAIL = 'config-test@webcat.local'

/**
 * Create a user and mint an access token. Returns the raw token string
 * to pass in `Authorization: Bearer <token>`.
 */
async function createAuthedUser(): Promise<string> {
  const user = await User.firstOrCreate(
    { email: TEST_USER_EMAIL },
    { email: TEST_USER_EMAIL, password: 'password123', fullName: 'Config Test' }
  )
  const token = await User.accessTokens.create(user)
  return token.value!.release()
}

async function cleanUsers() {
  const user = await User.findBy('email', TEST_USER_EMAIL)
  if (user) {
    await db.from('auth_access_tokens').where('tokenable_id', user.id).delete()
    await user.delete()
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/config
// ---------------------------------------------------------------------------

test.group('GET /api/v1/config', (group) => {
  group.each.setup(async () => {
    await cleanUsers()
    await db.from('system_settings').delete()
    await SystemSetting.createMany([
      { key: 'scheduler_strategy', value: 'HRRN', description: 'Active scheduler' },
      { key: 'max_concurrent_jobs', value: '10', description: 'Dispatcher cap' },
      { key: 'callback_retry_max', value: '3', description: 'Max webhook retries' },
    ])
  })

  group.each.teardown(async () => {
    await cleanUsers()
  })

  test('returns 401 without a bearer token', async ({ client }) => {
    const res = await client.get('/api/v1/config')
    res.assertStatus(401)
  })

  test('returns 401 with an invalid bearer token', async ({ client }) => {
    const res = await client.get('/api/v1/config').bearerToken('not-a-real-token')
    res.assertStatus(401)
  })

  test('returns all system settings with a valid token', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client.get('/api/v1/config').bearerToken(token)
    res.assertStatus(200)

    const body = res.body() as any
    // Response may be wrapped as { data: [...] } or a top-level array.
    const items = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : []
    assert.isAtLeast(items.length, 3)

    const keys = items.map((s: any) => s.key)
    assert.include(keys, 'scheduler_strategy')
    assert.include(keys, 'max_concurrent_jobs')
    assert.include(keys, 'callback_retry_max')
  })
})

// ---------------------------------------------------------------------------
// PUT /api/v1/config/:key
// ---------------------------------------------------------------------------

test.group('PUT /api/v1/config/:key', (group) => {
  group.each.setup(async () => {
    await cleanUsers()
    await db.from('system_settings').delete()
    await SystemSetting.createMany([
      { key: 'scheduler_strategy', value: 'HRRN', description: 'Active scheduler' },
      { key: 'max_concurrent_jobs', value: '10', description: 'Dispatcher cap' },
    ])
  })

  group.each.teardown(async () => {
    await cleanUsers()
  })

  test('returns 401 without a bearer token', async ({ client }) => {
    const res = await client.put('/api/v1/config/scheduler_strategy').json({ value: 'FIFO' })
    res.assertStatus(401)
  })

  test('updates a setting and returns the new value', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .bearerToken(token)
      .json({ value: 'FIFO' })
    res.assertStatus(200)

    const body = res.body() as any
    const value = body.value ?? body.data?.value
    assert.equal(value, 'FIFO')

    const reloaded = await SystemSetting.findByOrFail('key', 'scheduler_strategy')
    assert.equal(reloaded.value, 'FIFO')
  })

  test('returns 404 for an unknown key', async ({ client }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/does_not_exist')
      .bearerToken(token)
      .json({ value: 'whatever' })
    res.assertStatus(404)
  })

  test('returns 400 when the request body omits "value"', async ({ client }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .bearerToken(token)
      .json({})
    res.assertStatus(400)
  })

  test('rejects invalid scheduler_strategy with 422', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .bearerToken(token)
      .json({ value: 'BOGUS' })
    res.assertStatus(422)

    // Original value must be untouched
    const still = await SystemSetting.findByOrFail('key', 'scheduler_strategy')
    assert.equal(still.value, 'HRRN')
  })

  test('rejects non-integer max_concurrent_jobs with 422', async ({ client }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .bearerToken(token)
      .json({ value: 'not-a-number' })
    res.assertStatus(422)
  })

  test('rejects zero / negative max_concurrent_jobs with 422', async ({ client }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .bearerToken(token)
      .json({ value: 0 })
    res.assertStatus(422)
  })

  test('accepts a valid positive max_concurrent_jobs', async ({ client, assert }) => {
    const token = await createAuthedUser()
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .bearerToken(token)
      .json({ value: 25 })
    res.assertStatus(200)

    const reloaded = await SystemSetting.findByOrFail('key', 'max_concurrent_jobs')
    assert.equal(reloaded.value, '25')
  })
})
