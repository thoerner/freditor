import { useMemo, useState } from 'react'
import type { ExportPlanEntry, Project, SequenceItem } from '../../../shared/types'
import { useStore } from '../store'
import { gapAfter, getSpeaker, lineStatus } from '../lib/model'
import { Modal } from './Modal'
import { ipcErrorMessage } from '../lib/errors'

type Scope = 'episode' | string // section id

interface ExportableItem {
  item: SequenceItem
  sectionIndex: number
  itemIndex: number
  entry: ExportPlanEntry | null
  /** true if a line that is stale (audio exists but text changed since) */
  stale: boolean
}

function collect(project: Project, scope: Scope): ExportableItem[] {
  const out: ExportableItem[] = []
  project.sections.forEach((section, sectionIndex) => {
    if (scope !== 'episode' && section.id !== scope) return
    section.items.forEach((item, itemIndex) => {
      let entry: ExportPlanEntry | null = null
      let stale = false
      if (item.type === 'clip') {
        entry = { kind: 'abs', file: item.path, gapAfterMs: gapAfter(project, item) }
      } else if (item.generation) {
        entry = {
          kind: 'cache',
          file: item.generation.audioFile,
          gapAfterMs: gapAfter(project, item)
        }
        stale = lineStatus(project, item) === 'stale'
      }
      out.push({ item, sectionIndex, itemIndex, entry, stale })
    })
  })
  return out
}

function slug(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export'
}

export function ExportDialog(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const setModal = useStore((s) => s.setModal)
  const showToast = useStore((s) => s.showToast)

  const [scope, setScope] = useState<Scope>('episode')
  const [format, setFormat] = useState<'wav' | 'mp3'>('mp3')
  const [split, setSplit] = useState<'single' | 'separate'>('single')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const items = useMemo(() => collect(project, scope), [project, scope])
  const ready = items.filter((i) => i.entry)
  const missing = items.length - ready.length
  const staleCount = items.filter((i) => i.stale).length

  const doExport = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      if (split === 'single') {
        const entries = ready.map((i) => i.entry!)
        const name =
          scope === 'episode'
            ? slug(project.name)
            : slug(project.sections.find((s) => s.id === scope)?.name ?? 'section')
        const res = await window.api.export.stitch({ entries, format, suggestedName: name })
        if (res) {
          setResult(res.path)
          showToast(`Exported ${res.path}`)
        }
      } else {
        const files = ready.map((i) => {
          const num = `${String(i.sectionIndex + 1).padStart(2, '0')}-${String(i.itemIndex + 1).padStart(2, '0')}`
          const label =
            i.item.type === 'clip'
              ? i.item.name.replace(/\.[^.]+$/, '')
              : (getSpeaker(project, i.item.speakerId)?.name ?? 'line')
          return { kind: i.entry!.kind, file: i.entry!.file, name: `${num} ${label}` }
        })
        const res = await window.api.export.separate({ files, format })
        if (res) {
          setResult(res.dir)
          showToast(`Exported ${res.files.length} files to ${res.dir}`)
        }
      }
    } catch (err) {
      showToast(`Export failed: ${ipcErrorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Export audio"
      onClose={() => setModal(null)}
      footer={
        <>
          {result && (
            <button onClick={() => void window.api.shell.showItemInFolder(result)}>
              Show in folder
            </button>
          )}
          <button onClick={() => setModal(null)}>Close</button>
          <button
            className="primary"
            disabled={busy || ready.length === 0}
            onClick={() => void doExport()}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>Scope</label>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="episode">Whole episode</option>
          {project.sections.map((s) => (
            <option key={s.id} value={s.id}>
              Section: {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>Output</label>
        <select value={split} onChange={(e) => setSplit(e.target.value as 'single' | 'separate')}>
          <option value="single">Single stitched file (with gaps)</option>
          <option value="separate">Separate file per line/clip (stems)</option>
        </select>
      </div>
      <div className="form-row">
        <label>Format</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as 'wav' | 'mp3')}>
          <option value="mp3">MP3 (192 kbps)</option>
          <option value="wav">WAV (44.1 kHz 16-bit)</option>
        </select>
      </div>

      <p className="hint">
        {ready.length} item(s) will be exported
        {split === 'single'
          ? ', stitched in order with the configured gaps.'
          : ' as individual files named by section/position/speaker.'}
      </p>
      {missing > 0 && (
        <p className="warn-text">
          {missing} line(s) have no generated audio yet and will be skipped. Generate them first for
          a complete export.
        </p>
      )}
      {staleCount > 0 && (
        <p className="warn-text">
          {staleCount} line(s) are stale (edited since generation) — their old audio will be used.
        </p>
      )}
      {result && <p className="ok-text">Done: {result}</p>}
    </Modal>
  )
}
