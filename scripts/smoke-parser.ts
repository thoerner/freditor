/**
 * Smoke test for the script parser and fuzzy voice matcher.
 * Run with: npx tsx scripts/smoke-parser.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseScript } from '../src/renderer/src/lib/parser'
import { similarity, bestAutoMatch } from '../src/renderer/src/lib/fuzzy'
import type { ElevenVoice } from '../src/shared/types'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ok: ${name}`)
  } else {
    failures++
    console.error(`  FAIL: ${name}`, detail ?? '')
  }
}

// ---- parser: demo file ----
console.log('parser: demo-script.txt')
const demo = readFileSync(join(__dirname, '../demo/demo-script.txt'), 'utf-8')
const res = parseScript(demo)
check('3 sections from headings', res.sections.length === 3, res.sections.map((s) => s.name))
check(
  'section names',
  res.sections.map((s) => s.name).join('|') === 'Cold open|Main story|Outro'
)
check('3 speakers detected', res.speakers.join('|') === 'Voice 1|Voice 2|Rachael', res.speakers)
const allCues = res.sections.flatMap((s) => s.cues)
check('9 cues total', allCues.length === 9, allCues.length)
const multiline = allCues.find((c) => c.text.includes('read the headline'))
check(
  'multi-line cue joined under one speaker',
  !!multiline && multiline.speaker === 'Voice 2' && multiline.text.includes("couldn't believe")
)

// ---- parser: edge cases ----
console.log('parser: edge cases')
const edge = parseScript(
  '**Host:** welcome back\n\nGuest (Jane): thanks!\nIt is 10:30 right now.\n\n---\n\nHost: part two\n'
)
check('markdown bold labels stripped', edge.speakers.includes('Host'), edge.speakers)
check('parenthesised label ok', edge.speakers.includes('Guest (Jane)'), edge.speakers)
const janeCue = edge.sections[0].cues.find((c) => c.speaker === 'Guest (Jane)')
check(
  'time "10:30" not treated as new speaker',
  !!janeCue && janeCue.text.includes('10:30'),
  janeCue
)
check('divider creates second section', edge.sections.length === 2, edge.sections.length)

const noise = parseScript('just some prose\nwith no labels\n')
check('prose without labels -> no cues, orphans reported', noise.sections.length === 0 && noise.orphanText.length === 2)

// ---- fuzzy matching ----
console.log('fuzzy matcher')
const voices: ElevenVoice[] = [
  { voice_id: 'v1', name: 'Rachel' },
  { voice_id: 'v2', name: 'Adam' },
  { voice_id: 'v3', name: 'Sam the Narrator' },
  { voice_id: 'v4', name: 'Joe' }
]
check('misspelling Rachael -> Rachel', bestAutoMatch('Rachael', voices)?.voice_id === 'v1')
check('exact Adam', bestAutoMatch('Adam', voices)?.voice_id === 'v2')
check('containment Sam -> Sam the Narrator', bestAutoMatch('Sam', voices)?.voice_id === 'v3')
check('"Voice 1" does not auto-match anything', bestAutoMatch('Voice 1', voices) === null)
check(
  'similarity is case/punct-insensitive',
  similarity('JOE!', 'joe') === 1,
  similarity('JOE!', 'joe')
)

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall parser/fuzzy checks passed')
