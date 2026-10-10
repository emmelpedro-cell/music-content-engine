import { ANALYSIS_VERSION, medianBpm, type MusicAnalysis, type TempoCandidate, type Waveform } from '../../shared/analysis'
import { MagnitudeFft } from './fft'

/**
 * Automatic music analysis, in plain TypeScript (see TECHNICAL_DECISIONS TD-021).
 *
 *   samples ─► STFT ─► log-magnitude spectral flux ─► onset envelope
 *                         └─► low-band flux (kick/bass) ─► downbeat phase
 *   onset envelope ─► autocorrelation × tempo prior ─► tempo (+ half/double candidates)
 *   onset envelope + tempo ─► dynamic-programming beat tracker (Ellis 2007) ─► beats
 *   samples ─► RMS ─► energy curve;  samples ─► min/max peaks ─► waveform
 *
 * Everything is an estimate and is presented as one; corrections are applied separately.
 */

export const ANALYSIS_SAMPLE_RATE = 22050
const FFT_SIZE = 1024
const HOP = 256 // 11.6 ms at 22050 Hz
const MIN_BPM = 50
const MAX_BPM = 220
const PRIOR_CENTER_BPM = 120
const TIGHTNESS = 100
/** Onset strength on beats vs. average below which there is no usable beat (noise ≈ 5, rhythmic music ≥ 9). */
const MIN_SALIENCE = 7

export type AnalysisInput = { samples: Float32Array; sampleRate: number }

export type OnsetFeatures = {
  /** Frames per second of the envelopes. */
  fps: number
  /** Broadband onset strength, normalised (zero mean-ish, unit std), >= 0. */
  onset: Float64Array
  /** Low-frequency (≈40–180 Hz) onset strength, same scale. */
  lowOnset: Float64Array
}

export function onsetFeatures({ samples, sampleRate }: AnalysisInput): OnsetFeatures {
  const fft = new MagnitudeFft(FFT_SIZE)
  const bins = FFT_SIZE / 2 + 1
  const frames = Math.max(0, Math.floor((samples.length - 1) / HOP) + 1)
  const binHz = sampleRate / FFT_SIZE
  const lowStart = Math.max(1, Math.round(40 / binHz))
  const lowEnd = Math.max(lowStart + 1, Math.round(180 / binHz))

  const mag = new Float64Array(bins)
  let prev = new Float64Array(bins)
  let curr = new Float64Array(bins)
  const flux = new Float64Array(frames)
  const lowFlux = new Float64Array(frames)

  for (let f = 0; f < frames; f++) {
    // Centre frames on their hop position.
    fft.magnitudes(samples, f * HOP - FFT_SIZE / 2, mag)
    for (let k = 0; k < bins; k++) curr[k] = Math.log1p(100 * mag[k]!)
    if (f > 0) {
      let sum = 0
      let low = 0
      for (let k = 1; k < bins; k++) {
        const d = curr[k]! - prev[k]!
        if (d > 0) {
          sum += d
          if (k >= lowStart && k <= lowEnd) low += d
        }
      }
      flux[f] = sum
      lowFlux[f] = low
    }
    const swap = prev
    prev = curr
    curr = swap
  }

  const fps = sampleRate / HOP
  return { fps, onset: normalise(detrend(flux, Math.round(fps * 0.5))), lowOnset: normalise(detrend(lowFlux, Math.round(fps * 0.5))) }
}

/** Subtracts a moving average and clips at zero (keeps the attacks, removes slow swells). */
function detrend(x: Float64Array, radius: number): Float64Array {
  const out = new Float64Array(x.length)
  let sum = 0
  let count = 0
  let lo = 0
  let hi = -1
  for (let i = 0; i < x.length; i++) {
    while (hi < Math.min(x.length - 1, i + radius)) sum += x[++hi]!, count++
    while (lo < i - radius) sum -= x[lo++]!, count--
    out[i] = Math.max(0, x[i]! - sum / count)
  }
  return out
}

function normalise(x: Float64Array): Float64Array {
  let mean = 0
  for (const v of x) mean += v
  mean /= x.length || 1
  let variance = 0
  for (const v of x) variance += (v - mean) ** 2
  const std = Math.sqrt(variance / (x.length || 1))
  if (std < 1e-9) return new Float64Array(x.length)
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i]! / std
  return out
}

/* ------------------------------------------------------------------ */
/* Tempo                                                              */
/* ------------------------------------------------------------------ */

export type TempoEstimate = {
  bpm: number
  confidence: number
  candidates: TempoCandidate[]
}

