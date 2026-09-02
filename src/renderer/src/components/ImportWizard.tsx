import { useMemo, useState } from 'react'
import { useStore, type ImportMappingRow } from '../store'
import { parseScript } from '../lib/parser'
import { bestAutoMatch, matchVoices } from '../lib/fuzzy'
import { formatChars } from '../lib/model'
import { Modal } from './Modal'
import { VoiceSelect } from './VoiceSelect'
import { ipcErrorMessage } from '../lib/errors'
import { api } from '../backend'

export function ImportWizard(): React.JSX.Element {
  const voices = useStore((s) => s.voices)
  const setModal = useStore((s) => s.setModal)
  const applyImport = useStore((s) => s.applyImport)
  const showToast = useStore((s) => s.showToast)
  const hasExistingContent = useStore(
    (s) => s.project.sections.some((sec) => sec.items.length > 0) || s.project.speakers.length > 0
  )

  const [step, setStep] = useState<1 | 2>(1)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportMappingRow[]>([])
  const [mode, setMode] = useState<'replace' | 'append'>('replace')

  const parsed = useMemo(() => parseScript(text), [text])
  const totalCues = parsed.sections.reduce((n, s) => n + s.cues.length, 0)
  const totalChars = parsed.sections.reduce(
    (n, s) => n + s.cues.reduce((m, c) => m + c.text.length, 0),
    0
  )

  const pickFile = async (): Promise<void> => {
    try {
      const res = await api.file.importScriptDialog()
      if (!res) return
      setText(res.text)
      setFileName(res.fileName)
    } catch (err) {
      showToast(`Import failed: ${ipcErrorMessage(err)}`)
    }
  }

  const goToMapping = (): void => {
    setRows(
      parsed.speakers.map((name) => ({
        parsedName: name,
        displayName: name,
        voiceId: bestAutoMatch(name, voices)?.voice_id ?? null,
        mergeInto: null
      }))
    )
    setStep(2)
  }

  const updateRow = (parsedName: string, patch: Partial<ImportMappingRow>): void => {
    setRows((rs) => rs.map((r) => (r.parsedName === parsedName ? { ...r, ...patch } : r)))
  }

  const matchBadge = (row: ImportMappingRow): React.JSX.Element => {
    if (!row.voiceId) return <span className="match-badge match-none">unmatched</span>
    const ranked = matchVoices(row.parsedName, voices)
    const hit = ranked.find((m) => m.voice.voice_id === row.voiceId)
    if (!hit) return <span className="match-badge match-none">manual</span>
    const pct = Math.round(hit.score * 100)
    if (hit.score >= 0.99) return <span className="match-badge match-good">exact match</span>
    if (hit.score >= 0.72) return <span className="match-badge match-good">≈ {pct}% match</span>
    return <span className="match-badge match-weak">{pct}% — check this</span>
  }

  return (
    <Modal
      title={step === 1 ? 'Import script' : 'Assign voices to speakers'}
      wide
      onClose={() => setModal(null)}
      footer={
        step === 1 ? (
          <>
            <button onClick={() => setModal(null)}>Cancel</button>
            <button className="primary" disabled={totalCues === 0} onClick={goToMapping}>
              Next: assign voices ({parsed.speakers.length} speakers)
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setStep(1)}>Back</button>
            <button
              className="primary"
              onClick={() => {
                applyImport(parsed, rows, mode)
                showToast(`Imported ${totalCues} lines in ${parsed.sections.length} section(s).`)
              }}
            >
              Import {totalCues} lines
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => void pickFile()}>Choose file… (.txt, .md, .docx)</button>
            {fileName && <span className="hint">{fileName}</span>}
            <span className="hint">or paste your script below</span>
          </div>
          <textarea
            className="import-paste"
            placeholder={
              'Voice 1: Hey Sam.\n\nVoice 2: Hey Joe.\n\n# Section headings and --- dividers split sections'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {text.trim() && (
            <p className="hint">
              Detected <b>{totalCues}</b> lines from <b>{parsed.speakers.length}</b> speaker(s) in{' '}
              <b>{parsed.sections.length}</b> section(s) — {formatChars(totalChars)} characters.
              {parsed.orphanText.length > 0 && (
                <span className="warn-text">
                  {' '}
                  {parsed.orphanText.length} line(s) before the first “Speaker:” label will be
                  skipped.
                </span>
              )}
            </p>
          )}
          {text.trim() && totalCues === 0 && (
            <p className="error-text">
              No speaker-labelled lines found. Lines must look like “Voice 1: Hey Sam.”
            </p>
          )}
        </>
      ) : (
        <>
          {voices.length === 0 && (
            <p className="warn-text">
              No voices loaded from ElevenLabs (missing API key?). You can import now and assign
              voices later in the sidebar.
            </p>
          )}
          <table className="map-table">
            <thead>
              <tr>
                <th>In script</th>
                <th>Speaker name (fix typos here)</th>
                <th>ElevenLabs voice</th>
                <th>Match</th>
                <th>Merge into</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const merged = row.mergeInto !== null
                return (
                  <tr key={row.parsedName} style={merged ? { opacity: 0.55 } : undefined}>
                    <td>{row.parsedName}</td>
                    <td>
                      <input
                        type="text"
                        value={row.displayName}
                        disabled={merged}
                        onChange={(e) => updateRow(row.parsedName, { displayName: e.target.value })}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <VoiceSelect
                          voices={voices}
                          value={merged ? null : row.voiceId}
                          onChange={(voiceId) => updateRow(row.parsedName, { voiceId })}
                        />
                      </div>
                    </td>
                    <td>{merged ? <span className="hint">merged</span> : matchBadge(row)}</td>
                    <td>
                      <select
                        value={row.mergeInto ?? ''}
                        onChange={(e) =>
                          updateRow(row.parsedName, { mergeInto: e.target.value || null })
                        }
                      >
                        <option value="">—</option>
                        {rows
                          .filter((r) => r.parsedName !== row.parsedName && r.mergeInto === null)
                          .map((r) => (
                            <option key={r.parsedName} value={r.parsedName}>
                              {r.displayName}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="hint">
            Voices were auto-matched by name similarity (misspellings like “Rachael” → “Rachel” are
            caught). Use <b>Merge into</b> when two script labels are the same person (e.g. “Voice
            1” and “Voice1”).
          </p>
          {hasExistingContent && (
            <div className="form-row">
              <label>Import mode</label>
              <label style={{ width: 'auto', color: 'var(--text)' }}>
                <input
                  type="radio"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />{' '}
                Replace current script
              </label>
              <label style={{ width: 'auto', color: 'var(--text)' }}>
                <input
                  type="radio"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                />{' '}
                Append as new sections
              </label>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
