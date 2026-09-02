import type { ElevenVoice, GenerateRequest, SubscriptionInfo } from '../shared/types'
import {
  ElevenLabsError,
  getSubscriptionWith,
  listVoicesWith,
  textToSpeechWith,
  validateKeyWith
} from '../shared/elevenlabs'
import { getApiKey } from './settings'

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

/** Validate a key (the given one, or the stored one) against GET /v1/user */
export async function validateKey(key?: string): Promise<{ ok: boolean; error?: string }> {
  const useKey = key?.trim() || getApiKey()
  if (!useKey) return { ok: false, error: 'No API key provided.' }
  return validateKeyWith(useKey)
}

export function listVoices(): Promise<ElevenVoice[]> {
  return listVoicesWith(requireKey())
}

export function getSubscription(): Promise<SubscriptionInfo> {
  return getSubscriptionWith(requireKey())
}

export interface TtsResult {
  audio: Buffer
  requestId?: string
  characterCost?: number
}

export async function textToSpeech(req: GenerateRequest): Promise<TtsResult> {
  const raw = await textToSpeechWith(requireKey(), req)
  return {
    audio: Buffer.from(raw.audio),
    requestId: raw.requestId,
    characterCost: raw.characterCost
  }
}
