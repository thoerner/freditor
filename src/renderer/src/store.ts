import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  AppSettingsView,
  ClipItem,
  ElevenVoice,
  GenerateRequest,
  LineItem,
  Project,
  Section,
  SubscriptionInfo
} from '../../shared/types'
import { modelSupportsStitching } from '../../shared/types'
import {
  allLines,
  effectiveSettings,
  effectiveVoiceId,
  flattenItems,
  gapAfter,
  isLine,
  lineHash,
  lineStatus,
  newClip,
  newLine,
  newProject,
  newSpeaker,
  ttsText,
  uid
} from './lib/model'
import type { ParseResult } from './lib/parser'
import { player, stopPreview, type PlayEntry } from './lib/player'
import { ipcErrorMessage } from './lib/errors'
import { api, isWeb } from './backend'

export type ModalKind = 'settings' | 'import' | 'export' | null

export interface QueueState {
  running: boolean
  done: number
  total: number
  currentLineId: string | null
  cancelRequested: boolean
}

export interface ImportMappingRow {
  parsedName: string
  displayName: string
  voiceId: string | null
  /** parsedName of another speaker to merge into, or null */
  mergeInto: string | null
}

interface StoreState {
  project: Project
  projectPath: string | null
  dirty: boolean

  settingsView: AppSettingsView | null
  voices: ElevenVoice[]
  voicesStatus: 'idle' | 'loading' | 'ready' | 'error'
  voicesError: string | null
  subscription: SubscriptionInfo | null
  subscriptionError: string | null

  selectedSectionId: string
  modal: ModalKind
  toast: string | null

  queue: QueueState
  lineErrors: Record<string, string>
  playingItemId: string | null

  // ---- app lifecycle ----
  init: () => Promise<void>
  showToast: (msg: string) => void
  setModal: (m: ModalKind) => void

  // ---- settings / elevenlabs account ----
  saveApiKey: (key: string) => Promise<{ ok: boolean; error?: string }>
  clearApiKey: () => Promise<void>
  refreshVoices: () => Promise<void>
  refreshSubscription: () => Promise<void>

  // ---- project lifecycle ----
  newProjectAction: () => Promise<void>
  openProject: () => Promise<void>
  openRecent: (path: string) => Promise<void>
  saveProject: (saveAs?: boolean) => Promise<void>
  setProjectName: (name: string) => void
  setModelId: (id: string) => void
  setDefaultGap: (ms: number) => void
  setDefaultVoiceSettings: (s: Project['settings']['defaultVoiceSettings']) => void

  // ---- sections ----
  selectSection: (id: string) => void
  addSection: () => void
  renameSection: (id: string, name: string) => void
  deleteSection: (id: string) => void
  moveSection: (id: string, dir: -1 | 1) => void

  // ---- speakers ----
  addSpeaker: (name: string) => void
  renameSpeaker: (id: string, name: string) => void
  setSpeakerVoice: (id: string, voiceId: string | null) => void
  deleteSpeaker: (id: string) => void

  // ---- items ----
  addLine: (sectionId: string, index?: number, speakerId?: string | null) => void
  updateLineText: (lineId: string, text: string) => void
  setLineSpeaker: (lineId: string, speakerId: string | null) => void
  setLineOverrides: (
    lineId: string,
    overrides: Pick<LineItem, 'voiceOverride' | 'settingsOverride'>
  ) => void
  setItemGap: (itemId: string, gapMs: number | null) => void
  deleteItem: (itemId: string) => void
  moveItem: (itemId: string, dir: -1 | 1) => void
  insertClips: (sectionId: string, index?: number) => Promise<void>

  // ---- import ----
  applyImport: (result: ParseResult, rows: ImportMappingRow[], mode: 'replace' | 'append') => void

  // ---- generation ----
  generateLines: (lineIds: string[]) => Promise<void>
  cancelGeneration: () => void

  // ---- playback ----
  playItem: (itemId: string) => Promise<void>
  playFrom: (itemId: string | null, sectionId?: string) => Promise<void>
  stopPlayback: () => void
}

