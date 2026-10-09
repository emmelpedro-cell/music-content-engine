import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, CreateProjectInput, Project, Settings } from '../../shared/schemas'
import { api, errorMessage, unwrap } from './api'
import { NewProjectDialog } from './components/NewProjectDialog'
import { Sidebar, type ScreenId } from './components/Sidebar'
import { Notice, type NoticeState } from './components/Notice'
import { HomeScreen } from './screens/HomeScreen'
import { SongsScreen } from './screens/SongsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { PhasePlaceholder, PLACEHOLDERS } from './screens/PhasePlaceholder'

export function App() {
  const [screen, setScreen] = useState<ScreenId>('home')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const showError = useCallback((error: unknown) => setNotice({ tone: 'error', text: errorMessage(error) }), [])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const refreshProjects = useCallback(async () => {
    setProjects(await unwrap(api.projects.list()))
  }, [])

  const refreshInfo = useCallback(async () => {
    setInfo(await unwrap(api.app.getInfo()))
  }, [])

  useEffect(() => {
    Promise.all([unwrap(api.projects.list()), unwrap(api.settings.get()), unwrap(api.app.getInfo())])
      .then(([p, s, i]) => {
        setProjects(p)
        setSettings(s)
        setInfo(i)
      })
      .catch((error: unknown) => setLoadError(errorMessage(error)))
  }, [])

  useEffect(() => {
    if (settings) document.documentElement.style.setProperty('--accent', settings.accentColor)
  }, [settings])

  async function createProject(input: CreateProjectInput) {
    const project = await unwrap(api.projects.create(input))
    await refreshProjects()
    setCreating(false)
    setSelectedId(project.id)
    setScreen('songs')
    setNotice({ tone: 'success', text: `Created “${project.title}”.` })
  }

  function openProject(id: string) {
    setSelectedId(id)
    setScreen('songs')
  }

  if (loadError) {
    return (
      <div className="fatal">
        <h1>The app could not load its data</h1>
        <p>{loadError}</p>
        <p className="muted">Check the log file in the app-data/logs folder, then restart the app.</p>
      </div>
    )
  }

  return (
    <div className="shell">
      <Sidebar current={screen} onNavigate={setScreen} version={info?.version} />
      <main className="main" aria-live="polite">
        {screen === 'home' && (
          <HomeScreen projects={projects} onNewProject={() => setCreating(true)} onOpenProject={openProject} />
        )}
        {screen === 'songs' && (
          <SongsScreen
            projects={projects}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNewProject={() => setCreating(true)}
            onChanged={refreshProjects}
            onNotice={setNotice}
            onError={showError}
          />
        )}
        {(screen === 'media' || screen === 'create' || screen === 'presets' || screen === 'exports') && (
          <PhasePlaceholder {...PLACEHOLDERS[screen]} />
        )}
        {screen === 'settings' && settings && info && (
          <SettingsScreen
            settings={settings}
            info={info}
            onSettingsChanged={setSettings}
            onInfoChanged={refreshInfo}
            onNotice={setNotice}
            onError={showError}
          />
        )}
      </main>
      {creating && <NewProjectDialog onCancel={() => setCreating(false)} onCreate={createProject} />}
      {notice && <Notice notice={notice} onDismiss={dismissNotice} />}
    </div>
  )
}
