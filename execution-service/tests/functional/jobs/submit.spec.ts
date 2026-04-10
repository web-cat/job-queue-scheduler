import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { access } from 'node:fs/promises'
import path from 'node:path'
import ImageConfig from '#models/image_config'

test.group('Job submission endpoint', (group) => {
  group.each.setup(async () => {
    await db.from('jobs').where('submission_id', '>=', 900000).delete()
  })

  group.each.teardown(async () => {
    await db.from('jobs').where('submission_id', '>=', 900000).delete()
  })

  test('creates a pending job and stores uploaded files', async ({ client, assert }) => {
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')

    const response = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', 'webcat/java-grader:example')
      .field('submission_id', 900001)
      .field('user_id', 42)
      .field('course_id', 7)
      .field('assignment_name', 'Task3 Spec Test')
      .file('files', fixturePath)

    response.assertStatus(201)
    const body = await response.body()
    assert.equal(body.data.status, 'pending')
    assert.equal(body.data.submission_id, 900001)
    assert.equal(body.data.docker_image_tag, 'webcat/java-grader:example')
    assert.isAbove(body.data.queue_position, 0)

    const createdJob = await db
      .from('jobs')
      .where('job_id', body.data.job_id)
      .select('source_path', 'estimated_runtime', 'status')
      .first()

    assert.exists(createdJob)
    assert.equal(createdJob!.status, 'pending')
    assert.isAbove(Number(createdJob!.estimated_runtime), 0)

    const storedFile = path.join(createdJob!.source_path, 'submission.txt')
    await access(storedFile)
  })

  test('returns 404 for unknown docker image', async ({ client }) => {
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')

    const response = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', 'webcat/does-not-exist:latest')
      .field('submission_id', 900002)
      .file('files', fixturePath)

    response.assertStatus(404)
  })

  test('returns 409 for inactive docker image', async ({ client }) => {
    const image = await ImageConfig.query().where('docker_image_tag', 'webcat/python-grader:example').firstOrFail()
    const previousState = image.isActive
    image.isActive = false
    await image.save()

    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')

    const response = await client
      .post('/api/v1/jobs')
      .field('docker_image_tag', 'webcat/python-grader:example')
      .field('submission_id', 900003)
      .file('files', fixturePath)

    response.assertStatus(409)

    image.isActive = previousState
    await image.save()
  })

  test('returns 400 when required fields are missing', async ({ client }) => {
    const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'submission.txt')

    const response = await client.post('/api/v1/jobs').field('submission_id', 900004).file('files', fixturePath)

    response.assertStatus(400)
  })
})
