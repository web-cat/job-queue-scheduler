import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { errors } from '@adonisjs/http-server'
import type { MultipartFile } from '@adonisjs/core/bodyparser'

class FileService {
  private readonly submissionsPath = process.env.SUBMISSIONS_PATH || '/data/submissions'
  private readonly maxTotalUploadBytes = 50 * 1024 * 1024

  getInputPath(jobId: number): string {
    return path.join(this.submissionsPath, String(jobId), 'input')
  }

  /**
   * Clean up the submission directory for a job (called on submission failure)
   */
  async cleanupSubmissionDirectory(jobId: number): Promise<void> {
    const jobPath = path.join(this.submissionsPath, String(jobId))
    try {
      await rm(jobPath, { recursive: true, force: true })
    } catch (error) {
      // Log but don't throw — cleanup failures shouldn't cascade
      console.error(`Failed to cleanup submission directory for job ${jobId}:`, error)
    }
  }

  async storeSubmissionFiles(jobId: number, files: MultipartFile[]): Promise<string> {
    if (!files.length) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        { error: { code: 'FILES_REQUIRED', message: 'At least one file is required' } },
        400
      )
    }

    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)
    if (totalSize > this.maxTotalUploadBytes) {
      throw errors.E_HTTP_EXCEPTION.invoke(
        {
          error: {
            code: 'UPLOAD_TOO_LARGE',
            message: 'Total upload size exceeds 50MB limit',
          },
        },
        413
      )
    }

    const inputPath = this.getInputPath(jobId)

    try {
      await mkdir(inputPath, { recursive: true })

      // Check for duplicate filenames in current batch
      const fileNames = new Set<string>()
      const duplicates: string[] = []

      for (const file of files) {
        const safeFileName = path.basename(file.clientName)
        if (fileNames.has(safeFileName)) {
          duplicates.push(safeFileName)
        }
        fileNames.add(safeFileName)
      }

      if (duplicates.length > 0) {
        throw errors.E_HTTP_EXCEPTION.invoke(
          {
            error: {
              code: 'DUPLICATE_FILENAMES',
              message: `Duplicate filenames detected: ${duplicates.join(', ')}. Each file must have a unique name.`,
            },
          },
          400
        )
      }

      // Check for conflicts with existing files
      let existingFiles: string[] = []
      try {
        existingFiles = await readdir(inputPath)
      } catch (error: any) {
        // Directory doesn't exist yet, that's fine
        if (error?.code !== 'ENOENT') {
          throw error
        }
      }

      const conflicts: string[] = []
      for (const file of files) {
        const safeFileName = path.basename(file.clientName)
        if (existingFiles.includes(safeFileName)) {
          conflicts.push(safeFileName)
        }
      }

      if (conflicts.length > 0) {
        throw errors.E_HTTP_EXCEPTION.invoke(
          {
            error: {
              code: 'FILE_ALREADY_EXISTS',
              message: `Files already exist in this job submission: ${conflicts.join(', ')}. Cannot overwrite existing files.`,
            },
          },
          400
        )
      }

      for (const file of files) {
        if (!file.isValid) {
          throw errors.E_HTTP_EXCEPTION.invoke(
            {
              error: {
                code: 'INVALID_FILE',
                message: `Invalid upload for file ${file.clientName}`,
              },
            },
            400
          )
        }

        const safeFileName = path.basename(file.clientName)
        await file.move(inputPath, { name: safeFileName, overwrite: false })

        if (!file.isValid) {
          throw errors.E_HTTP_EXCEPTION.invoke(
            {
              error: {
                code: 'FILE_MOVE_FAILED',
                message: file.errors[0]?.message || `Failed to store file ${safeFileName}`,
              },
            },
            400
          )
        }
      }

      return inputPath
    } catch (error: any) {
      await this.cleanupSubmissionDirectory(jobId)

      if (error?.code === 'ENOSPC') {
        throw errors.E_HTTP_EXCEPTION.invoke(
          { error: { code: 'INSUFFICIENT_STORAGE', message: 'Disk is full while storing upload' } },
          507
        )
      }

      if (error?.code === 'EACCES') {
        throw errors.E_HTTP_EXCEPTION.invoke(
          {
            error: {
              code: 'STORAGE_PERMISSION_DENIED',
              message: 'Permission denied while storing upload',
            },
          },
          500
        )
      }

      throw error
    }
  }
}

const fileService = new FileService()
export default fileService
