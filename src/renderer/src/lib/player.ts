export interface AudioSourceRef {
  kind: 'cache' | 'abs'
  file: string
}

export interface PlayEntry {
  itemId: string
  source: AudioSourceRef
  gapAfterMs: number
}

function keyOf(src: AudioSourceRef): string {
  return `${src.kind}:${src.file}`
}

/**
 * Sequential playback engine. Decodes audio via IPC + Web Audio and plays a
 * list of entries with silence gaps in between.
 */
class Player {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private currentNode: AudioBufferSourceNode | null = null
  private token = 0

  /** Called whenever the currently playing item changes (null = stopped). */
  onItemChange: ((itemId: string | null) => void) | null = null

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  async decode(src: AudioSourceRef): Promise<AudioBuffer> {
    const key = keyOf(src)
    const cached = this.buffers.get(key)
    if (cached) return cached
    const bytes = await window.api.file.readAudio(src.kind, src.file)
    const buffer = await this.getCtx().decodeAudioData(bytes)
    this.buffers.set(key, buffer)
    return buffer
  }

  async getDuration(src: AudioSourceRef): Promise<number> {
    return (await this.decode(src)).duration
  }

  /** Drop a cached buffer (e.g. after a line is regenerated). */
  invalidate(src: AudioSourceRef): void {
    this.buffers.delete(keyOf(src))
  }

  stop(): void {
    this.token++
    if (this.currentNode) {
      try {
        this.currentNode.stop()
      } catch {
        /* already stopped */
      }
      this.currentNode = null
    }
    this.onItemChange?.(null)
  }

  /** Play entries in order with gaps. Resolves when done or stopped. */
  async playSequence(entries: PlayEntry[]): Promise<void> {
    this.stop()
    const myToken = ++this.token
    const ctx = this.getCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    for (const entry of entries) {
      if (this.token !== myToken) return
      let buffer: AudioBuffer
      try {
        buffer = await this.decode(entry.source)
      } catch (err) {
        console.error(`Failed to decode audio for item ${entry.itemId}:`, err)
        continue // skip unplayable entries rather than aborting the whole sequence
      }
      if (this.token !== myToken) return

      this.onItemChange?.(entry.itemId)
      await new Promise<void>((resolve) => {
        const node = ctx.createBufferSource()
        node.buffer = buffer
        node.connect(ctx.destination)
        node.onended = () => resolve()
        this.currentNode = node
        node.start()
      })
      if (this.token !== myToken) return

      if (entry.gapAfterMs > 0) {
        await new Promise((r) => setTimeout(r, entry.gapAfterMs))
      }
    }
    if (this.token === myToken) {
      this.currentNode = null
      this.onItemChange?.(null)
    }
  }
}

export const player = new Player()

// ---- Voice preview playback (simple HTMLAudio for remote preview URLs) ----

let previewAudio: HTMLAudioElement | null = null
let previewUrl: string | null = null

/** Toggle playback of a voice preview URL. Returns true if now playing. */
export function togglePreview(url: string, onEnded?: () => void): boolean {
  if (previewAudio && previewUrl === url && !previewAudio.paused) {
    previewAudio.pause()
    previewAudio = null
    previewUrl = null
    return false
  }
  previewAudio?.pause()
  previewAudio = new Audio(url)
  previewUrl = url
  previewAudio.onended = () => {
    previewAudio = null
    previewUrl = null
    onEnded?.()
  }
  void previewAudio.play()
  return true
}

export function stopPreview(): void {
  previewAudio?.pause()
  previewAudio = null
  previewUrl = null
}
