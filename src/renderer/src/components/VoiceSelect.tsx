import { useState } from 'react'
import type { ElevenVoice } from '../../../shared/types'
import { togglePreview } from '../lib/player'

interface VoiceSelectProps {
  voices: ElevenVoice[]
  value: string | null
  onChange: (voiceId: string | null) => void
  noneLabel?: string
}

/** Voice dropdown with a preview-play button for the selected voice. */
export function VoiceSelect({
  voices,
  value,
  onChange,
  noneLabel = '— no voice —'
}: VoiceSelectProps): React.JSX.Element {
  const [previewing, setPreviewing] = useState(false)
  const selected = voices.find((v) => v.voice_id === value)
  const sorted = [...voices].sort((a, b) => a.name.localeCompare(b.name))
  // Keep an entry visible even if the assigned voice no longer exists on the account
  const missing = value && !selected

  return (
    <>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{noneLabel}</option>
        {missing && <option value={value!}>(unknown voice {value!.slice(0, 6)}…)</option>}
        {sorted.map((v) => (
          <option key={v.voice_id} value={v.voice_id}>
            {v.name}
            {v.category === 'cloned' ? ' (cloned)' : ''}
          </option>
        ))}
      </select>
      <button
        className="ghost"
        disabled={!selected?.preview_url}
        title={selected?.preview_url ? `Preview ${selected.name}` : 'No preview available'}
        onClick={() => {
          if (selected?.preview_url) {
            const playing = togglePreview(selected.preview_url, () => setPreviewing(false))
            setPreviewing(playing)
          }
        }}
      >
        {previewing ? '◼' : '▶'}
      </button>
    </>
  )
}
