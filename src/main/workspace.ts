import { resolveBeatMap, type BeatCorrections, type BeatMap, type Waveform } from '../shared/analysis'
import type { CreateHookInput, Hook, UpdateHookInput } from '../shared/hooks'
import type { LyricsState, SaveLyricsInput } from '../shared/lyrics'
import type { Project } from '../shared/schemas'
import type { AnalysisState, SongWorkspace, TranscribeInput } from '../shared/workspace'
import type { AnalysisService } from './analysis/service'
import { UnprocessableError } from './errors'
import type { Logger } from './logger'
import type { MediaRepository } from './repositories/media'
import type { ProjectsRepository } from './repositories/projects'
import type { WorkspaceRepository } from './repositories/workspace'
import type { TranscriptionService } from './transcription/service'

/**
 * The song workspace (Phase 2): analysis, beat corrections, lyrics and hooks
 * for one song, assembled for the UI. Handlers stay thin; this is testable
 * without Electron.
 */
export class SongWorkspaceService {
  constructor(
    private readonly o: {
      projects: ProjectsRepository
      media: MediaRepository
      repo: WorkspaceRepository
      analysis: AnalysisService
      transcription: TranscriptionService
      logger: Logger
    }
  ) {}

  get(songId: string): SongWorkspace {
    const project = this.o.projects.get(songId)
    const audio = project.audioAssetId ? this.o.media.find(project.audioAssetId) : null
    let analysis: AnalysisState | null = null
    if (audio) {
      analysis = this.o.analysis.state(audio.id)
      // Opening a song analyses its audio automatically if needed.
      if (audio.status === 'ready' && audio.availability === 'online') {
        try {
          analysis = this.o.analysis.ensure(audio.id)
        } catch (error) {
          this.o.logger.warn('Could not start analysis', { songId, error })
        }
      }
    }
    const corrections = this.o.repo.corrections(songId)
    return {
      project,
      audio,
      analysis,
      corrections,
      beatMap: this.beatMap(analysis, corrections, audio?.durationSeconds ?? null),
      lyrics: this.o.transcription.lyrics(songId),
      hooks: this.o.repo.hooks(songId)
    }
  }

  private beatMap(analysis: AnalysisState | null, corrections: BeatCorrections, duration: number | null): BeatMap | null {
    if (analysis?.analysis) return resolveBeatMap(analysis.analysis, corrections)
    // A manual grid works even without (or before) automatic analysis.
    if (corrections.mode === 'grid' && duration) {
      return resolveBeatMap({ beats: [], bpm: null, downbeatPhase: 0, durationSeconds: duration }, corrections)
    }
    return null
  }

  /** Called after the song's audio changed. */
  audioChanged(previous: Project, next: Project): void {
    if (previous.audioAssetId === next.audioAssetId) return
    this.o.repo.audioChanged(next.id)
    if (next.audioAssetId) {
      try {
        this.o.analysis.ensure(next.audioAssetId)
      } catch (error) {
        this.o.logger.warn('Could not start analysis', { songId: next.id, error })
      }
    }
  }

  reanalyze(songId: string): AnalysisState | null {
    const project = this.o.projects.get(songId)
    if (!project.audioAssetId) throw new UnprocessableError('Choose the song’s audio first.')
    return this.o.analysis.ensure(project.audioAssetId, { force: true })
  }

  setCorrections(songId: string, corrections: BeatCorrections): { corrections: BeatCorrections; beatMap: BeatMap | null } {
    if (corrections.mode === 'grid' && (!corrections.gridBpm || corrections.gridAnchor === null)) {
      throw new UnprocessableError('A manual grid needs a tempo and the time of one downbeat.')
    }
    const saved = this.o.repo.setCorrections(songId, corrections)
    const project = this.o.projects.get(songId)
    const audio = project.audioAssetId ? this.o.media.find(project.audioAssetId) : null
    const analysis = audio ? this.o.analysis.state(audio.id) : null
    return { corrections: saved, beatMap: this.beatMap(analysis, saved, audio?.durationSeconds ?? null) }
  }

  waveform(assetId: string): Promise<Waveform | null> {
    return this.o.analysis.waveform(assetId)
  }

  saveLyrics(input: SaveLyricsInput): LyricsState {
    this.o.repo.saveLyrics(input)
    return this.o.transcription.lyrics(input.songId)
  }

  transcribe(input: TranscribeInput): Promise<LyricsState> {
    return this.o.transcription.transcribe(input)
  }

  cancelTranscription(songId: string): LyricsState {
    this.o.transcription.cancel(songId)
    return this.o.transcription.lyrics(songId)
  }

  createHook(input: CreateHookInput): Hook {
    return this.o.repo.createHook(input)
  }

  updateHook(input: UpdateHookInput): Hook {
    return this.o.repo.updateHook(input)
  }

  deleteHook(id: string): void {
    this.o.repo.deleteHook(id)
  }
}
