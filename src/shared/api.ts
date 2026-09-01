import type {
  AppSettingsView,
  ElevenVoice,
  ExportRequest,
  ExportSeparateRequest,
  GenerateRequest,
  GenerateResult,
  ParsedImport,
  Project,
  SubscriptionInfo
} from './types'

/** The IPC API exposed to the renderer as `window.api` */
export interface FreditorApi {
  settings: {
    get: () => Promise<AppSettingsView>
    setApiKey: (key: string) => Promise<AppSettingsView>
    clearApiKey: () => Promise<AppSettingsView>
  }
  el: {
    validateKey: (key?: string) => Promise<{ ok: boolean; error?: string }>
    listVoices: () => Promise<ElevenVoice[]>
    getSubscription: () => Promise<SubscriptionInfo>
    generate: (req: GenerateRequest) => Promise<GenerateResult>
  }
  project: {
    new: (projectId: string) => Promise<void>
    openDialog: () => Promise<{ project: Project; path: string } | null>
    openPath: (path: string) => Promise<{ project: Project; path: string }>
    save: (project: Project, saveAs: boolean) => Promise<{ path: string } | null>
    getRecent: () => Promise<string[]>
    pruneCache: (referenced: string[]) => Promise<void>
  }
  file: {
    importScriptDialog: () => Promise<ParsedImport | null>
    pickClips: () => Promise<{ path: string; name: string }[] | null>
    readAudio: (kind: 'cache' | 'abs', file: string) => Promise<ArrayBuffer>
  }
  export: {
    stitch: (req: ExportRequest) => Promise<{ path: string } | null>
    separate: (req: ExportSeparateRequest) => Promise<{ dir: string; files: string[] } | null>
  }
  shell: {
    showItemInFolder: (path: string) => Promise<void>
  }
}
