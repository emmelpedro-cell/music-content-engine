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

/** Writes mono 16-bit PCM WAV. */
export function wavBytes(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * Trap-style loop with known beats: kick on 1 and the "and" of 2, snare on 3 (half-time
 * feel), hi-hats in triplets with 32nd-note rolls. Hi-hat triplets make a 3:2 relative of
 * the tempo (150 → 100) look periodic too.
 */
export function synthTrap(o: { bpm: number; seconds: number; offset?: number; seed?: number }): SynthTrack {
  const sr = 22050
  const n = Math.floor(o.seconds * sr)
  const samples = new Float32Array(n)
  let seed = o.seed ?? 3
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const add = (start: number, fn: (dt: number) => number, length: number) => {
    const s0 = Math.floor(start * sr)
    for (let i = 0; i < Math.floor(length * sr) && s0 + i < n; i++) if (s0 + i >= 0) samples[s0 + i]! += fn(i / sr)
  }
  const beat = 60 / o.bpm
  const beats: number[] = []
  const downbeats: number[] = []
  const kick = (t: number) => add(t, (dt) => 0.9 * Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-dt * 25)) * dt) * Math.exp(-dt * 6), 0.6)
  const snare = (t: number) => add(t, (dt) => 0.5 * (rand() * 2 - 1) * Math.exp(-dt * 20) + 0.3 * Math.sin(2 * Math.PI * 190 * dt) * Math.exp(-dt * 25), 0.25)
  const hat = (t: number, a: number) => add(t, (dt) => a * (rand() * 2 - 1) * Math.exp(-dt * 120), 0.03)
  let bar = 0
  for (let t = o.offset ?? 0.5; t < o.seconds - 4 * beat; t += 4 * beat, bar++) {
    downbeats.push(t)
    for (let b = 0; b < 4; b++) beats.push(t + b * beat)
    kick(t)
    kick(t + 1.5 * beat)
    snare(t + 2 * beat)
    for (let b = 0; b < 4; b++) {
      // Triplet hats, with a 32nd-note roll on the last beat of every second bar.
      if (b === 3 && bar % 2 === 1) for (let r = 0; r < 8; r++) hat(t + b * beat + (r * beat) / 8, 0.12)
      else for (let r = 0; r < 3; r++) hat(t + b * beat + (r * beat) / 3, r === 0 ? 0.2 : 0.12)
    }
  }
  for (let i = 0; i < n; i++) samples[i]! += 0.04 * Math.sin((2 * Math.PI * 110 * i) / sr) + 0.005 * (rand() * 2 - 1)
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < n; i++) samples[i]! /= peak * 1.1
  return { samples, sampleRate: sr, beats, downbeats }
}
