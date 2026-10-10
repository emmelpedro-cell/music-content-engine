import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BeatCorrections, Waveform } from '../../../shared/analysis'
import type { LyricDocument } from '../../../shared/lyrics'
import type { SongWorkspace, SpeechModelInfo, SpeechToolsStatus, WorkspaceEvent } from '../../../shared/workspace'
import { api, unwrap } from '../api'
import type { NoticeState } from '../components/Notice'
import { sourceUrl } from '../media/format'
import { BeatsPanel } from './BeatsPanel'
import { HooksPanel } from './HooksPanel'
import { LyricsPanel } from './LyricsPanel'
import { formatClock, Timeline, type Selection } from './Timeline'
import { usePlayer } from './usePlayer'

type Tab = 'beats' | 'lyrics' | 'hooks' | 'details'

type Props = {
  songId: string
  details: ReactNode
  /** Changes when the song's audio or details change, to reload the workspace. */
  revision: string
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

export function SongWorkspaceView({ songId, details, revision, onNotice, onError }: Props) {
  const [ws, setWs] = useState<SongWorkspace | null>(null)
  const [waveform, setWaveform] = useState<Waveform | null>(null)
  const [speech, setSpeech] = useState<SpeechToolsStatus | null>(null)
  const [models, setModels] = useState<SpeechModelInfo[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null)
  const [localLyrics, setLocalLyrics] = useState<{ doc: LyricDocument; offset: number } | null>(null)
  const [tab, setTab] = useState<Tab | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await unwrap(api.workspace.get(songId))
      setWs(next)
      setTab((t) => t ?? (next.audio ? 'beats' : 'details'))
    } catch (e) {
      onError(e)
    }
  }, [songId, onError])

  useEffect(() => {
    void load()
  }, [load, revision])

  useEffect(() => {
    unwrap(api.speech.status()).then(setSpeech, () => setSpeech(null))
    unwrap(api.speech.models()).then(setModels, () => setModels([]))
  }, [])

  // Live updates: analysis progress, transcription, model downloads.
  useEffect(
    () =>
      api.workspace.onEvent((e: WorkspaceEvent) => {
        if (e.type === 'models') setModels(e.models)
        if (e.type === 'lyrics' && e.state.songId === songId) setWs((w) => (w ? { ...w, lyrics: e.state } : w))
        if (e.type === 'analysis') {
          setWs((w) => {
            if (!w || w.audio?.id !== e.state.assetId) return w
            if (e.state.status === 'ready') void load()
            return { ...w, analysis: e.state }
          })
        }
      }),
    [songId, load]
  )

  // Waveform once the analysis is ready.
  const analysisStamp = ws?.analysis?.status === 'ready' ? ws.analysis.updatedAt : null
  useEffect(() => {
    if (!ws?.audio || !analysisStamp) return
    unwrap(api.workspace.waveform(ws.audio.id)).then(setWaveform, () => setWaveform(null))
  }, [ws?.audio?.id, analysisStamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const beatMap = ws?.beatMap ?? null
  const player = usePlayer(beatMap?.beats ?? [], beatMap?.downbeats ?? [])

  // Space toggles playback anywhere outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select, button, [contenteditable]')) return
      e.preventDefault()
      player.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  const setCorrections = async (corrections: BeatCorrections) => {
    try {
      const r = await unwrap(api.workspace.setCorrections(songId, corrections))
      setWs((w) => (w ? { ...w, corrections: r.corrections, beatMap: r.beatMap } : w))
    } catch (e) {
      onError(e)
    }
  }

  const position = useMemo(() => {
    if (!beatMap?.beats.length) return null
    let beatIndex = -1
    for (let i = 0; i < beatMap.beats.length && beatMap.beats[i]! <= player.time + 0.01; i++) beatIndex = i
    if (beatIndex < 0) return null
    const downs = new Set(beatMap.downbeats)
    let bar = 0
    let beatInBar = 0
    for (let i = 0; i <= beatIndex; i++) {
      if (downs.has(beatMap.beats[i]!)) {
        bar++
        beatInBar = 1
      } else beatInBar++
    }
    return bar > 0 ? `${bar}.${beatInBar}` : null
  }, [beatMap, player.time])

  if (!ws) return <p className="muted pad">Loading…</p>

  const duration = ws.analysis?.analysis?.durationSeconds ?? ws.audio?.durationSeconds ?? player.duration
  const lyricsDoc = localLyrics?.doc ?? ws.lyrics.document
  const lyricsOffset = localLyrics?.offset ?? ws.lyrics.offsetSeconds
  const audioUsable = ws.audio && ws.audio.status === 'ready' && ws.audio.availability === 'online'

  return (
    <div className="workspace" data-testid="song-workspace">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">Song</p>
          <h2 className="workspace-title" data-testid="project-title">
            {ws.project.title}
          </h2>
          <p className="muted small">
            {ws.audio ? ws.audio.fileName : 'No audio chosen yet'}
            {ws.project.artist ? ` · ${ws.project.artist}` : ''}
          </p>
        </div>
        {audioUsable && (
          <div className="transport" data-testid="transport">
            <button type="button" className="btn btn-primary play-btn" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'} data-testid="play">
              {player.playing ? '❚❚' : '▶'}
            </button>
            <div className="transport-readout">
              <span className="mono transport-time" data-testid="playhead-time">
                {formatClock(player.time, true)}
              </span>
              <span className="muted small mono">
                / {formatClock(duration)}
                {position ? ` · bar ${position}` : ''}
              </span>
            </div>
          </div>
        )}
      </header>

      {ws.audio && ws.audio.availability === 'missing' && (
        <div className="banner banner-warn">The song’s audio file can’t be found. Relink it in the Media Library to play and analyse it.</div>
      )}
      {audioUsable && <audio ref={player.audioRef} src={sourceUrl(ws.audio!)} preload="auto" />}

      {audioUsable && (
        <Timeline
          duration={duration}
          waveform={waveform}
          beatMap={beatMap}
          energy={ws.analysis?.analysis?.energy ?? null}
          energyRate={ws.analysis?.analysis?.energyRate ?? 10}
          hooks={ws.hooks}
          lyrics={lyricsDoc}
          lyricsOffset={lyricsOffset}
          selectedWordId={selectedWordId}
          time={player.time}
          playing={player.playing}
          selection={selection}
          onSeek={player.seek}
          onSelect={setSelection}
        />
      )}

      <nav className="tabs" role="tablist" aria-label="Song workspace">
        {(
          [
            ['beats', 'Beats'],
            ['lyrics', 'Lyrics'],
            ['hooks', `Hooks${ws.hooks.length ? ` (${ws.hooks.length})` : ''}`],
            ['details', 'Details']
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
            {label}
            {id === 'lyrics' && ws.lyrics.status === 'confirmed' && <span className="tab-dot" aria-label="checked" />}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'beats' && (
          <BeatsPanel
            analysis={ws.analysis}
            beatMap={beatMap}
            corrections={ws.corrections}
            time={player.time}
            hasAudio={Boolean(ws.audio)}
            clickTrack={player.clickTrack}
            onClickTrack={player.setClickTrack}
            onChange={setCorrections}
            onReanalyze={() => unwrap(api.workspace.reanalyze(songId)).then(() => load(), onError)}
          />
        )}
        {tab === 'lyrics' && (
          <LyricsPanel
            songId={songId}
            lyrics={ws.lyrics}
            speech={speech}
            models={models}
            time={player.time}
            playing={player.playing}
            selection={selection}
            selectedWordId={selectedWordId}
            onSelectWord={setSelectedWordId}
            onLocalChange={(doc, offset) => setLocalLyrics({ doc, offset })}
            onSeek={player.seek}
            onPlay={player.play}
            onSaved={(state) => setWs((w) => (w ? { ...w, lyrics: state } : w))}
            onRecheckSpeech={() => unwrap(api.speech.recheck()).then(setSpeech, onError)}
            onNotice={onNotice}
            onError={onError}
          />
        )}
        {tab === 'hooks' && (
          <HooksPanel
            songId={songId}
            hooks={ws.hooks}
            duration={duration}
            beatMap={beatMap}
            lyrics={lyricsDoc}
            lyricsOffset={lyricsOffset}
            time={player.time}
            selection={selection}
            onChanged={load}
            onSelectRange={(s) => {
              setSelection(s)
              player.seek(s.start)
            }}
            onPlay={player.play}
            onError={onError}
          />
        )}
        {tab === 'details' && details}
      </div>
    </div>
  )
}
