import { access, constants, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import logger from '@adonisjs/core/services/logger'

/** Domain error for file operations; optional `httpStatus` when the API should map it to a response. */

/**
 * Maps {@link FileService.readResults} errors to stable `markFailed` messages (task 14 edge cases).
 * Unknown codes log the full error (may include paths) and return a generic string — never echo raw FS/parse details to clients.
 */
export function markFailedMessageForGradingResultsError(error: FileServiceError): string {
  switch (error.code) {
    case 'RESULTS_MISSING':
      return 'Grading container did not produce results'
    case 'RESULTS_EMPTY':
      return 'Grading container produced empty results'
    case 'RESULTS_INVALID_JSON':
      return 'Grading container produced invalid results (malformed JSON)'
    default:
      logger.warn(
        { err: error, code: error.code },
        'Unhandled grading results error code; returning generic markFailed message'
      )
      return 'Grading container produced unreadable results'
  }
}

export class FileServiceError extends Error {
  readonly code: string
  readonly httpStatus?: number
  readonly cause?: unknown

  constructor(
    message: string,
    code: string,
    options?: { httpStatus?: number; cause?: unknown }
  ) {
    super(message)
    this.name = 'FileServiceError'
    this.code = code
    this.httpStatus = options?.httpStatus
    this.cause = options?.cause
  }
}

export type GradingResults = {
  correctness_score?: number | null
  tool_score?: number | null
  comments?: string | null
  comment_format?: number | null
  test_output?: string | null
  container_logs?: string | null
  exit_code?: number | null
  cpu_usage?: number | null
  ram_usage?: number | null
  runtime_ms?: number | null
  pod_name?: string | null
  node_ip?: string | null
}

const KNOWN_RESULT_KEYS = new Set([
  'correctness_score',
  'tool_score',
  'comments',
  'comment_format',
  'test_output',
  'container_logs',
  'exit_code',
  'cpu_usage',
  'ram_usage',
  'runtime_ms',
  'pod_name',
  'node_ip',
])

const DEFAULT_SUBMISSIONS_PATH = '/data/submissions'
const DEFAULT_PAYLOADS_PATH = '/data/payloads'
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_PAYLOAD_BYTES = 100 * 1024 * 1024
const RESULTS_JSON_NAME = 'results.json'
const MAX_RESULTS_FILE_BYTES = 1024 * 1024
const TRUNCATE_FIELD_CHARS = 500_000

function logFsError(context: string, err: unknown): void {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : undefined
  logger.error({ context, code, err }, `File system error during ${context}`)
}

function parseMaxUploadBytes(): number {
  const raw = process.env.MAX_SUBMISSION_UPLOAD_BYTES
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES
}

function parseMaxPayloadBytes(): number {
  const raw = process.env.MAX_PAYLOAD_BYTES
  if (!raw) return DEFAULT_MAX_PAYLOAD_BYTES
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PAYLOAD_BYTES
}

/**
 * Reject path separators and traversal in the original client-provided name.
 */
export function assertSafeClientFileName(clientName: string): string {
  if (!clientName || clientName.includes('\0')) {
    throw new FileServiceError('Invalid file name', 'INVALID_FILENAME', { httpStatus: 400 })
  }
  if (/[/\\]/.test(clientName) || /\.\./.test(clientName)) {
    throw new FileServiceError(
      'File name must not contain path segments or ".."',
      'PATH_TRAVERSAL',
      { httpStatus: 400 }
    )
  }
  const base = path.basename(clientName)
  if (base === '.' || base === '..' || base.length === 0) {
    throw new FileServiceError('Invalid file name', 'PATH_TRAVERSAL', { httpStatus: 400 })
  }
  return base
}

function coerceOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function coerceOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function truncateLargeTextFields(results: GradingResults): GradingResults {
  const out = { ...results }
  if (typeof out.test_output === 'string' && out.test_output.length > TRUNCATE_FIELD_CHARS) {
    out.test_output = out.test_output.slice(0, TRUNCATE_FIELD_CHARS)
  }
  if (typeof out.comments === 'string' && out.comments.length > TRUNCATE_FIELD_CHARS) {
    out.comments = out.comments.slice(0, TRUNCATE_FIELD_CHARS)
  }
  return out
}

async function directoryDiskUsageBytes(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err: any) {
    if (err?.code === 'ENOENT') return 0
    logFsError('directoryDiskUsageBytes', err)
    throw new FileServiceError(`Cannot read submissions directory: ${err?.message ?? err}`, 'STORAGE_READ_FAILED', {
      cause: err,
    })
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directoryDiskUsageBytes(full)
    } else if (entry.isFile()) {
      try {
        const s = await stat(full)
        total += s.size
      } catch (err: any) {
        if (err?.code === 'ENOENT') continue
        logFsError('directoryDiskUsageBytes.stat', err)
        throw new FileServiceError(`Cannot stat file under submissions: ${err?.message ?? err}`, 'STORAGE_READ_FAILED', {
          cause: err,
        })
      }
    }
  }
  return total
}

