import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { timingSafeEqual } from 'node:crypto'

function safeEqual(a: string, b: string): boolean {
  // timingSafeEqual requires same length buffers.
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

function extractApiKey(ctx: HttpContext): string | null {
  const headerKey = ctx.request.header('x-api-key')
  if (headerKey && headerKey.trim().length > 0) return headerKey.trim()

  // Do NOT read from Authorization header.
  // We reserve `Authorization: Bearer <token>` for end-user / admin access tokens.
  return null
}

export default class ServiceAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const expected = process.env.SERVICE_API_KEY?.trim()
    if (!expected) {
      // Misconfiguration: keep the service secure by default.
      return ctx.response.unauthorized({ errors: [{ message: 'Unauthorized access' }] })
    }

    const provided = extractApiKey(ctx)
    if (!provided || !safeEqual(provided, expected)) {
      return ctx.response.unauthorized({ errors: [{ message: 'Unauthorized access' }] })
    }

    return next()
  }
}