function findLine(project: Project, lineId: string): LineItem | null {
  for (const section of project.sections) {
    for (const item of section.items) {
      if (item.id === lineId && item.type === 'line') return item
    }
  }
  return null
}

function findItemLocation(
  project: Project,
  itemId: string
): { section: Section; index: number } | null {
  for (const section of project.sections) {
    const index = section.items.findIndex((i) => i.id === itemId)
    if (index >= 0) return { section, index }
  }
  return null
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<StoreState>()(
  immer((set, get) => ({
    project: newProject(),
    projectPath: null,
    dirty: false,

    settingsView: null,
    voices: [],
    voicesStatus: 'idle',
    voicesError: null,
    subscription: null,
    subscriptionError: null,

    selectedSectionId: '',
    modal: null,
    toast: null,

    queue: { running: false, done: 0, total: 0, currentLineId: null, cancelRequested: false },
    lineErrors: {},
    playingItemId: null,

    init: async () => {
      player.onItemChange = (itemId) => set({ playingItemId: itemId })
      // Web build: restore the autosaved project and keep autosaving on change
      if (isWeb) {
        try {
          const saved = localStorage.getItem('freditor.autosave')
          if (saved) {
            const project = JSON.parse(saved) as Project
            if (project.version === 1) set({ project })
          }
        } catch (err) {
          console.error('Failed to restore autosaved project:', err)
        }
        let lastProject = get().project
        let timer: ReturnType<typeof setTimeout> | null = null
        useStore.subscribe((s) => {
          if (s.project !== lastProject) {
            lastProject = s.project
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              try {
                localStorage.setItem('freditor.autosave', JSON.stringify(lastProject))
              } catch (err) {
                console.error('Autosave failed:', err)
              }
            }, 800)
          }
        })
      }
      const project = get().project
      set({ selectedSectionId: project.sections[0]?.id ?? '' })
      await api.project.new(project.id)
      try {
        const view = await api.settings.get()
        set({ settingsView: view })
        if (view.hasApiKey) {
          void get().refreshVoices()
          void get().refreshSubscription()
        }
      } catch (err) {
        console.error('init failed:', err)
      }
    },

    showToast: (msg) => {
      set({ toast: msg })
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => set({ toast: null }), 4000)
    },

    setModal: (m) => {
      stopPreview()
      set({ modal: m })
    },

    // ---- settings / account ----

    saveApiKey: async (key) => {
      const res = await api.el.validateKey(key)
      if (!res.ok) return res
      const view = await api.settings.setApiKey(key)
      set({ settingsView: view })
      void get().refreshVoices()
      void get().refreshSubscription()
      return { ok: true }
    },

    clearApiKey: async () => {
      const view = await api.settings.clearApiKey()
      set({ settingsView: view, voices: [], voicesStatus: 'idle', subscription: null })
    },

    refreshVoices: async () => {
      set({ voicesStatus: 'loading', voicesError: null })
      try {
        const voices = await api.el.listVoices()
        set({ voices, voicesStatus: 'ready' })
      } catch (err) {
        set({ voicesStatus: 'error', voicesError: ipcErrorMessage(err) })
      }
    },

    refreshSubscription: async () => {
      try {
        const subscription = await api.el.getSubscription()
        set({ subscription, subscriptionError: null })
      } catch (err) {
        set({ subscriptionError: ipcErrorMessage(err) })
      }
    },

    // ---- project lifecycle ----

    newProjectAction: async () => {
      get().stopPlayback()
      const project = newProject()
      await api.project.new(project.id)
      set({
        project,
        projectPath: null,
        dirty: false,
        selectedSectionId: project.sections[0].id,
        lineErrors: {}
      })
    },

    openProject: async () => {
      try {
        const res = await api.project.openDialog()
        if (!res) return
        get().stopPlayback()
        set({
          project: res.project,
          projectPath: res.path,
          dirty: false,
          selectedSectionId: res.project.sections[0]?.id ?? '',
          lineErrors: {}
        })
      } catch (err) {
        get().showToast(`Open failed: ${ipcErrorMessage(err)}`)
      }
    },

    openRecent: async (path) => {
      try {
        const res = await api.project.openPath(path)
        get().stopPlayback()
        set({
          project: res.project,
          projectPath: res.path,
          dirty: false,
          selectedSectionId: res.project.sections[0]?.id ?? '',
          lineErrors: {}
        })
      } catch (err) {
        get().showToast(`Open failed: ${ipcErrorMessage(err)}`)
      }
    },

    saveProject: async (saveAs = false) => {
      try {
        const res = await api.project.save(get().project, saveAs)
        if (!res) return
        set({ projectPath: res.path, dirty: false })
        // Clean up cache files no longer referenced by any line
        const referenced = allLines(get().project)
          .map((l) => l.generation?.audioFile)
          .filter((f): f is string => !!f)
        void api.project.pruneCache(referenced)
        get().showToast(`Saved to ${res.path}`)
      } catch (err) {
        get().showToast(`Save failed: ${ipcErrorMessage(err)}`)
      }
    },

    setProjectName: (name) =>
      set((s) => {
        s.project.name = name
        s.dirty = true
      }),

    setModelId: (id) =>
      set((s) => {
        s.project.settings.modelId = id
        s.dirty = true
      }),

    setDefaultGap: (ms) =>
      set((s) => {
        s.project.settings.gapMs = Math.max(0, ms)
        s.dirty = true
      }),

    setDefaultVoiceSettings: (vs) =>
      set((s) => {
        s.project.settings.defaultVoiceSettings = vs
        s.dirty = true
      }),

    // ---- sections ----

    selectSection: (id) => set({ selectedSectionId: id }),

    addSection: () =>
      set((s) => {
        const section: Section = {
          id: uid(),
          name: `Section ${s.project.sections.length + 1}`,
          items: []
        }
        s.project.sections.push(section)
        s.selectedSectionId = section.id
        s.dirty = true
      }),

    renameSection: (id, name) =>
      set((s) => {
        const sec = s.project.sections.find((x) => x.id === id)
        if (sec) {
          sec.name = name
          s.dirty = true
        }
      }),

    deleteSection: (id) =>
      set((s) => {
        const idx = s.project.sections.findIndex((x) => x.id === id)
        if (idx < 0) return
        s.project.sections.splice(idx, 1)
        if (s.project.sections.length === 0) {
          s.project.sections.push({ id: uid(), name: 'Section 1', items: [] })
        }
        if (s.selectedSectionId === id) {
          s.selectedSectionId = s.project.sections[Math.max(0, idx - 1)].id
        }
        s.dirty = true
      }),

    moveSection: (id, dir) =>
      set((s) => {
        const idx = s.project.sections.findIndex((x) => x.id === id)
        const to = idx + dir
        if (idx < 0 || to < 0 || to >= s.project.sections.length) return
        const [sec] = s.project.sections.splice(idx, 1)
        s.project.sections.splice(to, 0, sec)
        s.dirty = true
      }),

    // ---- speakers ----

    addSpeaker: (name) =>
      set((s) => {
        s.project.speakers.push(newSpeaker(name, s.project.speakers.length))
        s.dirty = true
      }),

    renameSpeaker: (id, name) =>
      set((s) => {
        const sp = s.project.speakers.find((x) => x.id === id)
        if (sp) {
          sp.name = name
          s.dirty = true
        }
      }),

    setSpeakerVoice: (id, voiceId) =>
      set((s) => {
        const sp = s.project.speakers.find((x) => x.id === id)
        if (sp) {
          sp.voiceId = voiceId
          s.dirty = true
        }
      }),

    deleteSpeaker: (id) =>
      set((s) => {
        s.project.speakers = s.project.speakers.filter((x) => x.id !== id)
        for (const section of s.project.sections) {
          for (const item of section.items) {
            if (item.type === 'line' && item.speakerId === id) item.speakerId = null
          }
        }
        s.dirty = true
      }),

    // ---- items ----

    addLine: (sectionId, index, speakerId) =>
      set((s) => {
        const sec = s.project.sections.find((x) => x.id === sectionId)
        if (!sec) return
        // Default the speaker to the previous line's speaker for fast dialogue entry
        const at = index ?? sec.items.length
        let inheritedSpeaker = speakerId
        if (inheritedSpeaker === undefined) {
          for (let i = at - 1; i >= 0; i--) {
            const prev = sec.items[i]
            if (prev.type === 'line') {
              inheritedSpeaker = prev.speakerId
              break
            }
          }
        }
        sec.items.splice(at, 0, newLine(inheritedSpeaker ?? s.project.speakers[0]?.id ?? null))
        s.dirty = true
      }),

    updateLineText: (lineId, text) =>
      set((s) => {
        const line = findLine(s.project, lineId)
        if (line) {
          line.text = text
          delete s.lineErrors[lineId]
          s.dirty = true
        }
      }),

    setLineSpeaker: (lineId, speakerId) =>
      set((s) => {
        const line = findLine(s.project, lineId)
        if (line) {
          line.speakerId = speakerId
          s.dirty = true
        }
      }),

    setLineOverrides: (lineId, overrides) =>
      set((s) => {
        const line = findLine(s.project, lineId)
        if (line) {
          line.voiceOverride = overrides.voiceOverride
          line.settingsOverride = overrides.settingsOverride
          s.dirty = true
        }
      }),

    setItemGap: (itemId, gapMs) =>
      set((s) => {
        const loc = findItemLocation(s.project, itemId)
        if (loc) {
          loc.section.items[loc.index].gapAfterMs = gapMs
          s.dirty = true
        }
      }),

    deleteItem: (itemId) =>
      set((s) => {
        const loc = findItemLocation(s.project, itemId)
        if (loc) {
          loc.section.items.splice(loc.index, 1)
          delete s.lineErrors[itemId]
          s.dirty = true
        }
      }),

    moveItem: (itemId, dir) =>
      set((s) => {
        const loc = findItemLocation(s.project, itemId)
        if (!loc) return
        const to = loc.index + dir
        if (to < 0 || to >= loc.section.items.length) return
        const [item] = loc.section.items.splice(loc.index, 1)
        loc.section.items.splice(to, 0, item)
        s.dirty = true
      }),

    insertClips: async (sectionId, index) => {
      const picked = await api.file.pickClips()
      if (!picked) return
      const clips: ClipItem[] = picked.map((p) => newClip(p.path, p.name))
      set((s) => {
        const sec = s.project.sections.find((x) => x.id === sectionId)
        if (!sec) return
        sec.items.splice(index ?? sec.items.length, 0, ...clips)
        s.dirty = true
      })
      // Probe durations in the background
      for (const clip of clips) {
        try {
          const duration = await player.getDuration({ kind: 'abs', file: clip.path })
          set((s) => {
            const loc = findItemLocation(s.project, clip.id)
            if (loc) (loc.section.items[loc.index] as ClipItem).durationSec = duration
          })
        } catch (err) {
          get().showToast(`Could not decode ${clip.name}: ${ipcErrorMessage(err)}`)
        }
      }
    },

    // ---- import ----

    applyImport: (result, rows, mode) => {
      set((s) => {
        const project = s.project
        // Resolve merge targets (one level: merging into a row that itself merges is followed)
        const rowByName = new Map(rows.map((r) => [r.parsedName, r]))
        const finalRowOf = (r: ImportMappingRow): ImportMappingRow => {
          const seen = new Set<string>()
          let cur = r
          while (cur.mergeInto && rowByName.has(cur.mergeInto) && !seen.has(cur.mergeInto)) {
            seen.add(cur.parsedName)
            cur = rowByName.get(cur.mergeInto)!
          }
          return cur
        }

        if (mode === 'replace') {
          project.speakers = []
          project.sections = []
        }

        // Create (or reuse) one speaker per final mapping row
        const speakerIdByParsedName = new Map<string, string>()
        for (const row of rows) {
          const final = finalRowOf(row)
          if (speakerIdByParsedName.has(final.parsedName)) {
            speakerIdByParsedName.set(row.parsedName, speakerIdByParsedName.get(final.parsedName)!)
            continue
          }
          const existing = project.speakers.find(
            (sp) => sp.name.trim().toLowerCase() === final.displayName.trim().toLowerCase()
          )
          let speakerId: string
          if (existing) {
            speakerId = existing.id
            if (final.voiceId && !existing.voiceId) existing.voiceId = final.voiceId
          } else {
            const sp = newSpeaker(
              final.displayName.trim() || final.parsedName,
              project.speakers.length,
              final.voiceId
            )
            project.speakers.push(sp)
            speakerId = sp.id
          }
          speakerIdByParsedName.set(final.parsedName, speakerId)
          speakerIdByParsedName.set(row.parsedName, speakerId)
        }

        for (const parsedSection of result.sections) {
          const section: Section = { id: uid(), name: parsedSection.name, items: [] }
          for (const cue of parsedSection.cues) {
            const speakerId = speakerIdByParsedName.get(cue.speaker) ?? null
            section.items.push(newLine(speakerId, cue.text))
          }
          project.sections.push(section)
        }
        if (project.sections.length === 0) {
          project.sections.push({ id: uid(), name: 'Section 1', items: [] })
        }
        s.selectedSectionId = project.sections[0].id
        s.dirty = true
        s.modal = null
      })
    },

    // ---- generation ----

    generateLines: async (lineIds) => {
      const state = get()
      if (state.queue.running) return
      if (!state.settingsView?.hasApiKey) {
        state.showToast('Add your ElevenLabs API key in Settings before generating.')
        set({ modal: 'settings' })
        return
      }

      const idSet = new Set(lineIds)
      // Snapshot order from the flattened episode so stitching context is right
      const orderedIds = flattenItems(state.project)
        .map((f) => f.item)
        .filter(isLine)
        .filter((l) => idSet.has(l.id))
        .map((l) => l.id)

      set((s) => {
        s.queue = {
          running: true,
          done: 0,
          total: orderedIds.length,
          currentLineId: null,
          cancelRequested: false
        }
      })

      // Request ids generated during this run, per voice (for request stitching)
      const runRequestIds = new Map<string, string[]>()
      let aborted = false

      for (const lineId of orderedIds) {
        if (get().queue.cancelRequested) break
        const project = get().project
        const line = findLine(project, lineId)
        if (!line) continue

        const text = ttsText(line)
        const voiceId = effectiveVoiceId(project, line)
        if (!text) {
          set((s) => {
            s.lineErrors[lineId] = 'Line is empty.'
            s.queue.done++
          })
          continue
        }
        if (!voiceId) {
          set((s) => {
            s.lineErrors[lineId] = 'No voice assigned to this line’s speaker.'
            s.queue.done++
          })
          continue
        }

        set((s) => {
          s.queue.currentLineId = lineId
          delete s.lineErrors[lineId]
        })

        // ---- stitching context ----
        const modelId = project.settings.modelId
        let previousText: string | null = null
        let nextText: string | null = null
        let previousRequestIds: string[] = []
        if (modelSupportsStitching(modelId)) {
          const flatLines = flattenItems(project)
            .map((f) => f.item)
            .filter(isLine)
          const idx = flatLines.findIndex((l) => l.id === lineId)
          for (let i = idx - 1; i >= 0; i--) {
            const other = flatLines[i]
            if (effectiveVoiceId(project, other) === voiceId && ttsText(other)) {
              previousText = ttsText(other)
              break
            }
          }
          for (let i = idx + 1; i < flatLines.length; i++) {
            const other = flatLines[i]
            if (effectiveVoiceId(project, other) === voiceId && ttsText(other)) {
              nextText = ttsText(other)
              break
            }
          }
          // Prefer request ids from this run (most recent, same voice)
          previousRequestIds = (runRequestIds.get(voiceId) ?? []).slice(-3)
        }

        const hash = lineHash(project, line)
        const req: GenerateRequest = {
          lineId,
          text,
          voiceId,
          modelId,
          voiceSettings: effectiveSettings(project, line),
          previousText,
          nextText,
          previousRequestIds,
          hash
        }

        try {
          const result = await api.el.generate(req)
          if (result.requestId) {
            const list = runRequestIds.get(voiceId) ?? []
            list.push(result.requestId)
            runRequestIds.set(voiceId, list)
          }
          // Invalidate any cached decode of a previous file with the same name
          player.invalidate({ kind: 'cache', file: result.audioFile })
          let durationSec: number | undefined
          try {
            durationSec = await player.getDuration({ kind: 'cache', file: result.audioFile })
          } catch {
            /* duration probing is best-effort */
          }
          set((s) => {
            const l = findLine(s.project, lineId)
            if (l) {
              l.generation = {
                audioFile: result.audioFile,
                hash,
                requestId: result.requestId,
                characterCost: result.characterCost,
                durationSec,
                generatedAt: Date.now()
              }
            }
            s.queue.done++
            s.dirty = true
          })
        } catch (err) {
          const msg = ipcErrorMessage(err)
          set((s) => {
            s.lineErrors[lineId] = msg
            s.queue.done++
          })
          // Abort the whole batch on errors that will hit every remaining line
          if (/api key|quota/i.test(msg)) {
            aborted = true
            get().showToast(`Generation stopped: ${msg}`)
            break
          }
        }
      }

      set((s) => {
        s.queue.running = false
        s.queue.currentLineId = null
      })
      if (!aborted && get().queue.cancelRequested) get().showToast('Generation cancelled.')
      void get().refreshSubscription()
    },

    cancelGeneration: () =>
      set((s) => {
        if (s.queue.running) s.queue.cancelRequested = true
      }),

    // ---- playback ----

    playItem: async (itemId) => {
      const { project } = get()
      const loc = findItemLocation(project, itemId)
      if (!loc) return
      const item = loc.section.items[loc.index]
      const entries = entriesFor(project, [item])
      if (entries.length === 0) {
        get().showToast('No audio for this item yet — generate it first.')
        return
      }
      await player.playSequence(entries)
    },

    playFrom: async (itemId, sectionId) => {
      const { project } = get()
      let flat = flattenItems(project)
      if (sectionId) flat = flat.filter((f) => f.sectionId === sectionId)
      let items = flat.map((f) => f.item)
      if (itemId) {
        const idx = items.findIndex((i) => i.id === itemId)
        if (idx >= 0) items = items.slice(idx)
      }
      const entries = entriesFor(project, items)
      if (entries.length === 0) {
        get().showToast('Nothing playable yet — generate some lines first.')
        return
      }
      await player.playSequence(entries)
    },

    stopPlayback: () => {
      player.stop()
      set({ playingItemId: null })
    }
  }))
)

