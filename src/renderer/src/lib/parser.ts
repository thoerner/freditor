export interface ParsedCue {
  speaker: string
  text: string
}

export interface ParsedSection {
  name: string
  cues: ParsedCue[]
}

export interface ParseResult {
  sections: ParsedSection[]
  speakers: string[]
  /** Lines that could not be attributed to any speaker (before the first cue) */
  orphanText: string[]
}

/**
 * Matches a speaker label at the start of a line, e.g.:
 *   "Voice 1: Hey Sam."   "SAM: hello"   "Host (Joe): welcome"
 * The label must contain at least one letter, be reasonably short, and not
 * contain sentence punctuation (to avoid matching things like URLs or times).
 */
const CUE_RE = /^([\p{L}\p{N}][\p{L}\p{N} .\-_'()#]{0,48}?)\s*:\s*(.*)$/u

function looksLikeSpeaker(label: string): boolean {
  if (!/\p{L}/u.test(label)) return false // must contain a letter ("10:30" is not a cue)
  if (label.trim().split(/\s+/).length > 5) return false // long phrases are prose, not names
  return true
}

/** Section heading: markdown heading, or a bracketed line like "[Intro]" */
function sectionHeading(line: string): string | null {
  const md = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
  if (md) return md[1].trim()
  const br = line.match(/^\[([^\]]{1,80})\]$/)
  if (br) return br[1].trim()
  return null
}

function isDivider(line: string): boolean {
  return /^\s*(-{3,}|={3,}|\*{3,})\s*$/.test(line)
}

/** Strip markdown emphasis wrappers that docs often put around speaker names. */
function preClean(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s*[>\u2022]\s*/, '')
    .replace(/\u00a0/g, ' ')
}

export function parseScript(raw: string): ParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')

  const sections: ParsedSection[] = []
  const orphanText: string[] = []
  const speakerOrder: string[] = []
  const speakerSeen = new Set<string>()

  let currentSection: ParsedSection | null = null
  let currentCue: ParsedCue | null = null

  const ensureSection = (name?: string): ParsedSection => {
    if (!currentSection || name) {
      currentSection = { name: name ?? `Section ${sections.length + 1}`, cues: [] }
      sections.push(currentSection)
    }
    return currentSection
  }

  const flushCue = (): void => {
    if (currentCue) {
      currentCue.text = currentCue.text.trim()
      if (currentCue.text) {
        ensureSection().cues.push(currentCue)
        if (!speakerSeen.has(currentCue.speaker)) {
          speakerSeen.add(currentCue.speaker)
          speakerOrder.push(currentCue.speaker)
        }
      }
      currentCue = null
    }
  }

  for (const rawLine of lines) {
    const line = preClean(rawLine)
    const trimmed = line.trim()

    if (!trimmed) continue

    const heading = sectionHeading(trimmed)
    if (heading) {
      flushCue()
      currentSection = { name: heading, cues: [] }
      sections.push(currentSection)
      continue
    }

    if (isDivider(trimmed)) {
      // A divider (---) starts a new unnamed section
      flushCue()
      currentSection = { name: `Section ${sections.length + 1}`, cues: [] }
      sections.push(currentSection)
      continue
    }

    const m = trimmed.match(CUE_RE)
    if (m && looksLikeSpeaker(m[1])) {
      flushCue()
      currentCue = { speaker: m[1].trim(), text: m[2] ?? '' }
      continue
    }

    // Continuation of the current cue (multi-line paragraph under one label)
    if (currentCue) {
      currentCue.text += (currentCue.text ? '\n' : '') + trimmed
    } else {
      orphanText.push(trimmed)
    }
  }
  flushCue()

  // Drop empty sections (e.g. heading with no cues)
  const nonEmpty = sections.filter((s) => s.cues.length > 0)

  return { sections: nonEmpty, speakers: speakerOrder, orphanText }
}
