import { z } from 'zod'

/** Bump when the algorithm changes in a way that should invalidate cached analyses. */
export const ANALYSIS_VERSION = 2

export type TempoCandidate = { bpm: number; score: number }

/**
 * Result of automatic analysis of one audio file. Everything here is an
 * estimate; the user's corrections live separately (BeatCorrections) and are
 * applied by resolveBeatMap.
 */
export type MusicAnalysis = {
  version: number
  durationSeconds: number
  /** Tempo from the median inter-beat interval of tracked beats; null if no beat was found. */
  bpm: number | null
  /** 0..1, how clearly one tempo dominates. */
  tempoConfidence: number
  /** Best tempo, then alternatives such as half and double time. */
  tempoCandidates: TempoCandidate[]
  /** Beat times in seconds, ascending. */
  beats: number[]
  /** 0..1 onset strength at each beat. */
  beatStrengths: number[]
  /** Assumed beats per bar for downbeat estimation (4 unless corrected). */
  beatsPerBar: number
  /** Index in `beats` of the first downbeat (0..beatsPerBar-1). */
  downbeatPhase: number
  /** 0..1, how clearly that phase stands out from the others. */
  downbeatConfidence: number
  /** 0..1, regularity of the beat intervals (1 = metronomic). */
  tempoStability: number
  /** Loudness curve, `energyRate` values per second, 0..1. */
  energy: number[]
  energyRate: number
  /** Human-readable caveats, e.g. "No clear beat found". */
  warnings: string[]
}

/** Peaks for drawing: interleaved [min, max] pairs as signed bytes, `rate` pairs per second. */
export type Waveform = { rate: number; durationSeconds: number; peaks: Uint8Array }

/* ------------------------------------------------------------------ */
/* User corrections                                                   */
/* ------------------------------------------------------------------ */

export const BeatCorrectionsSchema = z
  .object({
    /** 'detected': use analysed beats with the adjustments below. 'grid': constant tempo grid. */
    mode: z.enum(['detected', 'grid']),
    /** Moves every beat (seconds). */
    shiftSeconds: z.number().min(-2).max(2),
    /** 0.5 = half time, 2 = double time. */
    tempoFactor: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
    beatsPerBar: z.number().int().min(2).max(12),
    /** Which beat is "1" (0-based index into the beat list modulo beatsPerBar); null = automatic. */
    downbeatPhase: z.number().int().min(0).max(11).nullable(),
    /** Grid mode: tempo and the time of one downbeat. */
    gridBpm: z.number().min(30).max(300).nullable(),
    gridAnchor: z.number().min(0).nullable(),
    /** Individual marker edits in detected mode, as times (seconds), matched within 40 ms. */
    added: z.array(z.number().min(0)).max(5000),
    removed: z.array(z.number().min(0)).max(5000)
  })
  .strict()
export type BeatCorrections = z.infer<typeof BeatCorrectionsSchema>

export const DEFAULT_CORRECTIONS: BeatCorrections = {
  mode: 'detected',
  shiftSeconds: 0,
  tempoFactor: 1,
  beatsPerBar: 4,
  downbeatPhase: null,
  gridBpm: null,
  gridAnchor: null,
  added: [],
  removed: []
}

export type BeatMap = {
  bpm: number | null
  beats: number[]
  downbeats: number[]
  beatsPerBar: number
  /** Whether any correction changes the automatic result. */
  corrected: boolean
}

const MATCH_TOLERANCE = 0.04

/**
 * Applies the user's corrections to an analysis. Pure, so the same input
 * always yields the same beat map, and a re-analysis keeps the corrections.
 */
export function resolveBeatMap(analysis: Pick<MusicAnalysis, 'beats' | 'bpm' | 'downbeatPhase' | 'durationSeconds'>, c: BeatCorrections): BeatMap {
  const duration = analysis.durationSeconds
  const corrected =
    c.mode === 'grid' ||
    c.shiftSeconds !== 0 ||
    c.tempoFactor !== 1 ||
    c.beatsPerBar !== 4 ||
    c.downbeatPhase !== null ||
    c.added.length > 0 ||
    c.removed.length > 0

  if (c.mode === 'grid' && c.gridBpm && c.gridAnchor !== null) {
    const period = 60 / c.gridBpm
    const beats: number[] = []
    const first = c.gridAnchor - Math.floor(c.gridAnchor / period) * period
    for (let t = first; t <= duration + 1e-9; t += period) beats.push(round(t))
    const anchorIndex = Math.round((c.gridAnchor - first) / period)
    const phase = ((anchorIndex % c.beatsPerBar) + c.beatsPerBar) % c.beatsPerBar
    return {
      bpm: c.gridBpm,
      beats,
      downbeats: beats.filter((_, i) => i % c.beatsPerBar === phase),
      beatsPerBar: c.beatsPerBar,
      corrected: true
    }
  }

  let beats = analysis.beats.slice()
  if (c.tempoFactor === 0.5) beats = beats.filter((_, i) => i % 2 === 0)
  if (c.tempoFactor === 2) {
    const doubled: number[] = []
    for (let i = 0; i < beats.length; i++) {
      doubled.push(beats[i]!)
      if (i + 1 < beats.length) doubled.push((beats[i]! + beats[i + 1]!) / 2)
    }
    beats = doubled
  }
  beats = beats.map((t) => t + c.shiftSeconds).filter((t) => t >= 0 && t <= duration)
  if (c.removed.length) beats = beats.filter((t) => !c.removed.some((r) => Math.abs(r - t) <= MATCH_TOLERANCE))
  if (c.added.length) beats = [...beats, ...c.added.filter((a) => a <= duration)].sort((a, b) => a - b)
  beats = beats.map(round)

  const autoPhase = c.tempoFactor === 1 ? analysis.downbeatPhase : 0
  const phase = Math.min(c.downbeatPhase ?? autoPhase, c.beatsPerBar - 1)
  const bpm = medianBpm(beats) ?? (analysis.bpm ? analysis.bpm * c.tempoFactor : null)
  return {
    bpm: bpm === null ? null : Math.round(bpm * 100) / 100,
    beats,
    downbeats: beats.filter((_, i) => i % c.beatsPerBar === phase),
    beatsPerBar: c.beatsPerBar,
    corrected
  }
}

export function medianBpm(beats: readonly number[]): number | null {
  if (beats.length < 3) return null
  const intervals = beats
    .slice(1)
    .map((t, i) => t - beats[i]!)
    .sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]!
  return median > 0 ? 60 / median : null
}

const round = (t: number) => Math.round(t * 10000) / 10000
