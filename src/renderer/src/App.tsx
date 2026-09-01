import { useEffect } from 'react'
import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { SectionEditor } from './components/SectionEditor'
import { SettingsModal } from './components/SettingsModal'
import { ImportWizard } from './components/ImportWizard'
import { ExportDialog } from './components/ExportDialog'

function App(): React.JSX.Element {
  const init = useStore((s) => s.init)
  const modal = useStore((s) => s.modal)
  const toast = useStore((s) => s.toast)
  const saveProject = useStore((s) => s.saveProject)

  useEffect(() => {
    void init()
  }, [init])

  // Ctrl/Cmd+S saves
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveProject(e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveProject])

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <div className="main-pane">
          <SectionEditor />
        </div>
      </div>
      {modal === 'settings' && <SettingsModal />}
      {modal === 'import' && <ImportWizard />}
      {modal === 'export' && <ExportDialog />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default App
