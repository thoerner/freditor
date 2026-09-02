import { useState } from 'react'
import { MODELS } from '../../../shared/types'
import { useStore } from '../store'
import { Modal } from './Modal'
import { formatChars } from '../lib/model'
import { isWeb } from '../backend'

export function SettingsModal(): React.JSX.Element {
  const settingsView = useStore((s) => s.settingsView)
  const subscription = useStore((s) => s.subscription)
  const project = useStore((s) => s.project)
  const setModal = useStore((s) => s.setModal)
  const saveApiKey = useStore((s) => s.saveApiKey)
  const clearApiKey = useStore((s) => s.clearApiKey)
  const setModelId = useStore((s) => s.setModelId)
  const setDefaultGap = useStore((s) => s.setDefaultGap)
  const refreshSubscription = useStore((s) => s.refreshSubscription)

  const [keyInput, setKeyInput] = useState('')
  const [keyStatus, setKeyStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [keyError, setKeyError] = useState('')

  const onSaveKey = async (): Promise<void> => {
    setKeyStatus('checking')
    setKeyError('')
    const res = await saveApiKey(keyInput)
    if (res.ok) {
      setKeyStatus('ok')
      setKeyInput('')
    } else {
      setKeyStatus('error')
      setKeyError(res.error ?? 'Validation failed')
    }
  }

  const model = MODELS.find((m) => m.id === project.settings.modelId)

  return (
    <Modal title="Settings" onClose={() => setModal(null)}>
      <div className="form-row">
        <label>ElevenLabs API key</label>
        <input
          type="password"
          placeholder={
            settingsView?.hasApiKey
              ? `Saved (${settingsView.apiKeyHint}) — paste to replace`
              : 'xi-api-key…'
          }
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value)
            setKeyStatus('idle')
          }}
        />
        <button
          className="primary"
          disabled={!keyInput.trim() || keyStatus === 'checking'}
          onClick={() => void onSaveKey()}
        >
          {keyStatus === 'checking' ? 'Validating…' : 'Validate & save'}
        </button>
        {settingsView?.hasApiKey && (
          <button className="danger" onClick={() => void clearApiKey()}>
            Remove
          </button>
        )}
      </div>
      {keyStatus === 'ok' && <span className="ok-text">Key validated and saved.</span>}
      {keyStatus === 'error' && <span className="error-text">{keyError}</span>}
      {settingsView?.keyStorageInsecure && (
        <span className="warn-text">
          {isWeb
            ? 'The key is stored in this browser (localStorage) and never sent anywhere except the ElevenLabs API.'
            : 'Your OS keychain is unavailable, so the key is stored unencrypted on disk.'}
        </span>
      )}
      <p className="hint">
        Get a key at elevenlabs.io → Profile → API keys. The key stays on this machine and is only
        sent to the ElevenLabs API.
      </p>

      <div className="form-row">
        <label>TTS model</label>
        <select value={project.settings.modelId} onChange={(e) => setModelId(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {model && !model.supportsStitching && (
        <span className="warn-text">
          This model does not support request stitching — prosody may vary more between lines.
        </span>
      )}
      <p className="hint">
        Changing the model marks all generated lines stale (audio is model-specific).
      </p>

      <div className="form-row">
        <label>Default gap between items</label>
        <input
          type="number"
          min={0}
          step={50}
          value={project.settings.gapMs}
          onChange={(e) => setDefaultGap(Number(e.target.value))}
          style={{ width: 100, flex: 'none' }}
        />
        <span className="hint">ms of silence in playback & export (override per line)</span>
      </div>

      {subscription && (
        <>
          <div className="form-row">
            <label>Subscription</label>
            <span>
              {subscription.tier} — {formatChars(subscription.characterCount)} /{' '}
              {formatChars(subscription.characterLimit)} characters used
              {subscription.nextResetUnix
                ? `, resets ${new Date(subscription.nextResetUnix * 1000).toLocaleDateString()}`
                : ''}
            </span>
            <button className="ghost" onClick={() => void refreshSubscription()}>
              ⟳
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