export function estimateTempo(onset: Float64Array, fps: number): TempoEstimate | null {
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM) * 2
  if (onset.length < maxLag * 2) return null

  // Autocorrelation of the onset envelope.
  const ac = new Float64Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i]! * onset[i - lag]!
    ac[lag] = s / (onset.length - lag)
  }

  // Score each lag: its own peak plus its multiples (a true beat period also lines up
  // at 2× and 4×), weighted by a broad prior around 120 BPM (log-normal, 1 octave).
  const at = (lag: number) => {
    const i = Math.floor(lag)
    const frac = lag - i
    return i + 1 < ac.length ? ac[i]! * (1 - frac) + ac[i + 1]! * frac : 0
  }
  const prior = (bpm: number) => Math.exp(-0.5 * Math.log2(bpm / PRIOR_CENTER_BPM) ** 2)
  const raw = (lag: number) => at(lag) + 0.5 * at(lag * 2) + 0.25 * (lag * 4 <= maxLag ? at(lag * 4) : 0)

  const maxBeatLag = Math.ceil((60 * fps) / MIN_BPM)
  let best = -Infinity
  let bestLag = minLag
  const scores: { lag: number; score: number }[] = []
  for (let lag = minLag; lag <= maxBeatLag; lag++) {
    const bpm = (60 * fps) / lag
    const score = raw(lag) * prior(bpm)
    scores.push({ lag, score })
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  if (!(best > 0)) return null

  // Parabolic refinement of the peak for sub-frame precision.
  const s = (lag: number) => raw(lag) * prior((60 * fps) / lag)
  const y0 = s(bestLag - 1)
  const y1 = s(bestLag)
  const y2 = s(bestLag + 1)
  const denom = y0 - 2 * y1 + y2
  const lag = denom < 0 ? bestLag + (0.5 * (y0 - y2)) / denom : bestLag
  let bpm = (60 * fps) / lag
  // Very fast tempos are usually eighth notes; prefer half time when it scores almost as well.
  // (174 BPM drum & bass stays as it is.)
  if (bpm > 180 && s((60 * fps) / (bpm / 2)) >= 0.7 * best) bpm /= 2

  const sorted = scores.map((x) => x.score).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const confidence = clamp01((best - median) / (best + 1e-9))

  const candidate = (b: number): TempoCandidate | null =>
    b >= MIN_BPM / 2 && b <= MAX_BPM * 2 ? { bpm: round2(b), score: round2(clamp01(s((60 * fps) / b) / best)) } : null
  // `s` is only defined on lags inside the autocorrelation range.
  const candidates = [candidate(bpm), candidate(bpm / 2), candidate(bpm * 2), candidate((bpm * 2) / 3), candidate((bpm * 3) / 2)]
    .filter((c): c is TempoCandidate => c !== null && c.score > 0)

  return { bpm, confidence, candidates }
}

/* ------------------------------------------------------------------ */
/* Beat tracking (dynamic programming, Ellis 2007)                    */
/* ------------------------------------------------------------------ */