export type FileServiceOptions = {
  submissionsPath?: string
  payloadsPath?: string
  /** When set (e.g. in tests), skips `MAX_SUBMISSION_UPLOAD_BYTES` env. */
  maxUploadBytes?: number
  /** When set (e.g. in tests), skips `MAX_PAYLOAD_BYTES` env. */
  maxPayloadBytes?: number
}

export type ExtractedPayload = {
  path: string
  filename: string
  sizeBytes: number
}

export class FileService {
  constructor(private readonly options?: FileServiceOptions) {}

  private get submissionsPath(): string {
    return this.options?.submissionsPath ?? process.env.SUBMISSIONS_PATH ?? DEFAULT_SUBMISSIONS_PATH
  }

  private get payloadsPath(): string {
    return this.options?.payloadsPath ?? process.env.PAYLOADS_PATH ?? DEFAULT_PAYLOADS_PATH
  }

  private get maxTotalUploadBytes(): number {
    return this.options?.maxUploadBytes ?? parseMaxUploadBytes()
  }

  private get maxPayloadBytes(): number {
    return this.options?.maxPayloadBytes ?? parseMaxPayloadBytes()
  }

  get submissionsBasePath(): string {
    return this.submissionsPath
  }

  get payloadsBasePath(): string {
    return this.payloadsPath
  }

  getInputPath(jobId: number): string {
    return path.join(this.submissionsPath, String(jobId), 'input')
  }

  getOutputPath(jobId: number): string {
    return path.join(this.submissionsPath, String(jobId), 'output')
  }

  getPayloadDirectory(jobId: number): string {
    return path.join(this.payloadsPath, String(jobId))
  }

  /**
   * Ensures `{submissions}/{jobId}/output/` exists and is writable.
   */
  async prepareOutputDirectory(jobId: number): Promise<string> {
    const outputPath = this.getOutputPath(jobId)
    try {
      await mkdir(outputPath, { recursive: true, mode: 0o755 })
      await access(outputPath, constants.W_OK)
    } catch (err: any) {
      logFsError('prepareOutputDirectory', err)
      if (err?.code === 'ENOSPC') {
        throw new FileServiceError('Disk full while preparing output directory', 'INSUFFICIENT_STORAGE', {
          httpStatus: 507,
          cause: err,
        })
      }
      if (err?.code === 'EACCES') {
        throw new FileServiceError('Permission denied for output directory', 'STORAGE_PERMISSION_DENIED', {
          httpStatus: 500,
          cause: err,
        })
      }
      throw new FileServiceError(
        `Failed to prepare output directory: ${err?.message ?? err}`,
        'OUTPUT_DIR_FAILED',
        { cause: err }
      )
    }
    return outputPath
  }

  private async removeJobDirectoryBestEffort(jobId: number): Promise<void> {
    const jobPath = path.join(this.submissionsPath, String(jobId))
    try {
      await rm(jobPath, { recursive: true, force: true })
    } catch (err) {
      logFsError('removeJobDirectoryBestEffort', err)
    }
  }

