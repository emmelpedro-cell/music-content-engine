import { useEffect, useState } from 'react'
import type { AppInfo, Settings } from '../../../shared/schemas'
import { HEX_COLOR } from '../../../shared/schemas'
import { api, unwrap } from '../api'
import type { NoticeState } from '../components/Notice'

type Props = {
  settings: Settings
  info: AppInfo
  onSettingsChanged: (s: Settings) => void
  onInfoChanged: () => Promise<void>
  onNotice: (n: NoticeState) => void
  onError: (e: unknown) => void
}

const SWATCHES = ['#e8a33d', '#e2604a', '#4fb38a', '#4c9be8', '#a77be0', '#d9d9d9']

export function SettingsScreen({ settings, info, onSettingsChanged, onInfoChanged, onNotice, onError }: Props) {
  const [accent, setAccent] = useState(settings.accentColor)
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)

  useEffect(() => setAccent(settings.accentColor), [settings.accentColor])

  // Preview immediately, persist once the user stops picking (the color picker fires on every drag step).
  useEffect(() => {
    if (!HEX_COLOR.test(accent)) return
    document.documentElement.style.setProperty('--accent', accent)
    if (accent.toLowerCase() === settings.accentColor.toLowerCase()) return
    const timer = window.setTimeout(() => {
      unwrap(api.settings.update({ accentColor: accent }))
        .then(onSettingsChanged)
        .catch(onError)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [accent, settings.accentColor, onSettingsChanged, onError])

  async function changeDataFolder() {
    try {
      const result = await unwrap(api.settings.chooseDataDirectory())
      if (result.changed) {
        setPendingRoot(result.path)
        onNotice({ tone: 'info', text: 'Data folder saved. Restart the app to switch to it.' })
      }
    } catch (e) {
      onError(e)
    }
  }

  async function changeExportFolder() {
    try {
      const result = await unwrap(api.settings.chooseExportDirectory())
      if (result.changed) {
        onSettingsChanged(await unwrap(api.settings.get()))
        await onInfoChanged()
        onNotice({ tone: 'success', text: 'Export folder updated.' })
      }
    } catch (e) {
      onError(e)
    }
  }

  async function openLogs() {
    try {
      await unwrap(api.app.openLogsFolder())
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>Storage</h2>
        </div>
        <div className="setting">
          <div>
            <h3>Data folder</h3>
            <p className="muted small">
              Database, thumbnails, proxies, analysis and logs. Your original media stays where it is.
            </p>
            <code className="path">{info.rootDirectory}</code>
            {pendingRoot && (
              <p className="hint">
                After restarting, the app will use <code>{pendingRoot}</code>. Existing data is not moved: copy the
                current folder there first if you want to keep your projects.
              </p>
            )}
            {info.rootDirectoryOverridden && (
              <p className="hint">Set by the MCE_DATA_DIR environment variable, so it can't be changed here.</p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={changeDataFolder}
            disabled={info.rootDirectoryOverridden}
          >
            Change…
          </button>
        </div>
        <div className="setting">
          <div>
            <h3>Export folder</h3>
            <p className="muted small">Where finished videos will be written.</p>
            <code className="path">{info.exportDirectory}</code>
          </div>
          <button type="button" className="btn btn-ghost" onClick={changeExportFolder}>
            Change…
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Appearance</h2>
        </div>
        <div className="setting">
          <div>
            <h3>Accent color</h3>
            <p className="muted small">Used for highlights, the playhead and primary actions.</p>
            <div className="swatches" role="radiogroup" aria-label="Accent color">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={accent.toLowerCase() === c}
                  aria-label={c}
                  className={`swatch${accent.toLowerCase() === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setAccent(c)}
                />
              ))}
              <label className="swatch-custom">
                <input
                  type="color"
                  value={HEX_COLOR.test(accent) ? accent : settings.accentColor}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label="Custom accent color"
                />
                Custom
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Diagnostics</h2>
        </div>
        <dl className="facts">
          <div>
            <dt>Version</dt>
            <dd>{info.version}</dd>
          </div>
          <div>
            <dt>Database schema</dt>
            <dd>v{info.schemaVersion}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>
              <code className="path">{info.databasePath}</code>
            </dd>
          </div>
        </dl>
        <button type="button" className="btn btn-ghost" onClick={openLogs}>
          Open logs folder
        </button>
      </section>
    </div>
  )
}
