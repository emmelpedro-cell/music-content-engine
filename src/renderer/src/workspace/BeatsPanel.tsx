import { useRef, useState } from 'react'
import { DEFAULT_CORRECTIONS, type BeatCorrections, type BeatMap } from '../../../shared/analysis'
import type { AnalysisState } from '../../../shared/workspace'
import { formatClock } from './Timeline'

type Props = {
  analysis: AnalysisState | null
  beatMap: BeatMap | null
  corrections: BeatCorrections
  time: number
  hasAudio: boolean
  clickTrack: boolean
  onClickTrack: (on: boolean) => void
  onChange: (c: BeatCorrections) => void
  onReanalyze: () => void
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function BeatsPanel({ analysis, beatMap, corrections: c, time, hasAudio, clickTrack, onClickTrack, onChange, onReanalyze }: Props) {
  const a = analysis?.analysis ?? null
  const taps = useRef<number[]>([])
  const [tapBpm, setTapBpm] = useState<number | null>(null)
  const [gridBpm, setGridBpm] = useState(String(c.gridBpm ?? beatMap?.bpm ?? a?.bpm ?? 120))

  const set = (patch: Partial<BeatCorrections>) => onChange({ ...c, ...patch })

  const nearestBeat = (tolerance = Infinity) => {
    if (!beatMap?.beats.length) return null
    let best = -1
    let dist = Infinity
    beatMap.beats.forEach((b, i) => {
      const d = Math.abs(b - time)
      if (d < dist) {
        dist = d
        best = i
      }
    })
    return dist <= tolerance ? { index: best, time: beatMap.beats[best]! } : null
  }

  const setDownbeatHere = () => {
    if (c.mode === 'grid') return set({ gridAnchor: round3(time) })
    const n = nearestBeat()
    if (n) set({ downbeatPhase: n.index % c.beatsPerBar })
  }
  const addBeat = () => set({ added: [...c.added, round3(time)], removed: c.removed.filter((r) => Math.abs(r - time) > 0.04) })
  const removeBeat = () => {
    const n = nearestBeat(0.2)
    if (!n) return
    const wasAdded = c.added.some((x) => Math.abs(x - n.time) <= 0.04)
    set(wasAdded ? { added: c.added.filter((x) => Math.abs(x - n.time) > 0.04) } : { removed: [...c.removed, n.time - c.shiftSeconds] })
  }
  const tap = () => {
    const now = performance.now()
    taps.current = [...taps.current.filter((t) => now - t < 3000), now].slice(-8)
    if (taps.current.length >= 4) {
      const iv = taps.current.slice(1).map((t, i) => t - taps.current[i]!)
      const mean = iv.reduce((x, y) => x + y, 0) / iv.length
      const bpm = Math.round((60000 / mean) * 10) / 10
      setTapBpm(bpm)
      setGridBpm(String(bpm))
    }
  }

  if (!hasAudio) return <p className="muted pad-y">Choose the song’s audio in the Details tab to analyse its beats.</p>

  return (
    <div className="beats-panel" data-testid="beats-panel">
      <section className="stat-row">
        <div className="stat">
          <span className="stat-value" data-testid="bpm">
            {beatMap?.bpm ? beatMap.bpm.toFixed(1) : '–'}
          </span>
          <span className="stat-label">BPM{beatMap?.corrected ? ' (corrected)' : ''}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{beatMap ? beatMap.downbeats.length : '–'}</span>
          <span className="stat-label">bars</span>
        </div>
        {a && a.bpm !== null && (
          <>
            <div className="stat">
              <span className="stat-value">{pct(a.tempoConfidence)}</span>
              <span className="stat-label">tempo confidence</span>
            </div>
            <div className="stat">
              <span className="stat-value">{pct(a.tempoStability)}</span>
              <span className="stat-label">steadiness</span>
            </div>
          </>
        )}
        <div className="stat-actions">
          <label className="check">
            <input type="checkbox" checked={clickTrack} onChange={(e) => onClickTrack(e.target.checked)} data-testid="click-track" />
            Click on beats while playing
          </label>
        </div>
      </section>

      {analysis?.status === 'pending' || analysis?.status === 'processing' ? (
        <p className="analysis-status" data-testid="analysis-status">
          <span className="spinner" aria-hidden="true" /> Analysing the audio…
        </p>
      ) : null}
      {analysis?.status === 'error' && (
        <p className="form-error" role="alert">
          {analysis.error}
        </p>
      )}
      {a?.warnings.map((w) => (
        <p key={w} className="hint">
          {w}
        </p>
      ))}
      {a && a.bpm !== null && (
        <p className="muted small">
          Detected {a.bpm.toFixed(1)} BPM. Other readings:{' '}
          {a.tempoCandidates
            .slice(1)
            .filter((x) => x.score > 0.3)
            .map((x) => `${x.bpm.toFixed(0)}`)
            .join(', ') || 'none'}
          . Everything here is an estimate: listen with the click and correct what’s off.
        </p>
      )}

      <div className="control-grid">
        <div className="control">
          <span className="control-label">Mode</span>
          <div className="segmented" role="group" aria-label="Beat mode">
            <button type="button" className={c.mode === 'detected' ? 'is-active' : ''} onClick={() => set({ mode: 'detected' })}>
              Detected beats
            </button>
            <button
              type="button"
              className={c.mode === 'grid' ? 'is-active' : ''}
              onClick={() => set({ mode: 'grid', gridBpm: Number(gridBpm) || beatMap?.bpm || 120, gridAnchor: c.gridAnchor ?? beatMap?.downbeats[0] ?? 0 })}
              data-testid="mode-grid"
            >
              Manual grid
            </button>
          </div>
        </div>

        {c.mode === 'detected' ? (
          <>
            <div className="control">
              <span className="control-label">Tempo</span>
              <div className="segmented" role="group" aria-label="Tempo">
                {([0.5, 1, 2] as const).map((f) => (
                  <button key={f} type="button" className={c.tempoFactor === f ? 'is-active' : ''} onClick={() => set({ tempoFactor: f, downbeatPhase: null })}>
                    {f === 0.5 ? 'Half time' : f === 1 ? 'As detected' : 'Double time'}
                  </button>
                ))}
              </div>
            </div>
            <div className="control">
              <span className="control-label">Shift all beats</span>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ shiftSeconds: round3(c.shiftSeconds - 0.01) })}>
                  −10 ms
                </button>
                <span className="mono">{Math.round(c.shiftSeconds * 1000)} ms</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ shiftSeconds: round3(c.shiftSeconds + 0.01) })}>
                  +10 ms
                </button>
              </div>
            </div>
            <div className="control">
              <span className="control-label">Markers at the playhead ({formatClock(time, true)})</span>
              <div className="row wrap">
                <button type="button" className="btn btn-ghost btn-sm" onClick={addBeat}>
                  Add beat
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={removeBeat} disabled={!nearestBeat(0.2)}>
                  Remove nearest beat
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="control">
            <span className="control-label">Grid tempo</span>
            <div className="row wrap">
              <input
                className="num-input"
                inputMode="decimal"
                value={gridBpm}
                onChange={(e) => setGridBpm(e.target.value)}
                onBlur={() => {
                  const bpm = Number(gridBpm)
                  if (bpm >= 30 && bpm <= 300) set({ gridBpm: bpm })
                }}
                aria-label="Grid BPM"
                data-testid="grid-bpm"
              />
              <span className="muted">BPM</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={tap}>
                Tap tempo{tapBpm ? ` (${tapBpm})` : ''}
              </button>
            </div>
          </div>
        )}

        <div className="control">
          <span className="control-label">Bars</span>
          <div className="row wrap">
            <select value={c.beatsPerBar} onChange={(e) => set({ beatsPerBar: Number(e.target.value), downbeatPhase: null })} aria-label="Beats per bar">
              {[2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} beats per bar
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={setDownbeatHere} data-testid="set-downbeat">
              Bar starts at playhead
            </button>
          </div>
        </div>
      </div>

      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...DEFAULT_CORRECTIONS })} disabled={!beatMap?.corrected}>
          Reset corrections
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReanalyze} disabled={analysis?.status === 'processing'}>
          Analyse again
        </button>
      </div>
    </div>
  )
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