/** Build playable entries for a list of items, skipping items with no audio. */
function entriesFor(project: Project, items: Project['sections'][0]['items']): PlayEntry[] {
  const entries: PlayEntry[] = []
  for (const item of items) {
    if (item.type === 'clip') {
      entries.push({
        itemId: item.id,
        source: { kind: 'abs', file: item.path },
        gapAfterMs: gapAfter(project, item)
      })
    } else if (item.generation) {
      // Play cached audio even if stale — better than silence
      entries.push({
        itemId: item.id,
        source: { kind: 'cache', file: item.generation.audioFile },
        gapAfterMs: gapAfter(project, item)
      })
    }
  }
  return entries
}

if (import.meta.env.DEV) {
  // Exposed for debugging and scripted smoke tests only (dev builds)
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
  void import('./lib/parser').then((m) => {
    ;(window as unknown as { __parseScript: typeof m.parseScript }).__parseScript = m.parseScript
  })
}

/** Convenience selectors used across components */
export function useLineStatusMap(): Map<string, ReturnType<typeof lineStatus>> {
  const project = useStore((s) => s.project)
  const map = new Map<string, ReturnType<typeof lineStatus>>()
  for (const line of allLines(project)) {
    map.set(line.id, lineStatus(project, line))
  }
  return map
}
