import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import SystemSetting from '#models/system_setting'

// ---------------------------------------------------------------------------
// GET /api/v1/config
// ---------------------------------------------------------------------------

test.group('GET /api/v1/config', (group) => {
  group.each.setup(async () => {
    await db.from('system_settings').delete()
    await SystemSetting.createMany([
      { key: 'scheduler_strategy', value: 'HRRN', description: 'Active scheduler' },
      { key: 'max_concurrent_jobs', value: '10', description: 'Dispatcher cap' },
      { key: 'callback_retry_max', value: '3', description: 'Max webhook retries' },
    ])
  })

  test('returns 401 without the service API key', async ({ client }) => {
    const res = await client.get('/api/v1/config').header('x-api-key', '')
    res.assertStatus(401)
  })

  test('returns 401 with an invalid service API key', async ({ client }) => {
    const res = await client.get('/api/v1/config').header('x-api-key', 'not-a-real-key')
    res.assertStatus(401)
  })

  test('returns all system settings with a valid service API key', async ({ client, assert }) => {
    const res = await client.get('/api/v1/config')
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
    await db.from('system_settings').delete()
    await SystemSetting.createMany([
      { key: 'scheduler_strategy', value: 'HRRN', description: 'Active scheduler' },
      { key: 'max_concurrent_jobs', value: '10', description: 'Dispatcher cap' },
    ])
  })

  test('returns 401 without the service API key', async ({ client }) => {
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .header('x-api-key', '')
      .json({ value: 'FIFO' })
    res.assertStatus(401)
  })

  test('updates a setting and returns the new value', async ({ client, assert }) => {
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .json({ value: 'FIFO' })
    res.assertStatus(200)

    const body = res.body() as any
    const value = body.value ?? body.data?.value
    assert.equal(value, 'FIFO')

    const reloaded = await SystemSetting.findByOrFail('key', 'scheduler_strategy')
    assert.equal(reloaded.value, 'FIFO')
  })

  test('returns 404 for an unknown key', async ({ client }) => {
    const res = await client
      .put('/api/v1/config/does_not_exist')
      .json({ value: 'whatever' })
    res.assertStatus(404)
  })

  test('returns 400 when the request body omits "value"', async ({ client }) => {
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .json({})
    res.assertStatus(400)
  })

  test('rejects invalid scheduler_strategy with 422', async ({ client, assert }) => {
    const res = await client
      .put('/api/v1/config/scheduler_strategy')
      .json({ value: 'BOGUS' })
    res.assertStatus(422)

    // Original value must be untouched
    const still = await SystemSetting.findByOrFail('key', 'scheduler_strategy')
    assert.equal(still.value, 'HRRN')
  })

  test('rejects non-integer max_concurrent_jobs with 422', async ({ client }) => {
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .json({ value: 'not-a-number' })
    res.assertStatus(422)
  })

  test('rejects zero / negative max_concurrent_jobs with 422', async ({ client }) => {
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .json({ value: 0 })
    res.assertStatus(422)
  })

  test('accepts a valid positive max_concurrent_jobs', async ({ client, assert }) => {
    const res = await client
      .put('/api/v1/config/max_concurrent_jobs')
      .json({ value: 25 })
    res.assertStatus(200)

    const reloaded = await SystemSetting.findByOrFail('key', 'max_concurrent_jobs')
    assert.equal(reloaded.value, '25')
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/config
// ---------------------------------------------------------------------------

test.group('POST /api/v1/config', (group) => {
  group.each.setup(async () => {
    await db.from('system_settings').delete()
  })

  test('returns 401 without the service API key', async ({ client }) => {
    const res = await client.post('/api/v1/config').header('x-api-key', '').json({ key: 'x', value: 'y' })
    res.assertStatus(401)
  })

  test('creates a new setting and returns 201', async ({ client, assert }) => {
    const res = await client.post('/api/v1/config').json({
      key: 'max_concurrent_jobs',
      value: 10,
      description: 'Dispatcher cap',
    })
    res.assertStatus(201)

    const created = await SystemSetting.findByOrFail('key', 'max_concurrent_jobs')
    assert.equal(created.value, '10')
    assert.equal(created.description, 'Dispatcher cap')
  })

  test('returns 409 when creating an existing key', async ({ client }) => {
    await SystemSetting.create({ key: 'scheduler_strategy', value: 'HRRN', description: 'Active scheduler' })
    const res = await client.post('/api/v1/config').json({ key: 'scheduler_strategy', value: 'FIFO' })
    res.assertStatus(409)
  })

  test('validates known keys and rejects invalid values with 422', async ({ client }) => {
    const res = await client.post('/api/v1/config').json({ key: 'max_concurrent_jobs', value: 0 })
    res.assertStatus(422)
  })
})
