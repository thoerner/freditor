import { useState } from 'react'
import { useStore } from '../store'
import { estimateChars, formatChars, sectionLines } from '../lib/model'
import { VoiceSelect } from './VoiceSelect'

export function Sidebar(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const voices = useStore((s) => s.voices)
  const voicesStatus = useStore((s) => s.voicesStatus)
  const selectedSectionId = useStore((s) => s.selectedSectionId)
  const selectSection = useStore((s) => s.selectSection)
  const addSection = useStore((s) => s.addSection)
  const deleteSection = useStore((s) => s.deleteSection)
  const moveSection = useStore((s) => s.moveSection)
  const addSpeaker = useStore((s) => s.addSpeaker)
  const renameSpeaker = useStore((s) => s.renameSpeaker)
  const setSpeakerVoice = useStore((s) => s.setSpeakerVoice)
  const deleteSpeaker = useStore((s) => s.deleteSpeaker)
  const refreshVoices = useStore((s) => s.refreshVoices)
  const settingsView = useStore((s) => s.settingsView)

  const [newSpeakerName, setNewSpeakerName] = useState('')

  return (
    <div className="sidebar">
      <div className="side-block">
        <h3>
          Sections
          <button className="ghost" onClick={addSection} title="Add section">
            +
          </button>
        </h3>
        {project.sections.map((sec, i) => {
          const lines = sectionLines(sec)
          return (
            <div
              key={sec.id}
              className={`section-item${sec.id === selectedSectionId ? ' active' : ''}`}
              onClick={() => selectSection(sec.id)}
            >
              <span className="sec-name">{sec.name}</span>
              <span className="sec-meta">
                {lines.length}L · {formatChars(estimateChars(lines))}ch
              </span>
              <span className="row-actions">
                <button
                  className="ghost"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    moveSection(sec.id, -1)
                  }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="ghost"
                  disabled={i === project.sections.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    moveSection(sec.id, 1)
                  }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="ghost danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (
                      sec.items.length === 0 ||
                      window.confirm(
                        `Delete section "${sec.name}" and its ${sec.items.length} item(s)?`
                      )
                    ) {
                      deleteSection(sec.id)
                    }
                  }}
                  title="Delete section"
                >
                  ✕
                </button>
              </span>
            </div>
          )
        })}
      </div>

      <div className="side-block">
        <h3>
          Speakers
          {settingsView?.hasApiKey && (
            <button
              className="ghost"
              onClick={() => void refreshVoices()}
              title="Re-sync voices from ElevenLabs"
            >
              {voicesStatus === 'loading' ? '…' : '⟳'}
            </button>
          )}
        </h3>
        {project.speakers.length === 0 && (
          <p className="hint">
            No speakers yet. Import a script or add a speaker, then assign it an ElevenLabs voice.
          </p>
        )}
        {project.speakers.map((sp) => (
          <div key={sp.id} className="speaker-row">
            <div className="speaker-head">
              <span className="speaker-dot" style={{ background: sp.color }} />
              <input value={sp.name} onChange={(e) => renameSpeaker(sp.id, e.target.value)} />
              <button
                className="ghost danger"
                title="Delete speaker (lines keep their text)"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete speaker "${sp.name}"? Their lines will be left unassigned.`
                    )
                  ) {
                    deleteSpeaker(sp.id)
                  }
                }}
              >
                ✕
              </button>
            </div>
            <div className="speaker-voice">
              <VoiceSelect
                voices={voices}
                value={sp.voiceId}
                onChange={(voiceId) => setSpeakerVoice(sp.id, voiceId)}
              />
            </div>
            {!sp.voiceId && <span className="warn-text">no voice assigned</span>}
          </div>
        ))}
        <form
          style={{ display: 'flex', gap: 6, marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault()
            const name = newSpeakerName.trim()
            if (name) {
              addSpeaker(name)
              setNewSpeakerName('')
            }
          }}
        >
          <input
            type="text"
            placeholder="Add speaker…"
            value={newSpeakerName}
            onChange={(e) => setNewSpeakerName(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" disabled={!newSpeakerName.trim()}>
            Add
          </button>
        </form>
        {voicesStatus === 'error' && (
          <p className="error-text" style={{ marginTop: 8 }}>
            Could not load voices: {useStore.getState().voicesError}
          </p>
        )}
      </div>
    </div>
  )
}
