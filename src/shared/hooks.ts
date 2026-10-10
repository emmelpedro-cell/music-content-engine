import { z } from 'zod'

/** A reusable musical section of a song (spec §5 step 3): a named time range. */
export type Hook = {
  id: string
  songId: string
  name: string
  start: number
  end: number
  notes: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

const name = z.string().trim().min(1, 'Give the hook a name').max(120)
const seconds = z.number().min(0).max(24 * 3600)
const tags = z.array(z.string().trim().min(1).max(40)).max(20)

export const CreateHookInputSchema = z
  .object({
    songId: z.string().uuid(),
    name,
    start: seconds,
    end: seconds,
    notes: z.string().max(2000).nullable().optional(),
    tags: tags.optional()
  })
  .strict()
  .refine((h) => h.end - h.start >= 0.25, { message: 'A hook must be at least 0.25 seconds long', path: ['end'] })
export type CreateHookInput = z.infer<typeof CreateHookInputSchema>

export const UpdateHookInputSchema = z
  .object({
    id: z.string().uuid(),
    name: name.optional(),
    start: seconds.optional(),
    end: seconds.optional(),
    notes: z.string().max(2000).nullable().optional(),
    tags: tags.optional()
  })
  .strict()
export type UpdateHookInput = z.infer<typeof UpdateHookInputSchema>

/** Common short-form lengths (spec §5): presets, not limits. */
export const HOOK_LENGTH_PRESETS = [10, 15, 20, 30, 60]
