import { useEffect, useRef, useState } from 'react'
import type { ClipItem, LineItem, VoiceSettings } from '../../../shared/types'
import { useStore } from '../store'
import {
  effectiveSettings,
  estimateChars,
  formatChars,
  formatDuration,
  lineChars,
  lineStatus,
  pendingLines,
  sectionLines,
  type LineStatus
} from '../lib/model'
import { VoiceSelect } from './VoiceSelect'

const STATUS_LABEL: Record<LineStatus, string> = {
  generated: 'Generated and up to date',
  stale: 'Edited since last generation — regenerate to update audio',
  'not-generated': 'Not generated yet',
  'no-voice': 'No voice assigned to this speaker',
  empty: 'Empty line'
}

export function SectionEditor(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedSectionId = useStore((s) => s.selectedSectionId)
  const renameSection = useStore((s) => s.renameSection)
  const addLine = useStore((s) => s.addLine)
  const insertClips = useStore((s) => s.insertClips)
  const generateLines = useStore((s) => s.generateLines)
  const playFrom = useStore((s) => s.playFrom)
  const queue = useStore((s) => s.queue)

  const section = project.sections.find((x) => x.id === selectedSectionId) ?? project.sections[0]
  if (!section) return <div className="section-editor" />

  const lines = sectionLines(section)
  const pending = pendingLines(project, lines)
  const chars = estimateChars(lines)

  return (
    <div className="section-editor">
      <div className="section-header">
        <input
          className="section-name"
          value={section.name}
          onChange={(e) => renameSection(section.id, e.target.value)}
        />
        <span className="sec-stats">
          {lines.length} lines · {formatChars(chars)} characters
          {pending.length > 0 &&
            ` · ${pending.length} need generation (~${formatChars(estimateChars(pending))} ch)`}
        </span>
        <button
          disabled={queue.running || pending.length === 0}
          onClick={() => void generateLines(pending.map((l) => l.id))}
          title={`Generate the ${pending.length} new/stale line(s) in this section`}
        >
          Generate section
        </button>
        <button onClick={() => void playFrom(null, section.id)} title="Play this section">
          ▶ Play section
        </button>
      </div>

      {section.items.length === 0 && (
        <div className="empty-hint">
          This section is empty.
          <br />
          Add a line below, or use <b>Import script</b> to bring in a document written like
          <br />
          <code>Voice 1: Hey Sam.</code>
        </div>
      )}

      {section.items.map((item, index) =>
        item.type === 'line' ? (
          <LineRow key={item.id} line={item} sectionId={section.id} index={index} />
        ) : (
          <ClipRow key={item.id} clip={item} />
        )
      )}

      <div className="add-row">
        <button onClick={() => addLine(section.id)}>+ Add line</button>
        <button onClick={() => void insertClips(section.id)}>♪ Insert audio clip…</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- LineRow

function LineRow({
  line,
  sectionId,
  index
}: {
  line: LineItem
  sectionId: string
  index: number
}): React.JSX.Element {
  const project = useStore((s) => s.project)
  const voices = useStore((s) => s.voices)
  const setLineSpeaker = useStore((s) => s.setLineSpeaker)
  const updateLineText = useStore((s) => s.updateLineText)
  const deleteItem = useStore((s) => s.deleteItem)
  const moveItem = useStore((s) => s.moveItem)
  const addLine = useStore((s) => s.addLine)
  const insertClips = useStore((s) => s.insertClips)
  const generateLines = useStore((s) => s.generateLines)
  const playItem = useStore((s) => s.playItem)
  const queue = useStore((s) => s.queue)
  const error = useStore((s) => s.lineErrors[line.id])
  const playing = useStore((s) => s.playingItemId === line.id)

  const [detailsOpen, setDetailsOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Autosize the textarea
  useEffect(() => {
    const ta = taRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight + 2}px`
    }
  }, [line.text])

  const status = lineStatus(project, line)
  const generating = queue.running && queue.currentLineId === line.id
  const chars = lineChars(line)
  const duration = line.generation?.durationSec

  return (
    <>
      <div className={`item-row${playing ? ' playing' : ''}${generating ? ' generating' : ''}`}>
        <div className="line-left">
          <select
            value={line.speakerId ?? ''}
            onChange={(e) => setLineSpeaker(line.id, e.target.value || null)}
            style={{
              borderLeft: `3px solid ${
                project.speakers.find((sp) => sp.id === line.speakerId)?.color ?? 'var(--border)'
              }`
            }}
          >
            <option value="">— speaker —</option>
            {project.speakers.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
          <div className="line-badges">
            <span className={`status-dot status-${status}`} title={STATUS_LABEL[status]} />
            <span>{formatChars(chars)} ch</span>
            {duration != null && <span>· {formatDuration(duration)}</span>}
            {line.voiceOverride && <span title="Per-line voice override active">· V*</span>}
            {line.settingsOverride && <span title="Per-line settings override active">· S*</span>}
            {generating && <span>· generating…</span>}
          </div>
        </div>

        <div className="line-mid">
          <textarea
            ref={taRef}
            value={line.text}
            placeholder="Line text…"
            onChange={(e) => updateLineText(line.id, e.target.value)}
          />
          {status === 'no-voice' && chars > 0 && (
            <span className="warn-text">Assign a voice to this speaker in the sidebar.</span>
          )}
          {error && <span className="line-error">{error}</span>}
        </div>

        <div className="line-actions">
          <div className="row">
            <button
              className="ghost"
              title="Play this line"
              disabled={!line.generation}
              onClick={() => void playItem(line.id)}
            >
              ▶
            </button>
            <button
              className="ghost"
              title={status === 'generated' ? 'Regenerate (uses credits)' : 'Generate this line'}
              disabled={queue.running || status === 'empty' || status === 'no-voice'}
              onClick={() => void generateLines([line.id])}
            >
              ⟳
            </button>
            <button
              className="ghost"
              title="Per-line voice/settings overrides & gap"
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              ⚙
            </button>
            <button
              className="ghost danger"
              title="Delete line"
              onClick={() => deleteItem(line.id)}
            >
              ✕
            </button>
          </div>
          <div className="row">
            <button className="ghost" title="Move up" onClick={() => moveItem(line.id, -1)}>
              ↑
            </button>
            <button className="ghost" title="Move down" onClick={() => moveItem(line.id, 1)}>
              ↓
            </button>
            <button
              className="ghost"
              title="Insert line after"
              onClick={() => addLine(sectionId, index + 1)}
            >
              +
            </button>
            <button
              className="ghost"
              title="Insert audio clip after"
              onClick={() => void insertClips(sectionId, index + 1)}
            >
              ♪
            </button>
          </div>
        </div>
      </div>
      {detailsOpen && <LineDetails line={line} voices={voices} />}
    </>
  )
}

// ------------------------------------------------------------ LineDetails

function LineDetails({
  line,
  voices
}: {
  line: LineItem
  voices: ReturnType<typeof useStore.getState>['voices']
}): React.JSX.Element {
  const project = useStore((s) => s.project)
  const setLineOverrides = useStore((s) => s.setLineOverrides)
  const setItemGap = useStore((s) => s.setItemGap)

  const effective = effectiveSettings(project, line)
  const hasSettingsOverride = !!line.settingsOverride

  const setSetting = (key: keyof VoiceSettings, value: number): void => {
    setLineOverrides(line.id, {
      voiceOverride: line.voiceOverride,
      settingsOverride: { ...(line.settingsOverride ?? effective), [key]: value }
    })
  }

  const slider = (
    label: string,
    key: keyof VoiceSettings,
    min: number,
    max: number,
    step: number,
    fallback: number
  ): React.JSX.Element => {
    const value = (hasSettingsOverride ? line.settingsOverride?.[key] : effective[key]) ?? fallback
    return (
      <div className="field">
        <label>{label}</label>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => setSetting(key, Number(e.target.value))}
        />
        <span className="val">{Number(value).toFixed(2)}</span>
      </div>
    )
  }

  return (
    <div className="line-details">
      <div className="field">
        <label>Voice override</label>
        <VoiceSelect
          voices={voices}
          value={line.voiceOverride ?? null}
          onChange={(voiceId) =>
            setLineOverrides(line.id, {
              voiceOverride: voiceId,
              settingsOverride: line.settingsOverride
            })
          }
          noneLabel="— use speaker's voice —"
        />
      </div>
      {slider('Stability', 'stability', 0, 1, 0.05, 0.5)}
      {slider('Similarity', 'similarity_boost', 0, 1, 0.05, 0.75)}
      {slider('Style', 'style', 0, 1, 0.05, 0)}
      {slider('Speed', 'speed', 0.7, 1.2, 0.01, 1)}
      <div className="field">
        <label>Gap after (ms)</label>
        <input
          type="number"
          min={0}
          step={50}
          value={line.gapAfterMs ?? ''}
          placeholder={String(project.settings.gapMs)}
          onChange={(e) =>
            setItemGap(line.id, e.target.value === '' ? null : Number(e.target.value))
          }
          style={{ width: 100 }}
        />
        <span className="hint">blank = project default ({project.settings.gapMs}ms)</span>
      </div>
      <div className="field">
        <span className="hint">
          Changing any of these marks the line stale — regenerate to apply.
          {hasSettingsOverride && ' Settings override active.'}
        </span>
        {(hasSettingsOverride || line.voiceOverride) && (
          <button
            className="ghost"
            onClick={() =>
              setLineOverrides(line.id, { voiceOverride: null, settingsOverride: null })
            }
          >
            Clear overrides
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ClipRow

function ClipRow({ clip }: { clip: ClipItem }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const deleteItem = useStore((s) => s.deleteItem)
  const moveItem = useStore((s) => s.moveItem)
  const setItemGap = useStore((s) => s.setItemGap)
  const playItem = useStore((s) => s.playItem)
  const playing = useStore((s) => s.playingItemId === clip.id)

  return (
    <div className={`item-row${playing ? ' playing' : ''}`}>
      <div className="clip-row-body">
        <span className="clip-icon">♪</span>
        <span className="clip-name" title={clip.path}>
          {clip.name}
        </span>
        <span className="clip-meta">
          audio clip · {formatDuration(clip.durationSec)} · gap{' '}
          <input
            type="number"
            min={0}
            step={50}
            value={clip.gapAfterMs ?? ''}
            placeholder={String(project.settings.gapMs)}
            onChange={(e) =>
              setItemGap(clip.id, e.target.value === '' ? null : Number(e.target.value))
            }
            style={{ width: 70, padding: '2px 6px' }}
          />{' '}
          ms
        </span>
      </div>
      <div className="line-actions">
        <div className="row">
          <button className="ghost" title="Play clip" onClick={() => void playItem(clip.id)}>
            ▶
          </button>
          <button className="ghost" title="Move up" onClick={() => moveItem(clip.id, -1)}>
            ↑
          </button>
          <button className="ghost" title="Move down" onClick={() => moveItem(clip.id, 1)}>
            ↓
          </button>
          <button className="ghost danger" title="Remove clip" onClick={() => deleteItem(clip.id)}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
