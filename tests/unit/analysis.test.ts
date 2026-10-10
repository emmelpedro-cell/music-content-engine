import { describe, expect, it } from 'vitest'
import {
  analyzeSamples,
  energyCurve,
  estimateTempo,
  onsetFeatures,
  waveformPeaks
} from '../../src/main/analysis/analyze'
import { MagnitudeFft } from '../../src/main/analysis/fft'
import { beatRecall, synthTrack, synthTrap } from '../helpers/synth'

const SR = 22050

describe('FFT', () => {
  it('finds the frequency of a sine wave', () => {
    const fft = new MagnitudeFft(1024)
    const freq = (40 * SR) / 1024 // exactly bin 40
    const x = Float32Array.from({ length: 1024 }, (_, i) => Math.sin((2 * Math.PI * freq * i) / SR))
    const out = new Float64Array(513)
    fft.magnitudes(x, 0, out)
    const peak = out.indexOf(Math.max(...out))
    expect(peak).toBe(40)
  })

  it('rejects sizes that are not powers of two', () => {
    expect(() => new MagnitudeFft(1000)).toThrow()
  })
})

describe('beat analysis on music with known tempo', () => {
  const cases = [
    { bpm: 120, offset: 0.37 },
    { bpm: 128, offset: 1.1 },
    { bpm: 90, offset: 0.2 },
    { bpm: 140, offset: 0.5 },
    { bpm: 174, offset: 0.3 },
    { bpm: 75, offset: 0.9 }
  ]
  for (const c of cases) {
    it(`${c.bpm} BPM, first beat at ${c.offset}s`, () => {
      const track = synthTrack({ ...c, seconds: 30 })
      const a = analyzeSamples(track)
      expect(a.bpm).not.toBeNull()
      expect(Math.abs(a.bpm! - c.bpm)).toBeLessThan(1)
      expect(beatRecall(track.beats, a.beats)).toBeGreaterThanOrEqual(0.95)
      // The first detected beat is the real first beat (not time zero).
      expect(Math.abs(a.beats[0]! - c.offset)).toBeLessThan(0.05)
      const downbeats = a.beats.filter((_, i) => i % 4 === a.downbeatPhase)
      expect(beatRecall(track.downbeats, downbeats, 0.035, 3)).toBeGreaterThanOrEqual(0.9)
      expect(a.warnings).toEqual([])
    })
  }

  it('handles 3/4 time when told the bar length', () => {
    const track = synthTrack({ bpm: 100, seconds: 30, offset: 0.6, beatsPerBar: 3 })
    const a = analyzeSamples(track, { beatsPerBar: 3 })
    const downbeats = a.beats.filter((_, i) => i % 3 === a.downbeatPhase)
    expect(beatRecall(track.downbeats, downbeats, 0.035, 3)).toBeGreaterThanOrEqual(0.9)
  })

  it('follows human timing and gradual tempo changes', () => {
    const live = synthTrack({ bpm: 110, seconds: 40, offset: 0.4, jitter: 0.012 })
    const a = analyzeSamples(live)
    expect(beatRecall(live.beats, a.beats, 0.04)).toBeGreaterThanOrEqual(0.9)
    expect(a.tempoStability).toBeLessThan(0.95)

    const ramp = synthTrack({ bpm: 96, endBpm: 104, seconds: 40, offset: 0.4 })
    const b = analyzeSamples(ramp)
    expect(b.bpm).toBeGreaterThan(95)
    expect(b.bpm).toBeLessThan(105)
    expect(beatRecall(ramp.beats, b.beats)).toBeGreaterThanOrEqual(0.9)
  })

  it('reads trap with triplet hi-hats at its real tempo, on a steady grid', () => {
    // A real 150 BPM Nepali trap song was first read as 100 BPM with wandering beats.
    const trap = synthTrap({ bpm: 150, seconds: 40, offset: 0.3 })
    const a = analyzeSamples(trap)
    const bpm = a.bpm!
    // 150, or its half-time reading 75 (one click away with "Double time"); never 100.
    expect(Math.min(Math.abs(bpm - 150), Math.abs(bpm * 2 - 150))).toBeLessThan(0.5)
    if (Math.abs(bpm - 150) < 0.5) expect(beatRecall(trap.beats, a.beats, 0.02)).toBeGreaterThanOrEqual(0.95)
    expect(a.tempoStability).toBeGreaterThanOrEqual(0.95)
  })

  it('offers half and double time as alternatives', () => {
    const a = analyzeSamples(synthTrack({ bpm: 128, seconds: 30 }))
    const alternatives = a.tempoCandidates.map((c) => c.bpm)
    expect(alternatives.some((b) => Math.abs(b - 64) < 1)).toBe(true)
    expect(alternatives.some((b) => Math.abs(b - 256) < 2)).toBe(true)
  })

  it('reports no beat for silence, noise and pads instead of inventing one', () => {
    const silence = analyzeSamples({ samples: new Float32Array(SR * 20), sampleRate: SR })
    expect(silence.bpm).toBeNull()
    expect(silence.beats).toEqual([])
    expect(silence.warnings[0]).toContain('No clear beat')

    let seed = 7
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
    const pad = Float32Array.from({ length: SR * 20 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.01 * rand())
    expect(analyzeSamples({ samples: pad, sampleRate: SR }).beats).toEqual([])
    const noise = Float32Array.from({ length: SR * 20 }, () => 0.3 * rand())
    expect(analyzeSamples({ samples: noise, sampleRate: SR }).beats).toEqual([])
  })

  it('needs at least a few seconds of audio', () => {
    const a = analyzeSamples({ samples: new Float32Array(SR * 2), sampleRate: SR })
    expect(a.bpm).toBeNull()
    expect(a.warnings[0]).toContain('too short')
  })

  it('estimates tempo from the onset envelope alone', () => {
    const f = onsetFeatures(synthTrack({ bpm: 120, seconds: 20 }))
    const t = estimateTempo(f.onset, f.fps)
    expect(t).not.toBeNull()
    expect(Math.abs(t!.bpm - 120)).toBeLessThan(1.5)
  })
})

describe('energy and waveform', () => {
  it('follows loudness', () => {
    const quiet = Float32Array.from({ length: SR * 2 }, (_, i) => 0.01 * Math.sin(i / 3))
    const loud = Float32Array.from({ length: SR * 2 }, (_, i) => 0.8 * Math.sin(i / 3))
    const samples = new Float32Array(SR * 4)
    samples.set(quiet, 0)
    samples.set(loud, SR * 2)
    const e = energyCurve({ samples, sampleRate: SR })
    expect(e).toHaveLength(40)
    expect(e[5]!).toBeLessThan(0.5)
    expect(e[35]!).toBeGreaterThan(0.9)
  })

  it('produces min/max peaks at 100 per second', () => {
    const samples = Float32Array.from({ length: SR * 3 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / SR) * (i < SR ? 0.5 : 1))
    const w = waveformPeaks({ samples, sampleRate: SR })
    expect(w.rate).toBe(100)
    expect(w.peaks.length).toBe(600)
    const view = new Int8Array(w.peaks.buffer)
    expect(view[1]).toBeGreaterThan(60)
    expect(view[1]).toBeLessThan(66)
    expect(view[0]).toBeLessThan(-60)
    expect(view[401]).toBe(127)
    expect(w.durationSeconds).toBe(3)
  })
})
