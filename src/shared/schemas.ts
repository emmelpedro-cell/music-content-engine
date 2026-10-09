import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Song projects                                                      */
/* ------------------------------------------------------------------ */

const title = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(200, 'Title must be 200 characters or fewer')

const artist = z.string().trim().max(200, 'Artist must be 200 characters or fewer')

export const ProjectIdSchema = z.string().uuid('Invalid project id')

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  title: z.string(),
  artist: z.string().nullable(),
  sourceAudioPath: z.string().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Project = z.infer<typeof ProjectSchema>

export const CreateProjectInputSchema = z
  .object({
    title,
    // Empty artist strings are stored as null.
    artist: artist.optional().transform((v) => (v ? v : null))
  })
  .strict()
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>
export type CreateProjectData = z.output<typeof CreateProjectInputSchema>

export const UpdateProjectInputSchema = z
  .object({
    id: ProjectIdSchema,
    title: title.optional(),
    artist: artist
      .nullable()
      .optional()
      .transform((v) => (v === '' ? null : v))
  })
  .strict()
  .refine((v) => v.title !== undefined || v.artist !== undefined, {
    message: 'Nothing to update'
  })
export type UpdateProjectInput = z.input<typeof UpdateProjectInputSchema>
export type UpdateProjectData = z.output<typeof UpdateProjectInputSchema>

export const ProjectIdInputSchema = z.object({ id: ProjectIdSchema }).strict()
export type ProjectIdInput = z.infer<typeof ProjectIdInputSchema>

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export const DEFAULT_SETTINGS = {
  accentColor: '#e8a33d',
  exportDirectory: null as string | null,
  renderConcurrency: 1
}

export const SettingsSchema = z.object({
  accentColor: z.string().regex(HEX_COLOR, 'Accent color must be #RRGGBB'),
  exportDirectory: z.string().min(1).nullable(),
  renderConcurrency: z.number().int().min(1).max(8)
})
export type Settings = z.infer<typeof SettingsSchema>

/** Only these keys may be changed from the renderer. Directories go through native dialogs. */
export const SettingsUpdateInputSchema = z
  .object({
    accentColor: SettingsSchema.shape.accentColor.optional(),
    renderConcurrency: SettingsSchema.shape.renderConcurrency.optional()
  })
  .strict()
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateInputSchema>

/* ------------------------------------------------------------------ */
/* App info, logging, IPC envelope                                    */
/* ------------------------------------------------------------------ */

export type AppInfo = {
  version: string
  rootDirectory: string
  appDataDirectory: string
  databasePath: string
  logsDirectory: string
  exportDirectory: string
  schemaVersion: number
  rootDirectoryOverridden: boolean
}

export type DirectoryChoiceResult =
  | { changed: false }
  | { changed: true; path: string; restartRequired: boolean }

export const LogWriteInputSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1).max(4000),
    context: z.record(z.unknown()).optional()
  })
  .strict()
export type LogWriteInput = z.infer<typeof LogWriteInputSchema>

/** No input expected. Accepts undefined or an empty object, nothing else. */
export const EmptyInputSchema = z.union([z.undefined(), z.object({}).strict()])

export type IpcErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL'

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: IpcErrorCode; message: string } }
