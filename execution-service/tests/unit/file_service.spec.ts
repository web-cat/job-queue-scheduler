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

  test('cleanupOrphanedDirectories does not remove numeric-named files', async ({ assert }) => {
    await writeFile(path.join(base, '42'), 'not a directory')
    const cleaned = await svc.cleanupOrphanedDirectories(new Set())
    assert.equal(cleaned, 0)
    const st = await stat(path.join(base, '42'))
    assert.isTrue(st.isFile())
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

test.group('FileService — payload handling', (group) => {
  let subsBase: string
  let payloadsBase: string
  let svc: FileService

  group.each.setup(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    subsBase = path.join(tmpdir(), `file-svc-subs-${suffix}`)
    payloadsBase = path.join(tmpdir(), `file-svc-payloads-${suffix}`)
    await mkdir(subsBase, { recursive: true })
    await mkdir(payloadsBase, { recursive: true })
    svc = new FileService({
      submissionsPath: subsBase,
      payloadsPath: payloadsBase,
      maxPayloadBytes: 1024,
    })
  })

  group.each.teardown(async () => {
    await rm(subsBase, { recursive: true, force: true })
    await rm(payloadsBase, { recursive: true, force: true })
  })

  test('extractPayloadFile returns null when output directory is missing', async ({ assert }) => {
    const result = await svc.extractPayloadFile(42)
    assert.isNull(result)
  })

  test('extractPayloadFile returns null when only results.json exists', async ({ assert }) => {
    const out = path.join(subsBase, '1', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{}')

    const result = await svc.extractPayloadFile(1)
    assert.isNull(result)
  })

  test('extractPayloadFile moves single payload file to payloads directory', async ({ assert }) => {
    const out = path.join(subsBase, '2', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{}')
    await writeFile(path.join(out, 'payload.zip'), 'binary-ish-content')

    const result = await svc.extractPayloadFile(2)

    assert.isNotNull(result)
    assert.equal(result!.filename, 'payload.zip')
    assert.equal(result!.sizeBytes, 'binary-ish-content'.length)
    assert.equal(result!.path, path.join(payloadsBase, '2', 'payload.zip'))

    // File exists at destination
    const destStat = await stat(result!.path)
    assert.isTrue(destStat.isFile())

    // Original file gone from output dir, results.json remains
    await assert.rejects(() => stat(path.join(out, 'payload.zip')))
    const resultsStat = await stat(path.join(out, 'results.json'))
    assert.isTrue(resultsStat.isFile())
  })

  test('extractPayloadFile picks largest file when multiple candidates exist', async ({ assert }) => {
    const out = path.join(subsBase, '3', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{}')
    await writeFile(path.join(out, 'small.txt'), 'tiny')
    await writeFile(path.join(out, 'large.bin'), 'x'.repeat(500))
    await writeFile(path.join(out, 'medium.log'), 'y'.repeat(100))

    const result = await svc.extractPayloadFile(3)

    assert.isNotNull(result)
    assert.equal(result!.filename, 'large.bin')
    assert.equal(result!.sizeBytes, 500)
    assert.equal(result!.path, path.join(payloadsBase, '3', 'large.bin'))

    // Only the largest was moved; the others stay in the output dir (they'll be cleaned
    // with the submission directory). This is acceptable behavior.
    const destStat = await stat(result!.path)
    assert.isTrue(destStat.isFile())
  })

  test('extractPayloadFile returns null and does not move when file exceeds max size', async ({
    assert,
  }) => {
    const out = path.join(subsBase, '4', 'output')
    await mkdir(out, { recursive: true })
    // maxPayloadBytes was set to 1024 in setup
    await writeFile(path.join(out, 'huge.bin'), 'x'.repeat(2048))

    const result = await svc.extractPayloadFile(4)
    assert.isNull(result)

    // Source file must remain untouched — we did not move it
    const srcStat = await stat(path.join(out, 'huge.bin'))
    assert.equal(srcStat.size, 2048)

    // Destination directory must not exist
    await assert.rejects(() => stat(path.join(payloadsBase, '4')))
  })

  test('extractPayloadFile returns null when resulting dstPath exceeds 500 chars', async ({
    assert,
  }) => {
    // Use a payloads base path long enough that {base}/{jobId}/{filename} exceeds
    // 500 chars even with a "normal" filename. macOS filesystems reject single
    // path components > 255 bytes so we use a long filename under the 255 limit
    // and a long base directory to push the joined path over 500.
    const longSegment = 'p'.repeat(200)
    const longPayloadsBase = path.join(tmpdir(), `file-svc-long-${Date.now()}`, longSegment, longSegment)
    await mkdir(longPayloadsBase, { recursive: true })

    const longSvc = new FileService({
      submissionsPath: subsBase,
      payloadsPath: longPayloadsBase,
      maxPayloadBytes: 1024 * 1024,
    })

    const out = path.join(subsBase, '44', 'output')
    await mkdir(out, { recursive: true })
    const filename = 'a'.repeat(200) + '.zip' // under 255 but contributes to long dstPath
    await writeFile(path.join(out, filename), 'payload')

    const result = await longSvc.extractPayloadFile(44)
    assert.isNull(result)

    // Source file remains; destination was never created
    const srcStat = await stat(path.join(out, filename))
    assert.equal(srcStat.size, 'payload'.length)
    await assert.rejects(() => stat(path.join(longPayloadsBase, '44')))

    await rm(longPayloadsBase, { recursive: true, force: true })
  })

  test('extractPayloadFile ignores subdirectories in output dir', async ({ assert }) => {
    const out = path.join(subsBase, '5', 'output')
    await mkdir(out, { recursive: true })
    await mkdir(path.join(out, 'subdir'), { recursive: true })
    await writeFile(path.join(out, 'subdir', 'nested.txt'), 'ignored')
    await writeFile(path.join(out, 'results.json'), '{}')

    const result = await svc.extractPayloadFile(5)
    assert.isNull(result)
  })

  test('extractPayloadFile accepts arbitrary non-results filename', async ({ assert }) => {
    const out = path.join(subsBase, '6', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{}')
    await writeFile(path.join(out, 'output.tar.gz'), 'payload-data')

    const result = await svc.extractPayloadFile(6)

    assert.isNotNull(result)
    assert.equal(result!.filename, 'output.tar.gz')
  })

  test('getPayloadFilePath returns null when directory does not exist', async ({ assert }) => {
    const result = await svc.getPayloadFilePath(999)
    assert.isNull(result)
  })

  test('getPayloadFilePath returns stored file path', async ({ assert }) => {
    const dir = path.join(payloadsBase, '7')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'payload.zip'), 'data')

    const result = await svc.getPayloadFilePath(7)
    assert.equal(result, path.join(dir, 'payload.zip'))
  })

  test('getPayloadFilePath returns null when directory is empty', async ({ assert }) => {
    const dir = path.join(payloadsBase, '8')
    await mkdir(dir, { recursive: true })

    const result = await svc.getPayloadFilePath(8)
    assert.isNull(result)
  })

  test('getPayloadFilePath returns null when directory contains multiple files', async ({
    assert,
  }) => {
    const dir = path.join(payloadsBase, '88')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'a.zip'), 'a')
    await writeFile(path.join(dir, 'b.zip'), 'b')

    const result = await svc.getPayloadFilePath(88)
    assert.isNull(result)
  })

  test('cleanupPayload removes payload directory', async ({ assert }) => {
    const dir = path.join(payloadsBase, '9')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'payload.zip'), 'data')

    await svc.cleanupPayload(9)

    await assert.rejects(() => stat(dir))
  })

  test('cleanupPayload does not throw when directory is absent', async ({ assert }) => {
    await assert.doesNotRejects(() => svc.cleanupPayload(404404))
  })

  test('extractPayloadFile followed by getPayloadFilePath returns same path', async ({
    assert,
  }) => {
    const out = path.join(subsBase, '10', 'output')
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'results.json'), '{}')
    await writeFile(path.join(out, 'deliverable.zip'), 'contents')

    const extracted = await svc.extractPayloadFile(10)
    assert.isNotNull(extracted)

    const looked = await svc.getPayloadFilePath(10)
    assert.equal(looked, extracted!.path)
  })

  test('getPayloadDirectory returns correct path', async ({ assert }) => {
    assert.equal(svc.getPayloadDirectory(77), path.join(payloadsBase, '77'))
  })

  test('payloadsBasePath exposes configured root', async ({ assert }) => {
    assert.equal(svc.payloadsBasePath, payloadsBase)
  })
})
