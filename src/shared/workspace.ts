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

/** Every language Whisper (large-v3) can transcribe. Accuracy varies a lot: best for widely spoken languages. */
export const TRANSCRIPTION_LANGUAGES: { code: string | null; label: string }[] = [
  { code: null, label: 'Detect automatically' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hy', label: 'Armenian' },
  { code: 'as', label: 'Assamese' },
  { code: 'az', label: 'Azerbaijani' },
  { code: 'ba', label: 'Bashkir' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bn', label: 'Bengali' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'br', label: 'Breton' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese' },
  { code: 'yue', label: 'Cantonese' },
  { code: 'ca', label: 'Catalan' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'et', label: 'Estonian' },
  { code: 'fo', label: 'Faroese' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'ht', label: 'Haitian Creole' },
  { code: 'ha', label: 'Hausa' },
  { code: 'haw', label: 'Hawaiian' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'jw', label: 'Javanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'ko', label: 'Korean' },
  { code: 'lo', label: 'Lao' },
  { code: 'la', label: 'Latin' },
  { code: 'lv', label: 'Latvian' },
  { code: 'ln', label: 'Lingala' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'lb', label: 'Luxembourgish' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'mg', label: 'Malagasy' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'mt', label: 'Maltese' },
  { code: 'mi', label: 'Maori' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'ne', label: 'Nepali' },
  { code: 'no', label: 'Norwegian' },
  { code: 'nn', label: 'Norwegian Nynorsk' },
  { code: 'oc', label: 'Occitan' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sa', label: 'Sanskrit' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sn', label: 'Shona' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'es', label: 'Spanish' },
  { code: 'su', label: 'Sundanese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'tg', label: 'Tajik' },
  { code: 'ta', label: 'Tamil' },
  { code: 'tt', label: 'Tatar' },
  { code: 'te', label: 'Telugu' },
  { code: 'th', label: 'Thai' },
  { code: 'bo', label: 'Tibetan' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
  { code: 'yi', label: 'Yiddish' },
  { code: 'yo', label: 'Yoruba' }
]
