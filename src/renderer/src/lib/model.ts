import type {
  ClipItem,
  LineItem,
  Project,
  Section,
  SequenceItem,
  Speaker,
  VoiceSettings
} from '../../../shared/types'
import { DEFAULT_MODEL_ID } from '../../../shared/types'
import { contentHash } from './hash'

export const SPEAKER_COLORS = [
  '#e05d5d',
  '#4f9cf0',
  '#4fc07a',
  '#c98add',
  '#e0a33d',
  '#4fc0c0',
  '#e07db0',
  '#94a94f',
  '#8a8df0',
  '#d08a5a'
]

export function uid(): string {
  return crypto.randomUUID()
}

export function newProject(name = 'Untitled episode'): Project {
  return {
    version: 1,
    id: uid(),
    name,
    speakers: [],
    sections: [{ id: uid(), name: 'Section 1', items: [] }],
    settings: {
      modelId: DEFAULT_MODEL_ID,
      defaultVoiceSettings: {},
      gapMs: 300
    }
  }
}

export function newSpeaker(name: string, index: number, voiceId: string | null = null): Speaker {
  return { id: uid(), name, voiceId, color: SPEAKER_COLORS[index % SPEAKER_COLORS.length] }
}

export function newLine(speakerId: string | null = null, text = ''): LineItem {
  return { id: uid(), type: 'line', speakerId, text }
}

export function newClip(path: string, name: string): ClipItem {
  return { id: uid(), type: 'clip', path, name }
}

export function getSpeaker(project: Project, speakerId: string | null): Speaker | null {
  if (!speakerId) return null
  return project.speakers.find((s) => s.id === speakerId) ?? null
}

/** Voice id actually used for a line: per-line override, else the speaker's voice. */
export function effectiveVoiceId(project: Project, line: LineItem): string | null {
  if (line.voiceOverride) return line.voiceOverride
  return getSpeaker(project, line.speakerId)?.voiceId ?? null
}

export function effectiveSettings(project: Project, line: LineItem): VoiceSettings {
  return { ...project.settings.defaultVoiceSettings, ...(line.settingsOverride ?? {}) }
}

export function ttsText(line: LineItem): string {
  return line.text.trim()
}

/** Hash of everything that affects the generated audio for a line. */
export function lineHash(project: Project, line: LineItem): string {
  const voiceId = effectiveVoiceId(project, line)
  const settings = effectiveSettings(project, line)
  return contentHash(
    JSON.stringify([
      ttsText(line),
      voiceId,
      project.settings.modelId,
      settings.stability ?? null,
      settings.similarity_boost ?? null,
      settings.style ?? null,
      settings.speed ?? null
    ])
  )
}

export type LineStatus = 'no-voice' | 'empty' | 'not-generated' | 'stale' | 'generated'

export function lineStatus(project: Project, line: LineItem): LineStatus {
  if (!ttsText(line)) return 'empty'
  if (!effectiveVoiceId(project, line)) return 'no-voice'
  if (!line.generation) return 'not-generated'
  return line.generation.hash === lineHash(project, line) ? 'generated' : 'stale'
}

export function lineChars(line: LineItem): number {
  return ttsText(line).length
}

export function isLine(item: SequenceItem): item is LineItem {
  return item.type === 'line'
}

export function isClip(item: SequenceItem): item is ClipItem {
  return item.type === 'clip'
}

export interface FlatItem {
  sectionId: string
  item: SequenceItem
}

/** All items across all sections, in episode order. */
export function flattenItems(project: Project): FlatItem[] {
  const out: FlatItem[] = []
  for (const section of project.sections) {
    for (const item of section.items) {
      out.push({ sectionId: section.id, item })
    }
  }
  return out
}

export function allLines(project: Project): LineItem[] {
  return flattenItems(project)
    .map((f) => f.item)
    .filter(isLine)
}

export function sectionLines(section: Section): LineItem[] {
  return section.items.filter(isLine)
}

/** Lines that would consume credits if "generate" ran over them (stale or new, with voice+text). */
export function pendingLines(project: Project, lines: LineItem[]): LineItem[] {
  return lines.filter((l) => {
    const s = lineStatus(project, l)
    return s === 'not-generated' || s === 'stale'
  })
}

export function estimateChars(lines: LineItem[]): number {
  return lines.reduce((sum, l) => sum + lineChars(l), 0)
}

export function gapAfter(project: Project, item: SequenceItem): number {
  return item.gapAfterMs ?? project.settings.gapMs
}

export function formatDuration(sec: number | undefined | null): string {
  if (sec == null || !Number.isFinite(sec)) return '–:––'
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function formatChars(n: number): string {
  return n.toLocaleString('en-US')
}
