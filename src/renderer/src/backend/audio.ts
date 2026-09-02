// Client-side audio decode / stitch / encode for the web build.

export const SAMPLE_RATE = 44100

let decodeCtx: AudioContext | null = null

/** Decode arbitrary audio bytes to a 44.1kHz AudioBuffer. */
export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  if (!decodeCtx) decodeCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
  // decodeAudioData resamples to the context's sample rate
  return decodeCtx.decodeAudioData(bytes.slice(0))
}

/** Stitch decoded buffers with per-item gaps into stereo Float32 channel data. */
export function stitchBuffers(
  parts: { buffer: AudioBuffer; gapAfterMs: number }[]
): [Float32Array, Float32Array] {
  let total = 0
  parts.forEach((p, i) => {
    total += p.buffer.length
    if (i < parts.length - 1) total += Math.round((Math.max(0, p.gapAfterMs) / 1000) * SAMPLE_RATE)
  })
  const left = new Float32Array(total)
  const right = new Float32Array(total)
  let offset = 0
  parts.forEach((p, i) => {
    const l = p.buffer.getChannelData(0)
    const r = p.buffer.numberOfChannels > 1 ? p.buffer.getChannelData(1) : l
    left.set(l, offset)
    right.set(r, offset)
    offset += p.buffer.length
    if (i < parts.length - 1) {
      offset += Math.round((Math.max(0, p.gapAfterMs) / 1000) * SAMPLE_RATE)
    }
  })
  return [left, right]
}

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Encode stereo channel data as a 16-bit PCM WAV file. */
export function encodeWav(left: Float32Array, right: Float32Array): ArrayBuffer {
  const numFrames = left.length
  const dataSize = numFrames * 2 * 2 // stereo, 16-bit
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // stereo
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 4, true) // byte rate
  view.setUint16(32, 4, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  const l16 = floatTo16(left)
  const r16 = floatTo16(right)
  let off = 44
  for (let i = 0; i < numFrames; i++) {
    view.setInt16(off, l16[i], true)
    view.setInt16(off + 2, r16[i], true)
    off += 4
  }
  return buf
}

/** Encode stereo channel data as 192kbps MP3 (lamejs, loaded on demand). */
export async function encodeMp3(left: Float32Array, right: Float32Array): Promise<ArrayBuffer> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const encoder = new Mp3Encoder(2, SAMPLE_RATE, 192)
  const l16 = floatTo16(left)
  const r16 = floatTo16(right)
  const chunks: Uint8Array[] = []
  const BLOCK = 1152
  for (let i = 0; i < l16.length; i += BLOCK) {
    const chunk = encoder.encodeBuffer(l16.subarray(i, i + BLOCK), r16.subarray(i, i + BLOCK))
    if (chunk.length > 0) chunks.push(new Uint8Array(chunk))
  }
  const flush = encoder.flush()
  if (flush.length > 0) chunks.push(new Uint8Array(flush))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out.buffer
}

export async function encode(
  left: Float32Array,
  right: Float32Array,
  format: 'wav' | 'mp3'
): Promise<ArrayBuffer> {
  return format === 'wav' ? encodeWav(left, right) : encodeMp3(left, right)
}
