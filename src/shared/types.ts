// Shared types between main and renderer processes.

export interface VoiceSettings {
  stability?: number
  similarity_boost?: number
  style?: number
  speed?: number
}

export interface GenerationInfo {
  /** File name (not path) of the cached audio inside the project audio cache dir */
  audioFile: string
  /** Hash of text + voiceId + modelId + settings at generation time; used for stale detection */
  hash: string
  requestId?: string
  /** Actual character cost reported by ElevenLabs (character-cost header), if available */
  characterCost?: number
  durationSec?: number
  generatedAt: number
}

export interface LineItem {
  id: string
  type: 'line'
  speakerId: string | null
  text: string
  /** Per-line voice override (ElevenLabs voice id). Takes precedence over speaker voice. */
  voiceOverride?: string | null
  /** Per-line voice settings override. Takes precedence over project defaults. */
  settingsOverride?: VoiceSettings | null
  /** Per-item gap override (ms of silence after this item). null/undefined = project default */
  gapAfterMs?: number | null
  generation?: GenerationInfo | null
}

export interface ClipItem {
  id: string
  type: 'clip'
  /** Absolute path to the user's real audio file */
  path: string
  name: string
  gapAfterMs?: number | null
  durationSec?: number
}

export type SequenceItem = LineItem | ClipItem

export interface Section {
  id: string
  name: string
  items: SequenceItem[]
}

export interface Speaker {
  id: string
  /** Script-level name, e.g. "Voice 1", "Sam" */
  name: string
  /** ElevenLabs voice id, or null if unassigned */
  voiceId: string | null
  color: string
}

export interface ProjectSettings {
  modelId: string
  defaultVoiceSettings: VoiceSettings
  /** Default silence between items in ms */
  gapMs: number
}

export interface Project {
  version: 1
  id: string
  name: string
  speakers: Speaker[]
  sections: Section[]
  settings: ProjectSettings
}

export const DEFAULT_MODEL_ID = 'eleven_multilingual_v2'

export const MODELS: { id: string; label: string; supportsStitching: boolean }[] = [
  {
    id: 'eleven_multilingual_v2',
    label: 'Multilingual v2 (stitching supported)',
    supportsStitching: true
  },
  {
    id: 'eleven_turbo_v2_5',
    label: 'Turbo v2.5 (fast, stitching supported)',
    supportsStitching: true
  },
  {
    id: 'eleven_flash_v2_5',
    label: 'Flash v2.5 (fastest, cheapest, stitching supported)',
    supportsStitching: true
  },
  {
    id: 'eleven_v3',
    label: 'Eleven v3 (most expressive — request stitching NOT available)',
    supportsStitching: false
  }
]

export function modelSupportsStitching(modelId: string): boolean {
  const m = MODELS.find((m) => m.id === modelId)
  return m ? m.supportsStitching : modelId !== 'eleven_v3'
}

// ---- ElevenLabs API shapes (subset we use) ----

export interface ElevenVoice {
  voice_id: string
  name: string
  category?: string
  description?: string | null
  preview_url?: string | null
  labels?: Record<string, string>
}

export interface SubscriptionInfo {
  tier: string
  characterCount: number
  characterLimit: number
  nextResetUnix: number | null
  status: string
}

// ---- IPC payloads ----

export interface GenerateRequest {
  lineId: string
  text: string
  voiceId: string
  modelId: string
  voiceSettings: VoiceSettings
  previousText?: string | null
  nextText?: string | null
  previousRequestIds?: string[]
  /** Hash to store alongside the result */
  hash: string
}

export interface GenerateResult {
  audioFile: string
  requestId?: string
  characterCost?: number
}

export interface AppSettingsView {
  hasApiKey: boolean
  /** Masked key for display, e.g. "sk_...abcd" */
  apiKeyHint: string | null
  keyStorageInsecure: boolean
}

export interface ExportPlanEntry {
  /** 'cache' = file name inside project cache dir; 'abs' = absolute path (real clip) */
  kind: 'cache' | 'abs'
  file: string
  gapAfterMs: number
}

export interface ExportRequest {
  entries: ExportPlanEntry[]
  format: 'wav' | 'mp3'
  /** Suggested file name for the save dialog */
  suggestedName: string
}

export interface ExportSeparateRequest {
  /** Each entry exported as its own file, named by `name` */
  files: { kind: 'cache' | 'abs'; file: string; name: string }[]
  format: 'wav' | 'mp3'
}

export interface ParsedImport {
  /** Raw text content of the imported file */
  text: string
  fileName: string
}
