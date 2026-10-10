import type { MediaAsset } from '../../../shared/media'
import type { Project } from '../../../shared/schemas'
import { formatRelative } from '../format'

type Props = {
  projects: Project[] | null
  assets: MediaAsset[] | null
  onNewProject: () => void
  onOpenProject: (id: string) => void
  onOpenLibrary: () => void
}

/** Phases that have shipped. */
const DONE_PHASES = new Set([1])

const PIPELINE = [
  { label: 'Import music', phase: 1 },
  { label: 'Import footage', phase: 1 },
  { label: 'Analyze', phase: 2 },
  { label: 'Sync lyrics', phase: 2 },
  { label: 'Generate edit', phase: 3 },
  { label: 'Review', phase: 4 },
  { label: 'Render', phase: 3 },
  { label: 'Save & reuse', phase: 5 }
]

export function HomeScreen({ projects, assets, onNewProject, onOpenProject, onOpenLibrary }: Props) {
  const recent = projects?.slice(0, 6) ?? []
  const videos = assets?.filter((a) => a.kind === 'video').length ?? 0
  const audio = assets?.filter((a) => a.kind === 'audio').length ?? 0
  const missing = assets?.filter((a) => a.availability === 'missing').length ?? 0

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Studio</p>
          <h1>One song, many videos.</h1>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={onNewProject} data-testid="home-new-project">
          New song project
        </button>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Recent projects</h2>
          {projects && <span className="count">{projects.length}</span>}
        </div>
        {projects === null && <p className="muted">Loading…</p>}
        {projects && projects.length === 0 && (
          <div className="empty">
            <p>No projects yet.</p>
            <p className="muted">Start with the song you want to promote next.</p>
          </div>
        )}
        {recent.length > 0 && (
          <ul className="project-grid" data-testid="recent-projects">
            {recent.map((p) => (
              <li key={p.id}>
                <button type="button" className="project-card" onClick={() => onOpenProject(p.id)}>
                  <span className="project-card-wave" aria-hidden="true" />
                  <span className="project-card-title">{p.title}</span>
                  <span className="project-card-meta">
                    {p.artist ?? 'No artist'} · {formatRelative(p.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Media Library</h2>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{assets ? videos : '–'}</span>
            <span className="stat-label">video clips</span>
          </div>
          <div className="stat">
            <span className="stat-value">{assets ? audio : '–'}</span>
            <span className="stat-label">audio files</span>
          </div>
          {missing > 0 && (
            <div className="stat stat-warn">
              <span className="stat-value">{missing}</span>
              <span className="stat-label">missing</span>
            </div>
          )}
          <button type="button" className="btn btn-ghost stats-action" onClick={onOpenLibrary}>
            Open library
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Build progress</h2>
          <span className="muted small">The workflow this app is being built around</span>
        </div>
        <ol className="pipeline">
          {PIPELINE.map((step) => (
            <li key={step.label} className={`pipeline-step${DONE_PHASES.has(step.phase) ? ' is-done' : ''}`}>
              <span className="pipeline-label">{step.label}</span>
              {DONE_PHASES.has(step.phase) ? (
                <span className="tag tag-done">Ready</span>
              ) : (
                <span className="tag tag-pending">Phase {step.phase}</span>
              )}
            </li>
          ))}
        </ol>
        <p className="muted small">
          Analysis, editing, presets and exports arrive in the next phases. Nothing on this page is simulated.
        </p>
      </section>
    </div>
  )
}