export function trackBeats(onset: Float64Array, fps: number, bpm: number): { frames: number[]; strengths: number[] } {
  const period = (60 * fps) / bpm
  // Smooth the onset envelope with a Gaussian scaled to the beat period.
  const half = Math.ceil(period)
  const kernel: number[] = []
  for (let i = -half; i <= half; i++) kernel.push(Math.exp(-0.5 * ((i * 32) / period) ** 2))
  const local = new Float64Array(onset.length)
  for (let i = 0; i < onset.length; i++) {
    let v = 0
    for (let k = 0; k < kernel.length; k++) {
      const j = i + k - half
      if (j >= 0 && j < onset.length) v += onset[j]! * kernel[k]!
    }
    local[i] = v
  }

  const cumulative = new Float64Array(onset.length)
  const backlink = new Int32Array(onset.length).fill(-1)
  const from = Math.round(period / 2)
  const to = Math.round(period * 2)
  let firstBeat = true
  const startThreshold = 0.01 * Math.max(1e-9, max(local))
  for (let i = 0; i < onset.length; i++) {
    let bestScore = -Infinity
    let bestPrev = -1
    for (let d = from; d <= to; d++) {
      const p = i - d
      if (p < 0) break
      const penalty = -TIGHTNESS * Math.log(d / period) ** 2
      const score = cumulative[p]! + penalty
      if (score > bestScore) {
        bestScore = score
        bestPrev = p
      }
    }
    // Don't start a chain before the music does.
    if (firstBeat && local[i]! < startThreshold) {
      cumulative[i] = local[i]!
      continue
    }
    firstBeat = false
    cumulative[i] = local[i]! + Math.max(0, bestScore === -Infinity ? 0 : bestScore)
    backlink[i] = bestScore > 0 ? bestPrev : -1
  }

  // Start from the last strong local maximum of the cumulative score.
  const maxima: number[] = []
  for (let i = 1; i < cumulative.length - 1; i++) {
    if (cumulative[i]! > cumulative[i - 1]! && cumulative[i]! >= cumulative[i + 1]!) maxima.push(i)
  }
  if (maxima.length === 0) return { frames: [], strengths: [] }
  const median = maxima.map((i) => cumulative[i]!).sort((a, b) => a - b)[Math.floor(maxima.length / 2)]!
  let tail = maxima[maxima.length - 1]!
  for (let k = maxima.length - 1; k >= 0; k--) {
    if (cumulative[maxima[k]!]! >= 0.5 * median) {
      tail = maxima[k]!
      break
    }
  }

  const frames: number[] = []
  for (let i = tail; i >= 0; i = backlink[i]!) {
    frames.push(i)
    if (backlink[i]! < 0) break
  }
  frames.reverse()

  // Trim weak beats at the edges (silence or fade-in/out).
  const strengthsRaw = frames.map((f) => local[f]!)
  const rms = Math.sqrt(strengthsRaw.reduce((a, v) => a + v * v, 0) / (strengthsRaw.length || 1))
  let startIdx = 0
  let endIdx = frames.length - 1
  while (startIdx < endIdx && strengthsRaw[startIdx]! < 0.5 * rms) startIdx++
  while (endIdx > startIdx && strengthsRaw[endIdx]! < 0.5 * rms) endIdx--
  const kept = frames.slice(startIdx, endIdx + 1)

  // Sub-frame refinement on the smoothed envelope.
  const refined = kept.map((f) => {
    if (f <= 0 || f >= local.length - 1) return f
    const a = local[f - 1]!
    const b = local[f]!
    const c = local[f + 1]!
    const den = a - 2 * b + c
    return den < 0 ? f + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : f
  })
  const top = Math.max(1e-9, ...kept.map((f) => local[f]!))
  return { frames: refined, strengths: kept.map((f) => round2(local[f]! / top)) }
}

/* ------------------------------------------------------------------ */
/* Downbeats                                                          */
/* ------------------------------------------------------------------ */

/** Picks which beat in each bar is "1": the phase with the strongest low-frequency attacks. */
export function estimateDownbeatPhase(
  beatFrames: number[],
  lowOnset: Float64Array,
  onset: Float64Array,
  beatsPerBar: number
): { phase: number; confidence: number } {
  if (beatFrames.length < beatsPerBar * 2) return { phase: 0, confidence: 0 }
  const valueAt = (env: Float64Array, f: number) => {
    const i = Math.round(f)
    let v = 0
    for (let k = -2; k <= 2; k++) v = Math.max(v, env[i + k] ?? 0)
    return v
  }
  const scores = Array.from({ length: beatsPerBar }, (_, phase) => {
    let s = 0
    let n = 0
    for (let i = phase; i < beatFrames.length; i += beatsPerBar) {
      s += valueAt(lowOnset, beatFrames[i]!) + 0.25 * valueAt(onset, beatFrames[i]!)
      n++
    }
    return n ? s / n : 0
  })
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s)
  const best = order[0]!
  const second = order[1]!
  return { phase: best.i, confidence: round2(clamp01((best.s - second.s) / (best.s + 1e-9))) }
}

/* ------------------------------------------------------------------ */
/* Energy and waveform                                                */
/* ------------------------------------------------------------------ */

export const ENERGY_RATE = 10

export function energyCurve({ samples, sampleRate }: AnalysisInput, rate = ENERGY_RATE): number[] {
  const window = Math.max(1, Math.round(sampleRate / rate))
  const count = Math.ceil(samples.length / window)
  const db: number[] = []
  for (let w = 0; w < count; w++) {
    let sum = 0
    const start = w * window
    const end = Math.min(samples.length, start + window)
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    db.push(20 * Math.log10(rms + 1e-9))
  }
  const peak = Math.max(...db, -120)
  const floor = peak - 50
  const linear = db.map((v) => clamp01((v - floor) / (peak - floor)))
  // Light smoothing so single transients don't dominate.
  return linear.map((v, i) => round2(((linear[i - 1] ?? v) + 2 * v + (linear[i + 1] ?? v)) / 4))
}

export const WAVEFORM_RATE = 100

