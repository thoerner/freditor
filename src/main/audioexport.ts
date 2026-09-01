import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

export interface ResolvedEntry {
  path: string
  gapAfterMs: number
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath = (require('ffmpeg-static') as string).replace('app.asar', 'app.asar.unpacked')

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 64 * 1024 * 1024
    })
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error(`ffmpeg failed: ${e.stderr?.trim() || e.message || 'unknown error'}`)
  }
}

/** Escape a path for the ffmpeg concat demuxer list file. */
function concatEscape(p: string): string {
  return `file '${p.replace(/'/g, "'\\''")}'`
}

async function encodeFinal(
  concatList: string,
  outPath: string,
  format: 'wav' | 'mp3'
): Promise<void> {
  const codecArgs =
    format === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '192k']
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, ...codecArgs, outPath])
}

/**
 * Stitch a sequence of audio files (with silence gaps between them) into a
 * single WAV or MP3. All inputs are first normalized to 44.1kHz stereo PCM so
 * mixed formats (mp3 generations, arbitrary user clips) concatenate cleanly.
 */
export async function stitchAndExport(
  entries: ResolvedEntry[],
  format: 'wav' | 'mp3',
  outPath: string
): Promise<void> {
  if (entries.length === 0) throw new Error('Nothing to export.')
  const tmp = mkdtempSync(join(tmpdir(), 'freditor-export-'))
  try {
    // 1) Normalize each unique source file to PCM wav
    const normalized = new Map<string, string>()
    let i = 0
    for (const entry of entries) {
      const src = entry.path
      if (!existsSync(src)) throw new Error(`Audio file missing: ${src}`)
      if (!normalized.has(src)) {
        const dst = join(tmp, `in-${i++}.wav`)
        await ffmpeg(['-i', src, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', dst])
        normalized.set(src, dst)
      }
    }

    // 2) Generate one silence file per distinct gap duration
    const silences = new Map<number, string>()
    for (const entry of entries) {
      const ms = Math.max(0, Math.round(entry.gapAfterMs))
      if (ms > 0 && !silences.has(ms)) {
        const dst = join(tmp, `silence-${ms}.wav`)
        await ffmpeg([
          '-f',
          'lavfi',
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-t',
          (ms / 1000).toFixed(3),
          '-c:a',
          'pcm_s16le',
          dst
        ])
        silences.set(ms, dst)
      }
    }

    // 3) Build concat list (no trailing gap after the last item)
    const lines: string[] = []
    entries.forEach((entry, idx) => {
      const src = entry.path
      lines.push(concatEscape(normalized.get(src)!))
      const ms = Math.max(0, Math.round(entry.gapAfterMs))
      if (ms > 0 && idx < entries.length - 1) {
        lines.push(concatEscape(silences.get(ms)!))
      }
    })
    const listPath = join(tmp, 'list.txt')
    writeFileSync(listPath, lines.join('\n'), 'utf-8')

    // 4) Encode final output
    await encodeFinal(listPath, outPath, format)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Export each file individually (per-line / per-section stems) into a directory. */
export async function exportSeparate(
  files: { path: string; name: string }[],
  format: 'wav' | 'mp3',
  outDir: string
): Promise<string[]> {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const written: string[] = []
  for (const f of files) {
    const src = f.path
    if (!existsSync(src)) throw new Error(`Audio file missing: ${src}`)
    const safeName = f.name.replace(/[/\\:*?"<>|]/g, '_')
    const outPath = join(outDir, `${safeName}.${format}`)
    const codecArgs =
      format === 'wav'
        ? ['-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le']
        : ['-c:a', 'libmp3lame', '-b:a', '192k']
    await ffmpeg(['-i', src, ...codecArgs, outPath])
    written.push(outPath)
  }
  return written
}
