import { describe, expect, it } from 'vitest'
import { BeatCorrectionsSchema, DEFAULT_CORRECTIONS, medianBpm, resolveBeatMap } from '../../src/shared/analysis'

const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5) // 120 BPM from 0.5 s
const analysis = { beats, bpm: 120, downbeatPhase: 1, durationSeconds: 10 }

describe('resolveBeatMap', () => {
  it('passes the analysis through unchanged by default', () => {
    const map = resolveBeatMap(analysis, DEFAULT_CORRECTIONS)
    expect(map.beats).toEqual(beats)
    expect(map.bpm).toBe(120)
    expect(map.downbeats).toEqual([1, 3, 5, 7])
    expect(map.corrected).toBe(false)
  })

  it('shifts every beat', () => {
    const map = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, shiftSeconds: 0.02 })
    expect(map.beats[0]).toBeCloseTo(0.52)
    expect(map.corrected).toBe(true)
  })

  it('switches to half and double time', () => {
    const half = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, tempoFactor: 0.5 })
    expect(half.bpm).toBe(60)
    expect(half.beats).toHaveLength(8)
    const double = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, tempoFactor: 2 })
    expect(double.bpm).toBe(240)
    expect(double.beats).toHaveLength(31)
    expect(double.beats[1]).toBeCloseTo(0.75)
  })

  it('lets the user choose which beat is "1" and the bar length', () => {
    const map = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, downbeatPhase: 0, beatsPerBar: 3 })
    expect(map.downbeats).toEqual([0.5, 2, 3.5, 5, 6.5, 8])
    expect(map.beatsPerBar).toBe(3)
  })

  it('removes and adds individual markers, matching within 40 ms', () => {
    const map = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, removed: [1.02, 3.0], added: [1.25] })
    expect(map.beats).not.toContain(1)
    expect(map.beats).not.toContain(3)
    expect(map.beats).toContain(1.25)
    expect(map.beats).toEqual([...map.beats].sort((a, b) => a - b))
  })

  it('builds a constant manual grid from tempo and one downbeat', () => {
    const map = resolveBeatMap(analysis, { ...DEFAULT_CORRECTIONS, mode: 'grid', gridBpm: 100, gridAnchor: 2.3 })
    expect(map.bpm).toBe(100)
    expect(map.beats[0]).toBeCloseTo(0.5)
    expect(map.beats[1]).toBeCloseTo(1.1)
    expect(map.downbeats).toContain(2.3)
    expect(map.beats[map.beats.length - 1]).toBeLessThanOrEqual(10)
  })

  it('works with no detected beats when a grid is set', () => {
    const map = resolveBeatMap({ beats: [], bpm: null, downbeatPhase: 0, durationSeconds: 4 }, { ...DEFAULT_CORRECTIONS, mode: 'grid', gridBpm: 120, gridAnchor: 0 })
    expect(map.beats).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
  })

  it('validates corrections', () => {
    expect(BeatCorrectionsSchema.safeParse(DEFAULT_CORRECTIONS).success).toBe(true)
    expect(BeatCorrectionsSchema.safeParse({ ...DEFAULT_CORRECTIONS, tempoFactor: 3 }).success).toBe(false)
    expect(BeatCorrectionsSchema.safeParse({ ...DEFAULT_CORRECTIONS, shiftSeconds: 10 }).success).toBe(false)
    expect(BeatCorrectionsSchema.safeParse({ ...DEFAULT_CORRECTIONS, extra: 1 }).success).toBe(false)
  })

  it('computes BPM from the median interval', () => {
    expect(medianBpm([0, 0.5, 1, 1.5, 2.1])).toBe(120)
    expect(medianBpm([0, 1])).toBeNull()
  })
})
