/**
 * Synthetic music with known ground truth, for testing beat analysis.
 * Kick on downbeats (low, strong), snare on backbeats, hi-hat on every beat
 * and off-beats, a sustained pad, and some noise.
 */
export type SynthOptions = {
  bpm: number
  seconds: number
  sampleRate?: number
  /** Time of the first beat (a downbeat). */
  offset?: number
  beatsPerBar?: number
  /** Random timing deviation per beat, seconds (simulates live playing). */
  jitter?: number
  /** Linear tempo change: bpm at the end. */
  endBpm?: number
  noise?: number
  seed?: number
}

export type SynthTrack = { samples: Float32Array; sampleRate: number; beats: number[]; downbeats: number[] }

export function synthTrack(o: SynthOptions): SynthTrack {
  const sr = o.sampleRate ?? 22050
  const n = Math.floor(o.seconds * sr)
  const samples = new Float32Array(n)
  const bpb = o.beatsPerBar ?? 4
  let seed = o.seed ?? 1
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

  const beats: number[] = []
  let t = o.offset ?? 0.5
  while (t < o.seconds - 0.2) {
    beats.push(t)
    const progress = t / o.seconds
    const bpm = o.endBpm ? o.bpm + (o.endBpm - o.bpm) * progress : o.bpm
    t += 60 / bpm
  }
  const played = beats.map((b) => b + (o.jitter ? (rand() * 2 - 1) * o.jitter : 0))

  const add = (start: number, fn: (dt: number) => number, length: number) => {
    const s0 = Math.floor(start * sr)
    const len = Math.floor(length * sr)
    for (let i = 0; i < len && s0 + i < n; i++) if (s0 + i >= 0) samples[s0 + i]! += fn(i / sr)
  }
  played.forEach((bt, i) => {
    const inBar = i % bpb
    if (inBar === 0) add(bt, (dt) => 0.9 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-dt * 30)) * dt) * Math.exp(-dt * 12), 0.35)
    if (bpb === 4 && inBar === 2) add(bt, (dt) => 0.45 * Math.sin(2 * Math.PI * 70 * dt) * Math.exp(-dt * 18), 0.2)
    if (inBar === 1 || inBar === 3) add(bt, (dt) => 0.35 * (rand() * 2 - 1) * Math.exp(-dt * 25), 0.15)
    add(bt, (dt) => 0.15 * (rand() * 2 - 1) * Math.exp(-dt * 80), 0.05)
    const next = played[i + 1]
    if (next) add((bt + next) / 2, (dt) => 0.08 * (rand() * 2 - 1) * Math.exp(-dt * 90), 0.04)
  })
  for (let i = 0; i < n; i++) {
    const time = i / sr
    samples[i]! += 0.05 * Math.sin(2 * Math.PI * 220 * time) + 0.04 * Math.sin(2 * Math.PI * 277.2 * time)
    samples[i]! += (o.noise ?? 0.01) * (rand() * 2 - 1)
  }
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < n; i++) samples[i]! /= peak * 1.1

  return { samples, sampleRate: sr, beats, downbeats: beats.filter((_, i) => i % bpb === 0) }
}

/** Share of true beats that have a detected beat within `tolerance` seconds. */
export function beatRecall(truth: number[], detected: number[], tolerance = 0.035, ignoreEdges = 1.5): number {
  const end = truth[truth.length - 1] ?? 0
  const considered = truth.filter((t) => t > (truth[0] ?? 0) + ignoreEdges && t < end - ignoreEdges)
  if (!considered.length) return 0
  const hits = considered.filter((t) => detected.some((d) => Math.abs(d - t) <= tolerance)).length
  return hits / considered.length
}
