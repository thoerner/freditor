import type { ElevenVoice, GenerateRequest, SubscriptionInfo, VoiceSettings } from '../shared/types'
import { getApiKey } from './settings'

const API_BASE = 'https://api.elevenlabs.io'

export class ElevenLabsError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function requireKey(): string {
  const key = getApiKey()
  if (!key) {
    throw new ElevenLabsError(
      0,
      'no_api_key',
      'No ElevenLabs API key configured. Add one in Settings.'
    )
  }
  return key
}

async function toApiError(res: Response): Promise<ElevenLabsError> {
  let message = `ElevenLabs API error (HTTP ${res.status})`
  let code = `http_${res.status}`
  try {
    const body = (await res.json()) as { detail?: { status?: string; message?: string } | string }
    if (typeof body.detail === 'string') {
      message = body.detail
    } else if (body.detail?.message) {
      message = body.detail.message
      if (body.detail.status) code = body.detail.status
    }
  } catch {
    // keep generic message
  }
  if (res.status === 401) {
    code = 'invalid_api_key'
    message = 'Invalid or expired API key. Check it in Settings.'
  } else if (code === 'quota_exceeded') {
    message = `Character quota exceeded: ${message}`
  } else if (res.status === 429) {
    if (code === `http_429`) code = 'rate_limited'
    message = `Rate limited or quota exceeded: ${message}`
  }
  return new ElevenLabsError(res.status, code, message)
}

/** Validate a key (the given one, or the stored one) against GET /v1/user */
export async function validateKey(key?: string): Promise<{ ok: boolean; error?: string }> {
  const useKey = key?.trim() || getApiKey()
  if (!useKey) return { ok: false, error: 'No API key provided.' }
  const res = await fetch(`${API_BASE}/v1/user`, { headers: { 'xi-api-key': useKey } })
  if (res.ok) return { ok: true }
  const err = await toApiError(res)
  return { ok: false, error: err.message }
}

export async function listVoices(): Promise<ElevenVoice[]> {
  const key = requireKey()
  const voices: ElevenVoice[] = []
  let pageToken: string | null = null
  // v2 voices endpoint is paginated
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API_BASE}/v2/voices`)
    url.searchParams.set('page_size', '100')
    if (pageToken) url.searchParams.set('next_page_token', pageToken)
    const res = await fetch(url, { headers: { 'xi-api-key': key } })
    if (!res.ok) throw await toApiError(res)
    const body = (await res.json()) as {
      voices: ElevenVoice[]
      has_more?: boolean
      next_page_token?: string | null
    }
    voices.push(...(body.voices ?? []))
    if (!body.has_more || !body.next_page_token) break
    pageToken = body.next_page_token
  }
  return voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    description: v.description ?? null,
    preview_url: v.preview_url ?? null,
    labels: v.labels ?? {}
  }))
}

export async function getSubscription(): Promise<SubscriptionInfo> {
  const key = requireKey()
  const res = await fetch(`${API_BASE}/v1/user/subscription`, {
    headers: { 'xi-api-key': key }
  })
  if (!res.ok) throw await toApiError(res)
  const body = (await res.json()) as {
    tier?: string
    character_count?: number
    character_limit?: number
    next_character_count_reset_unix?: number
    status?: string
  }
  return {
    tier: body.tier ?? 'unknown',
    characterCount: body.character_count ?? 0,
    characterLimit: body.character_limit ?? 0,
    nextResetUnix: body.next_character_count_reset_unix ?? null,
    status: body.status ?? 'unknown'
  }
}

function cleanSettings(s: VoiceSettings): VoiceSettings | undefined {
  const out: VoiceSettings = {}
  if (typeof s.stability === 'number') out.stability = s.stability
  if (typeof s.similarity_boost === 'number') out.similarity_boost = s.similarity_boost
  if (typeof s.style === 'number') out.style = s.style
  if (typeof s.speed === 'number') out.speed = s.speed
  return Object.keys(out).length > 0 ? out : undefined
}

export interface TtsResult {
  audio: Buffer
  requestId?: string
  characterCost?: number
}

/** POST /v1/text-to-speech/{voice_id} — returns mp3 audio plus request metadata */
export async function textToSpeech(req: GenerateRequest): Promise<TtsResult> {
  const key = requireKey()
  const url = new URL(`${API_BASE}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}`)
  url.searchParams.set('output_format', 'mp3_44100_128')

  const body: Record<string, unknown> = {
    text: req.text,
    model_id: req.modelId
  }
  const settings = cleanSettings(req.voiceSettings)
  if (settings) body.voice_settings = settings
  if (req.previousRequestIds && req.previousRequestIds.length > 0) {
    body.previous_request_ids = req.previousRequestIds.slice(-3)
  } else if (req.previousText) {
    body.previous_text = req.previousText
  }
  if (req.nextText) body.next_text = req.nextText

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw await toApiError(res)

  const requestId = res.headers.get('request-id') ?? undefined
  const costHeader = res.headers.get('character-cost')
  const characterCost = costHeader != null ? Number(costHeader) : undefined
  const audio = Buffer.from(await res.arrayBuffer())
  return {
    audio,
    requestId,
    characterCost: Number.isFinite(characterCost) ? characterCost : undefined
  }
}
