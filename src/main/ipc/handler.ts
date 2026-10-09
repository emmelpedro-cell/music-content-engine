import type { ZodType, ZodTypeDef } from 'zod'
import type { IpcResult } from '../../shared/schemas'
import type { Logger } from '../logger'
import { NotFoundError } from '../repositories/projects'

export class ForbiddenError extends Error {
  override name = 'ForbiddenError'
}

export type HandlerDefinition<In, Out> = {
  schema: ZodType<In, ZodTypeDef, unknown>
  handle: (input: In) => Out | Promise<Out>
}

/** Helper that keeps input/output types linked when building the handler table. */
export function defineHandler<In, Out>(definition: HandlerDefinition<In, Out>): HandlerDefinition<In, Out> {
  return definition
}

/**
 * Wraps a handler so that:
 * - input is validated with its zod schema before any code runs,
 * - errors become a typed { ok: false } result instead of a rejected promise
 *   (Electron strips error details across IPC),
 * - unexpected errors are logged with full detail but returned generically.
 */
export function wrapHandler<In, Out>(
  channel: string,
  definition: HandlerDefinition<In, Out>,
  logger: Logger
): (rawInput: unknown) => Promise<IpcResult<Out>> {
  return async (rawInput) => {
    const parsed = definition.schema.safeParse(rawInput)
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ')
      logger.warn('Rejected IPC input', { channel, message })
      return { ok: false, error: { code: 'VALIDATION', message } }
    }
    try {
      const data = await definition.handle(parsed.data)
      return { ok: true, data }
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { ok: false, error: { code: 'NOT_FOUND', message: error.message } }
      }
      if (error instanceof ForbiddenError) {
        return { ok: false, error: { code: 'FORBIDDEN', message: error.message } }
      }
      logger.error('IPC handler failed', { channel, error })
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'Something went wrong. Details were written to the log file (Settings → Open logs folder).'
        }
      }
    }
  }
}
