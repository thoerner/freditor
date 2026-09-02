import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { allLines, estimateChars, formatChars, pendingLines } from '../lib/model'
import { api, isWeb } from '../backend'

export function TopBar(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const projectPath = useStore((s) => s.projectPath)
  const dirty = useStore((s) => s.dirty)
  const subscription = useStore((s) => s.subscription)
  const subscriptionError = useStore((s) => s.subscriptionError)
  const settingsView = useStore((s) => s.settingsView)
  const queue = useStore((s) => s.queue)
  const playingItemId = useStore((s) => s.playingItemId)

  const setProjectName = useStore((s) => s.setProjectName)
  const newProjectAction = useStore((s) => s.newProjectAction)
  const openProject = useStore((s) => s.openProject)
  const openRecent = useStore((s) => s.openRecent)
  const saveProject = useStore((s) => s.saveProject)
  const setModal = useStore((s) => s.setModal)
  const generateLines = useStore((s) => s.generateLines)
  const cancelGeneration = useStore((s) => s.cancelGeneration)
  const playFrom = useStore((s) => s.playFrom)
  const stopPlayback = useStore((s) => s.stopPlayback)
  const showToast = useStore((s) => s.showToast)

  const [recentOpen, setRecentOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const recentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (recentRef.current && !recentRef.current.contains(e.target as Node)) setRecentOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  const pending = pendingLines(project, allLines(project))
  const pendingChars = estimateChars(pending)
  const remaining = subscription ? subscription.characterLimit - subscription.characterCount : null
  const usedPct = subscription
    ? Math.min(100, (subscription.characterCount / Math.max(1, subscription.characterLimit)) * 100)
    : 0
  const overBudget = remaining != null && pendingChars > remaining

  const onGenerateAll = (): void => {
    if (pending.length === 0) {
      showToast('Everything is up to date — nothing to generate.')
      return
    }
    if (overBudget) {
      const ok = window.confirm(
        `This batch needs ~${formatChars(pendingChars)} characters but only ${formatChars(remaining!)} remain on your plan. Generation will likely fail partway. Continue anyway?`
      )
      if (!ok) return
    }
    void generateLines(pending.map((l) => l.id))
  }

  return (
    <div className="topbar">
      <span className="brand">freditor</span>
      <input
        className="project-name"
        value={project.name}
        onChange={(e) => setProjectName(e.target.value)}
        title={projectPath ?? 'Not saved yet'}
      />
      {dirty && (
        <span className="dirty-dot" title="Unsaved changes">
          ●
        </span>
      )}

      <button onClick={() => void newProjectAction()}>New</button>
      <div ref={recentRef} style={{ position: 'relative', display: 'flex', gap: 4 }}>
        <button onClick={() => void openProject()}>Open</button>
        {!isWeb && (
          <button
            className="ghost"
            title="Recent projects"
            onClick={() => {
              setRecentOpen(!recentOpen)
              void api.project.getRecent().then(setRecent)
            }}
          >
            ▾
          </button>
        )}
        {recentOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 40,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 6,
              minWidth: 320
            }}
            className="recent-list"
          >
            {recent.length === 0 && <span className="hint">No recent projects</span>}
            {recent.map((p) => (
              <button
                key={p}
                className="ghost"
                onClick={() => {
                  setRecentOpen(false)
                  void openRecent(p)
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => void saveProject(false)}>Save</button>
      <button className="ghost" onClick={() => void saveProject(true)} title="Save As…">
        Save As
      </button>
      <button onClick={() => setModal('import')}>Import script</button>
      <button onClick={() => setModal('export')}>Export</button>

      <div className="spacer" />

      {queue.running ? (
        <div className="gen-progress">
          <span>
            Generating {queue.done + 1}/{queue.total}…
          </span>
          <div className="bar">
            <div style={{ width: `${(queue.done / Math.max(1, queue.total)) * 100}%` }} />
          </div>
          <button onClick={cancelGeneration}>Cancel</button>
        </div>
      ) : (
        <button
          className="primary"
          onClick={onGenerateAll}
          disabled={pending.length === 0}
          title={
            pending.length > 0
              ? `${pending.length} line(s) need generation (~${formatChars(pendingChars)} characters)`
              : 'All lines are up to date'
          }
        >
          Generate all ({pending.length}
          {pending.length > 0 ? ` · ~${formatChars(pendingChars)} ch` : ''})
        </button>
      )}

      {playingItemId ? (
        <button onClick={stopPlayback}>◼ Stop</button>
      ) : (
        <button onClick={() => void playFrom(null)} title="Play the whole episode">
          ▶ Play all
        </button>
      )}

      {subscription && (
        <div
          className="quota"
          title={`Plan: ${subscription.tier} — resets ${
            subscription.nextResetUnix
              ? new Date(subscription.nextResetUnix * 1000).toLocaleDateString()
              : 'n/a'
          }`}
        >
          <span className="quota-label">
            <span>
              {formatChars(remaining ?? 0)} ch left
              {overBudget ? ' ⚠' : ''}
            </span>
            <span>
              {formatChars(subscription.characterCount)}/{formatChars(subscription.characterLimit)}
            </span>
          </span>
          <div className="bar">
            <div
              className={usedPct > 95 ? 'crit' : usedPct > 80 ? 'warn' : ''}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}
      {!subscription && settingsView?.hasApiKey && subscriptionError && (
        <span className="error-text" title={subscriptionError}>
          quota unavailable
        </span>
      )}
      {!settingsView?.hasApiKey && (
        <span className="warn-text">No API key — add one in Settings</span>
      )}

      <button className="ghost" onClick={() => setModal('settings')} title="Settings">
        ⚙
      </button>
    </div>
  )
}
