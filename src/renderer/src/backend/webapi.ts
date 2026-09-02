// Browser implementation of the FreditorApi (used when running as a web app).
import type { FreditorApi } from '../../../shared/api'
import type { AppSettingsView, GenerateRequest, Project } from '../../../shared/types'
import {
  getSubscriptionWith,
  listVoicesWith,
  textToSpeechWith,
  validateKeyWith
} from '../../../shared/elevenlabs'
import { idbDelete, idbGet, idbKeys, idbPut } from './idb'
import { decodeAudio, encode, stitchBuffers } from './audio'

const KEY_STORAGE = 'freditor.apiKey'

function getKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? ''
}

function requireKey(): string {
  const key = getKey()
  if (!key) throw new Error('No ElevenLabs API key configured. Add one in Settings.')
  return key
}

function settingsView(): AppSettingsView {
  const key = getKey()
  return {
    hasApiKey: !!key,
    apiKeyHint: key.length > 8 ? `${key.slice(0, 5)}…${key.slice(-4)}` : key ? '•••' : null,
    keyStorageInsecure: true // localStorage — surfaced in the settings UI
  }
}

/** Open a file picker and resolve with the chosen files (null if cancelled). */
function pickFiles(accept: string, multiple = false): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(input.files && input.files.length > 0 ? [...input.files] : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function download(bytes: ArrayBuffer | Blob, fileName: string): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function safeName(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export'
}

async function readSource(kind: 'cache' | 'abs', file: string): Promise<ArrayBuffer> {
  return idbGet(kind === 'cache' ? `cache:${file}` : file)
}

export function createWebApi(): FreditorApi {
  return {
    settings: {
      get: async () => settingsView(),
      setApiKey: async (key: string) => {
        localStorage.setItem(KEY_STORAGE, key.trim())
        return settingsView()
      },
      clearApiKey: async () => {
        localStorage.removeItem(KEY_STORAGE)
        return settingsView()
      }
    },

    el: {
      validateKey: (key?: string) => validateKeyWith(key?.trim() || getKey()),
      listVoices: () => listVoicesWith(requireKey()),
      getSubscription: () => getSubscriptionWith(requireKey()),
      generate: async (req: GenerateRequest) => {
        const raw = await textToSpeechWith(requireKey(), req)
        const fileName = `${req.lineId}-${req.hash.slice(0, 10)}.mp3`
        await idbPut(`cache:${fileName}`, raw.audio)
        return { audioFile: fileName, requestId: raw.requestId, characterCost: raw.characterCost }
      }
    },

    project: {
      new: async () => {},
      openDialog: async () => {
        const files = await pickFiles('.freditor,application/json')
        if (!files) return null
        const text = await files[0].text()
        const project = JSON.parse(text) as Project
        if (!project || project.version !== 1 || !Array.isArray(project.sections)) {
          throw new Error('Not a valid freditor project file.')
        }
        return { project, path: files[0].name }
      },
      openPath: async () => {
        throw new Error('Not available in the web version.')
      },
      save: async (project: Project) => {
        const fileName = `${safeName(project.name || 'untitled')}.freditor`
        download(
          new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
          fileName
        )
        return { path: fileName }
      },
      getRecent: async () => [],
      pruneCache: async (referenced: string[]) => {
        const keep = new Set(referenced.map((f) => `cache:${f}`))
        const keys = await idbKeys()
        for (const key of keys) {
          if (typeof key === 'string' && key.startsWith('cache:') && !keep.has(key)) {
            await idbDelete(key)
          }
        }
      }
    },

    file: {
      importScriptDialog: async () => {
        const files = await pickFiles('.txt,.md,.docx')
        if (!files) return null
        const file = files[0]
        let text: string
        if (file.name.toLowerCase().endsWith('.docx')) {
          const mammoth = await import('mammoth/mammoth.browser')
          const out = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
          text = out.value
        } else {
          text = await file.text()
        }
        return { text, fileName: file.name }
      },
      pickClips: async () => {
        const files = await pickFiles('audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac', true)
        if (!files) return null
        const out: { path: string; name: string }[] = []
        for (const file of files) {
          const key = `clip:${crypto.randomUUID()}:${file.name}`
          await idbPut(key, await file.arrayBuffer())
          out.push({ path: key, name: file.name })
        }
        return out
      },
      readAudio: (kind, file) => readSource(kind, file)
    },

    export: {
      stitch: async (req) => {
        const parts: { buffer: AudioBuffer; gapAfterMs: number }[] = []
        for (const entry of req.entries) {
          const bytes = await readSource(entry.kind, entry.file)
          parts.push({ buffer: await decodeAudio(bytes), gapAfterMs: entry.gapAfterMs })
        }
        const [left, right] = stitchBuffers(parts)
        const encoded = await encode(left, right, req.format)
        const fileName = `${safeName(req.suggestedName)}.${req.format}`
        download(encoded, fileName)
        return { path: `${fileName} (downloaded)` }
      },
      separate: async (req) => {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        const names: string[] = []
        for (const f of req.files) {
          const bytes = await readSource(f.kind, f.file)
          const name = `${safeName(f.name)}.${req.format}`
          if (req.format === 'mp3' && f.kind === 'cache') {
            // Generated audio is already mp3 — pass it through untouched
            zip.file(name, bytes)
          } else {
            const buffer = await decodeAudio(bytes)
            const mono = buffer.getChannelData(0)
            const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : mono
            zip.file(name, await encode(mono, right, req.format))
          }
          names.push(name)
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        const zipName = 'freditor-export.zip'
        download(blob, zipName)
        return { dir: `${zipName} (downloaded)`, files: names }
      }
    },

    shell: {
      showItemInFolder: async () => {}
    }
  }
}