export function waveformPeaks({ samples, sampleRate }: AnalysisInput, rate = WAVEFORM_RATE): Waveform {
  const bucket = sampleRate / rate
  const count = Math.ceil(samples.length / bucket)
  const peaks = new Uint8Array(count * 2)
  const view = new Int8Array(peaks.buffer)
  for (let b = 0; b < count; b++) {
    let lo = 0
    let hi = 0
    const start = Math.floor(b * bucket)
    const end = Math.min(samples.length, Math.floor((b + 1) * bucket))
    for (let i = start; i < end; i++) {
      const v = samples[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    view[b * 2] = Math.max(-127, Math.round(lo * 127))
    view[b * 2 + 1] = Math.min(127, Math.round(hi * 127))
  }
  return { rate, durationSeconds: samples.length / sampleRate, peaks }
}

/* ------------------------------------------------------------------ */
/* Whole analysis                                                     */
/* ------------------------------------------------------------------ */

export function analyzeSamples(input: AnalysisInput, options: { beatsPerBar?: number } = {}): MusicAnalysis {
  const beatsPerBar = options.beatsPerBar ?? 4
  const durationSeconds = input.samples.length / input.sampleRate
  const warnings: string[] = []
  const energy = energyCurve(input)
  const base = {
    version: ANALYSIS_VERSION,
    durationSeconds: round4(durationSeconds),
    beatsPerBar,
    energy,
    energyRate: ENERGY_RATE
  }
  const empty = (warning: string): MusicAnalysis => ({
    ...base,
    bpm: null,
    tempoConfidence: 0,
    tempoCandidates: [],
    beats: [],
    beatStrengths: [],
    downbeatPhase: 0,
    downbeatConfidence: 0,
    tempoStability: 0,
    warnings: [...warnings, warning]
  })

  if (durationSeconds < 4) return empty('The audio is too short to estimate a tempo (at least 4 seconds needed).')
  const features = onsetFeatures(input)
  const tempo = estimateTempo(features.onset, features.fps)
  if (!tempo) return empty('No clear beat was found. Set the tempo manually.')

  const tracked = trackBeats(features.onset, features.fps, tempo.bpm)
  if (tracked.frames.length < 4) return empty('No clear beat was found. Set the tempo manually.')

  // Without real rhythmic attacks (ambient pads, noise) the tracker would still produce a
  // regular grid. Report "no clear beat" instead of inventing markers.
  if (beatSalience(features.onset, tracked.frames) < MIN_SALIENCE) {
    return empty('No clear beat was found (no regular rhythmic attacks). Set the tempo manually if the song has one.')
  }
  const beats = tracked.frames.map((f) => round4(f / features.fps))
  const downbeat = estimateDownbeatPhase(tracked.frames, features.lowOnset, features.onset, beatsPerBar)
  const intervals = beats.slice(1).map((t, i) => t - beats[i]!)
  const mean = intervals.reduce((a, v) => a + v, 0) / intervals.length
  const std = Math.sqrt(intervals.reduce((a, v) => a + (v - mean) ** 2, 0) / intervals.length)
  const tempoStability = round2(clamp01(1 - std / mean / 0.1))

  if (tempo.confidence < 0.6) warnings.push('The tempo is ambiguous. Check the beat markers against the waveform.')
  if (tempoStability < 0.5) warnings.push('The tempo varies a lot (live playing or tempo changes). Beat markers follow it, but check them.')
  if (downbeat.confidence < 0.1) warnings.push('The first beat of each bar is uncertain. Set it on the timeline if it’s wrong.')

  const bpm = medianBpm(beats)
  return {
    ...base,
    bpm: bpm === null ? round2(tempo.bpm) : round2(bpm),
    tempoConfidence: round2(tempo.confidence),
    tempoCandidates: tempo.candidates,
    beats,
    beatStrengths: tracked.strengths,
    downbeatPhase: downbeat.phase,
    downbeatConfidence: downbeat.confidence,
    tempoStability,
    warnings
  }
}

/** How much stronger the onsets are on the tracked beats than on average (≈1 for noise). */
export function beatSalience(onset: Float64Array, frames: number[]): number {
  let total = 0
  for (const v of onset) total += v
  const mean = total / (onset.length || 1)
  if (mean <= 0 || frames.length === 0) return 0
  let atBeats = 0
  for (const f of frames) {
    const i = Math.round(f)
    atBeats += Math.max(onset[i - 1] ?? 0, onset[i] ?? 0, onset[i + 1] ?? 0)
  }
  return atBeats / frames.length / mean
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 10000) / 10000
function max(x: Float64Array): number {
  let m = -Infinity
  for (const v of x) if (v > m) m = v
  return m
}
