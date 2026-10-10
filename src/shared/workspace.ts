import { z } from 'zod'
import { BeatCorrectionsSchema, type BeatCorrections, type BeatMap, type MusicAnalysis } from './analysis'
import type { Hook } from './hooks'
import type { LyricsState } from './lyrics'
import type { MediaAsset } from './media'
import type { Project } from './schemas'

export type AnalysisState = {
  assetId: string
  status: 'pending' | 'processing' | 'ready' | 'error'
  error: string | null
  /** Present when ready (and kept from the previous run while re-analysing). */
  analysis: MusicAnalysis | null
  updatedAt: string
}

/** Everything the song workspace screen needs, in one call. */
export type SongWorkspace = {
  project: Project
  audio: MediaAsset | null
  analysis: AnalysisState | null
  corrections: BeatCorrections
  beatMap: BeatMap | null
  lyrics: LyricsState
  hooks: Hook[]
}

export type SpeechToolsStatus =
  | { ok: true; version: string; directory: string }
  | { ok: false; code: 'UNSUPPORTED' | 'MISSING' | 'RUNTIME_MISSING' | 'FAILED'; message: string; detail: string }

export type SpeechModelInfo = {
  id: string
  label: string
  description: string
  sizeBytes: number
  recommended: boolean
  installed: boolean
  download: { received: number; total: number } | null
  error: string | null
}

export type WorkspaceEvent =
  | { type: 'analysis'; state: AnalysisState }
  | { type: 'lyrics'; state: LyricsState }
  | { type: 'models'; models: SpeechModelInfo[] }

/* ------------------------------------------------------------------ */
/* IPC inputs                                                         */
/* ------------------------------------------------------------------ */

export const SongIdInputSchema = z.object({ songId: z.string().uuid('Invalid song id') }).strict()
export const AssetIdOnlySchema = z.object({ assetId: z.string().uuid('Invalid asset id') }).strict()
export const HookIdInputSchema = z.object({ id: z.string().uuid('Invalid hook id') }).strict()

export const SetCorrectionsInputSchema = z.object({ songId: z.string().uuid(), corrections: BeatCorrectionsSchema }).strict()

export const MODEL_ID = z.string().regex(/^[a-z0-9._-]{2,40}$/, 'Invalid model id')
export const ModelIdInputSchema = z.object({ id: MODEL_ID }).strict()

/** Whisper language codes: ISO 639-1 (two letters) plus a few longer ones; null = detect. */
export const TranscribeInputSchema = z
  .object({
    songId: z.string().uuid(),
    model: MODEL_ID,
    language: z.string().regex(/^[a-z]{2,3}$/, 'Invalid language code').nullable()
  })
  .strict()
export type TranscribeInput = z.infer<typeof TranscribeInputSchema>

/** Languages offered in the UI (Whisper supports many more; these cover the common cases). */
export const TRANSCRIPTION_LANGUAGES: { code: string | null; label: string }[] = [
  { code: null, label: 'Detect automatically' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'it', label: 'Italian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'tr', label: 'Turkish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' }
]