  /**
   * Recursively deletes the submission directory for `jobId` under the configured submissions root (`SUBMISSIONS_PATH`).
   * ENOENT is treated as already cleaned up. Other errors are logged; this method does not throw.
   */
  async cleanupSubmission(jobId: number): Promise<void> {
    const jobPath = path.join(this.submissionsPath, String(jobId))
    try {
      await rm(jobPath, { recursive: true, force: true })
      logger.info({ jobId, path: jobPath }, 'Cleaned up submission directory')
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        logger.info({ jobId, path: jobPath }, 'Submission directory already absent during cleanup')
        return
      }
      logFsError('cleanupSubmission', err)
    }
  }

  /**
   * Scans the grading output directory for any file other than `results.json` and moves it
   * to a persistent payload directory. Returns null when no candidate exists, the candidate
   * exceeds {@link MAX_PAYLOAD_BYTES}, or any FS error occurs — grading itself already succeeded,
   * so we never throw from this path.
   *
   * If multiple candidates exist we pick the largest and warn.
   */
  async extractPayloadFile(jobId: number): Promise<ExtractedPayload | null> {
    const outputPath = this.getOutputPath(jobId)

    let entries: Dirent[]
    try {
      entries = await readdir(outputPath, { withFileTypes: true })
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      logFsError('extractPayloadFile.readdir', err)
      return null
    }

    const candidateNames = entries
      .filter((e) => e.isFile() && e.name !== RESULTS_JSON_NAME)
      .map((e) => e.name)

    if (candidateNames.length === 0) return null

    const candidates: { name: string; size: number }[] = []
    for (const name of candidateNames) {
      try {
        const st = await stat(path.join(outputPath, name))
        candidates.push({ name, size: st.size })
      } catch (err) {
        logFsError('extractPayloadFile.stat', err)
      }
    }

    if (candidates.length === 0) return null

    candidates.sort((a, b) => b.size - a.size)
    const chosen = candidates[0]

    if (candidates.length > 1) {
      logger.warn(
        { jobId, candidates: candidates.map((c) => c.name), chosen: chosen.name },
        'Multiple non-results files in output directory — selecting largest as payload'
      )
    }

    const maxBytes = this.maxPayloadBytes
    if (chosen.size > maxBytes) {
      logger.warn(
        { jobId, filename: chosen.name, sizeBytes: chosen.size, maxBytes },
        'Payload file exceeds max size — not storing'
      )
      return null
    }

    const srcPath = path.join(outputPath, chosen.name)
    const dstDir = this.getPayloadDirectory(jobId)
    const dstPath = path.join(dstDir, chosen.name)

    try {
      await mkdir(dstDir, { recursive: true, mode: 0o755 })
    } catch (err) {
      logFsError('extractPayloadFile.mkdir', err)
      return null
    }

    try {
      await rename(srcPath, dstPath)
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        // Cross-device (e.g., separate k8s volume mounts). Copy + unlink as fallback.
        try {
          await copyFile(srcPath, dstPath)
          await unlink(srcPath)
        } catch (copyErr) {
          logFsError('extractPayloadFile.copyFallback', copyErr)
          await rm(dstPath, { force: true }).catch(() => undefined)
          return null
        }
      } else {
        logFsError('extractPayloadFile.rename', err)
        return null
      }
    }

    logger.info(
      { jobId, filename: chosen.name, sizeBytes: chosen.size, path: dstPath },
      'Extracted payload file'
    )

    return { path: dstPath, filename: chosen.name, sizeBytes: chosen.size }
  }

  /**
   * Returns the on-disk path of the stored payload for `jobId` if exactly one file exists
   * under `{payloadsPath}/{jobId}/`, otherwise null. Callers should still confirm the path
   * matches what's recorded in `job_results.payload_path`.
   */
  async getPayloadFilePath(jobId: number): Promise<string | null> {
    const dir = this.getPayloadDirectory(jobId)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null
      logFsError('getPayloadFilePath.readdir', err)
      return null
    }

    const files = entries.filter((e) => e.isFile())
    if (files.length !== 1) return null
    return path.join(dir, files[0].name)
  }

  /**
   * Recursively deletes the payload directory for `jobId`. ENOENT is treated as already
   * cleaned up. Other errors are logged; this method does not throw.
   */
  async cleanupPayload(jobId: number): Promise<void> {
    const dir = this.getPayloadDirectory(jobId)
    try {
      await rm(dir, { recursive: true, force: true })
      logger.info({ jobId, path: dir }, 'Cleaned up payload directory')
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        logger.info({ jobId, path: dir }, 'Payload directory already absent during cleanup')
        return
      }
      logFsError('cleanupPayload', err)
    }
  }

  async storeSubmissionFiles(jobId: number, files: MultipartFile[]): Promise<string> {
    if (!files.length) {
      throw new FileServiceError('At least one file is required', 'FILES_REQUIRED', { httpStatus: 400 })
    }

    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)
    if (totalSize > this.maxTotalUploadBytes) {
      throw new FileServiceError(
        `Total upload size exceeds limit (${this.maxTotalUploadBytes} bytes)`,
        'UPLOAD_TOO_LARGE',
        { httpStatus: 413 }
      )
    }

    const inputPath = this.getInputPath(jobId)

    try {
      await mkdir(inputPath, { recursive: true })

      const fileNames = new Set<string>()
      const duplicates: string[] = []

      for (const file of files) {
        const safeFileName = assertSafeClientFileName(file.clientName)
        if (fileNames.has(safeFileName)) duplicates.push(safeFileName)
        fileNames.add(safeFileName)
      }

      if (duplicates.length > 0) {
        throw new FileServiceError(
          `Duplicate filenames detected: ${duplicates.join(', ')}. Each file must have a unique name.`,
          'DUPLICATE_FILENAMES',
          { httpStatus: 400 }
        )
      }

      let existingFiles: string[] = []
      try {
        existingFiles = await readdir(inputPath)
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }

      const conflicts: string[] = []
      for (const file of files) {
        const safeFileName = assertSafeClientFileName(file.clientName)
        if (existingFiles.includes(safeFileName)) conflicts.push(safeFileName)
      }

      if (conflicts.length > 0) {
        throw new FileServiceError(
          `Files already exist in this job submission: ${conflicts.join(', ')}. Cannot overwrite existing files.`,
          'FILE_ALREADY_EXISTS',
          { httpStatus: 400 }
        )
      }

      for (const file of files) {
        if (!file.isValid) {
          throw new FileServiceError(
            `Invalid upload for file ${file.clientName}`,
            'INVALID_FILE',
            { httpStatus: 400 }
          )
        }

        const safeFileName = assertSafeClientFileName(file.clientName)
        await file.move(inputPath, { name: safeFileName, overwrite: false })

        if (!file.isValid) {
          throw new FileServiceError(
            file.errors[0]?.message || `Failed to store file ${safeFileName}`,
            'FILE_MOVE_FAILED',
            { httpStatus: 400 }
          )
        }
      }

      return inputPath
    } catch (error: unknown) {
      await this.removeJobDirectoryBestEffort(jobId)

      if (error instanceof FileServiceError) throw error

      const err = error as NodeJS.ErrnoException
      if (err?.code === 'ENOSPC') {
        throw new FileServiceError('Disk is full while storing upload', 'INSUFFICIENT_STORAGE', {
          httpStatus: 507,
          cause: err,
        })
      }
      if (err?.code === 'EACCES') {
        throw new FileServiceError('Permission denied while storing upload', 'STORAGE_PERMISSION_DENIED', {
          httpStatus: 500,
          cause: err,
        })
      }

      logFsError('storeSubmissionFiles', error)
      throw new FileServiceError(
        `Unexpected error while storing upload: ${err?.message ?? error}`,
        'STORAGE_ERROR',
        { cause: error }
      )
    }
  }

  /**
   * Reads and normalizes `output/results.json` for a job.
   */
  async readResults(jobId: number): Promise<GradingResults> {
    const resultsPath = path.join(this.getOutputPath(jobId), RESULTS_JSON_NAME)

    let st
    try {
      st = await stat(resultsPath)
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        logger.info({ jobId, resultsPath }, 'Grading results file is missing')
        throw new FileServiceError(
          'Grading results file is missing',
          'RESULTS_MISSING',
          { cause: err }
        )
      }
      logFsError('readResults.stat', err)
      throw new FileServiceError(
        `Cannot read grading results: ${err?.message ?? err}`,
        'RESULTS_READ_FAILED',
        { cause: err }
      )
    }

    if (st.size === 0) {
      throw new FileServiceError('Grading results file is empty', 'RESULTS_EMPTY')
    }

    let raw: string
    try {
      raw = await readFile(resultsPath, 'utf8')
    } catch (err: any) {
      logFsError('readResults.readFile', err)
      throw new FileServiceError(
        `Cannot read grading results file: ${err?.message ?? err}`,
        'RESULTS_READ_FAILED',
        { cause: err }
      )
    }

    const trimmed = raw.trim()
    if (!trimmed) {
      throw new FileServiceError('Grading results file is empty', 'RESULTS_EMPTY')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch (err: any) {
      logFsError('readResults.json', err)
      throw new FileServiceError(
        'Grading results file contains invalid JSON',
        'RESULTS_INVALID_JSON',
        { cause: err }
      )
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logger.warn({ jobId }, 'results.json root is not a JSON object — returning empty result fields')
      return {}
    }

    const record = parsed as Record<string, unknown>
    const unknownKeys = Object.keys(record).filter((k) => !KNOWN_RESULT_KEYS.has(k))
    if (unknownKeys.length > 0) {
      logger.warn({ jobId, unknownKeys }, 'Unexpected keys in results.json — extracting known fields only')
    }

    const results: GradingResults = {
      correctness_score: coerceOptionalNumber(record.correctness_score),
      tool_score: coerceOptionalNumber(record.tool_score),
      comments: coerceOptionalString(record.comments),
      comment_format: coerceOptionalNumber(record.comment_format) as number | null | undefined,
      test_output: coerceOptionalString(record.test_output),
      container_logs: coerceOptionalString(record.container_logs),
      exit_code: coerceOptionalNumber(record.exit_code) as number | null | undefined,
      cpu_usage: coerceOptionalNumber(record.cpu_usage),
      ram_usage: coerceOptionalNumber(record.ram_usage) as number | null | undefined,
      runtime_ms: coerceOptionalNumber(record.runtime_ms) as number | null | undefined,
      pod_name: coerceOptionalString(record.pod_name),
      node_ip: coerceOptionalString(record.node_ip),
    }

    if (st.size > MAX_RESULTS_FILE_BYTES) {
      return truncateLargeTextFields(results)
    }

    return results
  }

  async getSubmissionDiskUsage(): Promise<number> {
    return directoryDiskUsageBytes(this.submissionsPath)
  }

  /**
   * Deletes `{submissions}/{id}/` directories whose numeric `id` is not in `activeJobIds`.
   * Only **directories** whose names are positive integers are considered; stray numeric files are left alone.
   */
  async cleanupOrphanedDirectories(activeJobIds: Set<number>, submissionsRoot?: string): Promise<number> {
    const root = submissionsRoot ?? this.submissionsPath
    let entries: Dirent[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (err: any) {
      if (err?.code === 'ENOENT') return 0
      logFsError('cleanupOrphanedDirectories.readdir', err)
      throw new FileServiceError(
        `Cannot list submissions directory: ${err?.message ?? err}`,
        'STORAGE_READ_FAILED',
        { cause: err }
      )
    }

    let cleaned = 0
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue
      const name = dirent.name
      const jobId = Number(name)
      if (!Number.isInteger(jobId) || jobId <= 0) continue
      if (activeJobIds.has(jobId)) continue

      const jobDir = path.join(root, name)
      try {
        await rm(jobDir, { recursive: true, force: true })
        cleaned++
        logger.info({ jobId }, `Removed orphaned submission directory for job ${jobId}`)
      } catch (err) {
        logFsError(`cleanupOrphanedDirectories.rm job ${jobId}`, err)
        throw new FileServiceError(
          `Failed to remove orphaned directory for job ${jobId}`,
          'ORPHAN_CLEANUP_FAILED',
          { cause: err }
        )
      }
    }

    return cleaned
  }
}

const fileService = new FileService()
export default fileService
