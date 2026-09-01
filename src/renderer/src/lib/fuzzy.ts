import type { ElevenVoice } from '../../../shared/types'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Similarity in [0, 1]: 1 = identical (after normalization). */
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  // Containment counts for a lot ("Rachel" vs "Rachel (news anchor)")
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length)
    return 0.8 + 0.2 * ratio
  }
  const dist = levenshtein(na, nb)
  return 1 - dist / Math.max(na.length, nb.length)
}

export interface VoiceMatch {
  voice: ElevenVoice
  score: number
}

/** Rank the account's voices against a speaker name from the script. */
export function matchVoices(speakerName: string, voices: ElevenVoice[]): VoiceMatch[] {
  return voices
    .map((voice) => ({ voice, score: similarity(speakerName, voice.name) }))
    .sort((a, b) => b.score - a.score)
}

/** Threshold above which we auto-assign a match (misspellings like Rachael→Rachel score ~0.86). */
export const AUTO_MATCH_THRESHOLD = 0.72

export function bestAutoMatch(speakerName: string, voices: ElevenVoice[]): ElevenVoice | null {
  const ranked = matchVoices(speakerName, voices)
  if (ranked.length > 0 && ranked[0].score >= AUTO_MATCH_THRESHOLD) return ranked[0].voice
  return null
}
