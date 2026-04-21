import { test } from '@japa/runner'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import {
  assertSafeClientFileName,
  FileService,
  FileServiceError,
} from '#services/file_service'

function mockMultipart(
  clientName: string,
  opts: { size?: number; isValid?: boolean; moveError?: Error } = {}
): MultipartFile {
  const size = opts.size ?? 4
  const isValid = opts.isValid ?? true
  return {
    clientName,
    size,
    isValid,
    errors: [],
    type: 'application/octet-stream',
    subtype: 'octet-stream',
    fieldName: 'files',
    filePath: '',
    fileName: '',
    tmpPath: '',
    state: 'idle',
    headers: {},
    validated: true,
    supportedTypes: [],
    sizeLimit: 999999999,
    async move(dir: string, options: { name: string; overwrite?: boolean }) {
      if (opts.moveError) throw opts.moveError
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, options.name), 'stub')
    },
    markAsValid() {},
    toJSON() {
      return {}
    },
  } as unknown as MultipartFile
}

test.group('FileService — assertSafeClientFileName', () => {
  test('accepts a plain basename', async ({ assert }) => {
    assert.equal(assertSafeClientFileName('Main.java'), 'Main.java')
  })

  test('rejects path traversal patterns', async ({ assert }) => {
    assert.throws(() => assertSafeClientFileName('../../../etc/passwd'), FileServiceError)
    assert.throws(() => assertSafeClientFileName('foo/bar.java'), FileServiceError)
  })
})

test.group('FileService — integration', (group) => {
  let base: string
  let svc: FileService

  group.each.setup(async () => {
    base = path.join(tmpdir(), `file-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(base, { recursive: true })
    svc = new FileService({ submissionsPath: base, maxUploadBytes: 1024 })
  })

  group.each.teardown(async () => {
    await rm(base, { recursive: true, force: true })
  })

  test('storeSubmissionFiles creates input layout', async ({ assert }) => {
    const files = [mockMultipart('a.txt', { size: 2 }), mockMultipart('b.txt', { size: 3 })]
    const input = await svc.storeSubmissionFiles(42, files)
    assert.equal(input, path.join(base, '42', 'input'))
    await stat(path.join(input, 'a.txt'))
    await stat(path.join(input, 'b.txt'))
  })

  test('readResults parses expected fields and ignores unknown keys', async ({ assert }) => {
    const out = path.join(base, '7', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(
      path.join(out, 'results.json'),
      JSON.stringify({
        correctness_score: 10,
        tool_score: 20,
        extra_field: 'x',
        comments: 'ok',
      })
    )

    const r = await svc.readResults(7)
    assert.equal(r.correctness_score, 10)
    assert.equal(r.tool_score, 20)
    assert.equal(r.comments, 'ok')
    assert.isUndefined((r as any).extra_field)
  })

  test('readResults throws RESULTS_MISSING when file absent', async ({ assert }) => {
    try {
      await svc.readResults(99)
      assert.fail('expected throw')
    } catch (e: any) {
      assert.instanceOf(e, FileServiceError)
      assert.equal(e.code, 'RESULTS_MISSING')
    }
  })

  test('readResults throws RESULTS_EMPTY for whitespace-only file', async ({ assert }) => {
    const out = path.join(base, '8', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '   \n  ')

    try {
      await svc.readResults(8)
      assert.fail('expected throw')
    } catch (e: any) {
      assert.equal(e.code, 'RESULTS_EMPTY')
    }
  })

  test('readResults throws RESULTS_INVALID_JSON', async ({ assert }) => {
    const out = path.join(base, '9', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{ not json')

    try {
      await svc.readResults(9)
      assert.fail('expected throw')
    } catch (e: any) {
      assert.equal(e.code, 'RESULTS_INVALID_JSON')
    }
  })

  test('readResults returns empty object for non-object JSON root', async ({ assert }) => {
    const out = path.join(base, '10', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '[1,2,3]')

    const r = await svc.readResults(10)
    assert.deepEqual(r, {})
  })

  test('readResults truncates large fields when file exceeds 1MB', async ({ assert }) => {
    const out = path.join(base, '11', 'output')
    await mkdir(out, { recursive: true })
    const big = 'z'.repeat(600_000)
    const payload = JSON.stringify({ test_output: big, comments: big, correctness_score: 1 })
    await writeFile(path.join(out, 'results.json'), payload)
    const st = await stat(path.join(out, 'results.json'))
    assert.isAbove(st.size, 1024 * 1024)

    const r = await svc.readResults(11)
    assert.isBelow((r.test_output ?? '').length, 600_000)
    assert.isBelow((r.comments ?? '').length, 600_000)
    assert.equal(r.correctness_score, 1)
  })

  test('prepareOutputDirectory creates directory', async ({ assert }) => {
    const p = await svc.prepareOutputDirectory(5)
    assert.equal(p, path.join(base, '5', 'output'))
    const s = await stat(p)
    assert.isTrue(s.isDirectory())
  })

  test('cleanupSubmission removes job tree', async ({ assert }) => {
    await mkdir(path.join(base, '3', 'input'), { recursive: true })
    await svc.cleanupSubmission(3)
    await assert.rejects(() => stat(path.join(base, '3')))
  })

  test('cleanupSubmission does not throw when directory missing', async ({ assert }) => {
    await assert.doesNotRejects(() => svc.cleanupSubmission(404404))
  })

  test('getSubmissionDiskUsage sums bytes', async ({ assert }) => {
    await writeFile(path.join(base, 'readme.txt'), 'hello')
    const n = await svc.getSubmissionDiskUsage()
    assert.equal(n, 5)
  })

  test('cleanupOrphanedDirectories removes only inactive ids', async ({ assert }) => {
    await mkdir(path.join(base, '1', 'x'), { recursive: true })
    await mkdir(path.join(base, '2', 'x'), { recursive: true })
    const cleaned = await svc.cleanupOrphanedDirectories(new Set([1]))
    assert.equal(cleaned, 1)
    await assert.rejects(() => stat(path.join(base, '2')))
    const s = await stat(path.join(base, '1'))
    assert.isTrue(s.isDirectory())
  })

  test('storeSubmissionFiles maps ENOSPC to INSUFFICIENT_STORAGE', async ({ assert }) => {
    const enospc = Object.assign(new Error('no space'), { code: 'ENOSPC' })
    const files = [
      mockMultipart('x.txt', {
        moveError: enospc,
      }),
    ]
    try {
      await svc.storeSubmissionFiles(1, files)
      assert.fail('expected throw')
    } catch (e: any) {
      assert.instanceOf(e, FileServiceError)
      assert.equal(e.code, 'INSUFFICIENT_STORAGE')
      assert.equal(e.httpStatus, 507)
    }
  })
})
