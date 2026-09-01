/**
 * Smoke test for the ffmpeg stitch/export pipeline (no Electron needed).
 * Run with: npx tsx scripts/smoke-ffmpeg.ts
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { stitchAndExport, exportSeparate } from '../src/main/audioexport'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath = require('ffmpeg-static') as string

function makeTone(path: string, hz: number, seconds: number, mp3 = false): void {
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${hz}:duration=${seconds}`,
    ...(mp3 ? ['-c:a', 'libmp3lame', '-b:a', '128k'] : ['-ar', '22050', '-ac', '1']),
    path
  ])
}

function durationOf(path: string): number {
  const out = execFileSync(ffmpegPath, ['-hide_banner', '-i', path, '-f', 'null', '-'], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  void out
  // ffmpeg prints duration on stderr; rerun capturing stderr
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', path], { stdio: 'pipe' })
  } catch (err) {
    const stderr = String((err as { stderr: Buffer }).stderr)
    const m = stderr.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100
  }
  throw new Error(`Could not read duration of ${path}`)
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'freditor-smoke-'))
  let failures = 0
  const check = (name: string, cond: boolean, detail?: unknown): void => {
    if (cond) console.log(`  ok: ${name}`)
    else {
      failures++
      console.error(`  FAIL: ${name}`, detail ?? '')
    }
  }

  try {
    // Mixed formats/sample rates, like real usage (mp3 generations + arbitrary user clips)
    const a = join(tmp, 'a.wav') // 1.0s mono 22k wav
    const b = join(tmp, 'b.mp3') // 0.5s mp3
    makeTone(a, 440, 1.0)
    makeTone(b, 660, 0.5, true)

    console.log('stitch: wav output with 300ms + 0ms gaps')
    const outWav = join(tmp, 'out.wav')
    await stitchAndExport(
      [
        { path: a, gapAfterMs: 300 },
        { path: b, gapAfterMs: 500 } // trailing gap must NOT be appended
      ],
      'wav',
      outWav
    )
    const dWav = durationOf(outWav)
    check(`duration ≈ 1.8s (got ${dWav.toFixed(2)}s)`, Math.abs(dWav - 1.8) < 0.1)

    console.log('stitch: mp3 output')
    const outMp3 = join(tmp, 'out.mp3')
    await stitchAndExport(
      [
        { path: b, gapAfterMs: 1000 },
        { path: a, gapAfterMs: 0 }
      ],
      'mp3',
      outMp3
    )
    const dMp3 = durationOf(outMp3)
    check(`duration ≈ 2.5s (got ${dMp3.toFixed(2)}s)`, Math.abs(dMp3 - 2.5) < 0.15)

    console.log('separate stems export')
    const stems = await exportSeparate(
      [
        { path: a, name: '01-01 Voice 1' },
        { path: b, name: '01-02 Voice 2 / with: bad*chars?' }
      ],
      'mp3',
      join(tmp, 'stems')
    )
    check('two stems written', stems.length === 2, stems)
    check(
      'unsafe filename sanitized',
      stems[1].endsWith('01-02 Voice 2 _ with_ bad_chars_.mp3'),
      stems[1]
    )
    check(`stem duration ≈ 1.0s`, Math.abs(durationOf(stems[0]) - 1.0) < 0.1)

    console.log('error path: missing file')
    let threw = false
    try {
      await stitchAndExport([{ path: join(tmp, 'nope.wav'), gapAfterMs: 0 }], 'wav', join(tmp, 'x.wav'))
    } catch (err) {
      threw = /missing/i.test(String(err))
    }
    check('missing input raises a clear error', threw)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall ffmpeg export checks passed')
}

void main()
