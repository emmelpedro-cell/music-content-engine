export type ScreenId = 'home' | 'songs' | 'media' | 'create' | 'presets' | 'exports' | 'settings'

const ITEMS: { id: ScreenId; label: string; phase?: number }[] = [
  { id: 'home', label: 'Home' },
  { id: 'songs', label: 'Songs' },
  { id: 'media', label: 'Media Library' },
  { id: 'create', label: 'Create', phase: 3 },
  { id: 'presets', label: 'Presets', phase: 5 },
  { id: 'exports', label: 'Exports', phase: 6 }
]

type Props = {
  current: ScreenId
  onNavigate: (id: ScreenId) => void
  version?: string
}

export function Sidebar({ current, onNavigate, version }: Props) {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">
          Music Content
          <br />
          Engine
        </span>
      </div>

      <ul className="nav">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`nav-item${current === item.id ? ' is-active' : ''}`}
              aria-current={current === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <span>{item.label}</span>
              {item.phase !== undefined && (
                <span className="nav-phase" title={`Arrives in phase ${item.phase}`}>
                  P{item.phase}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        <button
          type="button"
          className={`nav-item${current === 'settings' ? ' is-active' : ''}`}
          aria-current={current === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          Settings
        </button>
        <p className="build-tag">Phase 1 · media{version ? ` · v${version}` : ''}</p>
      </div>
    </nav>
  )
}
