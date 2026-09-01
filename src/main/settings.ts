import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { AppSettingsView } from '../shared/types'

interface PersistedSettings {
  apiKey?: {
    encrypted: boolean
    /** base64 of encrypted buffer, or plaintext if encryption unavailable */
    data: string
  }
  recentProjects?: string[]
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): PersistedSettings {
  try {
    const p = settingsPath()
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf-8')) as PersistedSettings
  } catch {
    return {}
  }
}

function writeSettings(s: PersistedSettings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}

export function setApiKey(key: string): void {
  const s = readSettings()
  const trimmed = key.trim()
  if (!trimmed) {
    delete s.apiKey
  } else if (safeStorage.isEncryptionAvailable()) {
    s.apiKey = { encrypted: true, data: safeStorage.encryptString(trimmed).toString('base64') }
  } else {
    // Fall back to plaintext storage (surfaced to the user via keyStorageInsecure)
    s.apiKey = { encrypted: false, data: Buffer.from(trimmed, 'utf-8').toString('base64') }
  }
  writeSettings(s)
}

export function clearApiKey(): void {
  const s = readSettings()
  delete s.apiKey
  writeSettings(s)
}

export function getApiKey(): string | null {
  const s = readSettings()
  if (!s.apiKey) return null
  try {
    const buf = Buffer.from(s.apiKey.data, 'base64')
    if (s.apiKey.encrypted) {
      return safeStorage.decryptString(buf)
    }
    return buf.toString('utf-8')
  } catch (err) {
    console.error('Failed to decrypt API key:', err)
    return null
  }
}

export function getSettingsView(): AppSettingsView {
  const s = readSettings()
  const key = getApiKey()
  let hint: string | null = null
  if (key && key.length > 8) {
    hint = `${key.slice(0, 5)}…${key.slice(-4)}`
  } else if (key) {
    hint = '•••'
  }
  return {
    hasApiKey: !!key,
    apiKeyHint: hint,
    keyStorageInsecure: !!s.apiKey && !s.apiKey.encrypted
  }
}

export function getRecentProjects(): string[] {
  return (readSettings().recentProjects ?? []).filter((p) => existsSync(p))
}

export function addRecentProject(path: string): void {
  const s = readSettings()
  const list = (s.recentProjects ?? []).filter((p) => p !== path)
  list.unshift(path)
  s.recentProjects = list.slice(0, 10)
  writeSettings(s)
}
