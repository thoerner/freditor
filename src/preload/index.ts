import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
} from '../shared/types'
import type { FreditorApi } from '../shared/api'

const api: FreditorApi = {
  settings: {
    get: (): Promise<AppSettingsView> => ipcRenderer.invoke('settings:get'),
    setApiKey: (key: string): Promise<AppSettingsView> =>
      ipcRenderer.invoke('settings:setApiKey', key),
    clearApiKey: (): Promise<AppSettingsView> => ipcRenderer.invoke('settings:clearApiKey')
  },
  el: {
    validateKey: (key?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('el:validateKey', key),
    listVoices: (): Promise<ElevenVoice[]> => ipcRenderer.invoke('el:listVoices'),
    getSubscription: (): Promise<SubscriptionInfo> => ipcRenderer.invoke('el:getSubscription'),
    generate: (req: GenerateRequest): Promise<GenerateResult> =>
      ipcRenderer.invoke('el:generate', req)
  },
  project: {
    new: (projectId: string): Promise<void> => ipcRenderer.invoke('project:new', projectId),
    openDialog: (): Promise<{ project: Project; path: string } | null> =>
      ipcRenderer.invoke('project:openDialog'),
    openPath: (path: string): Promise<{ project: Project; path: string }> =>
      ipcRenderer.invoke('project:openPath', path),
    save: (project: Project, saveAs: boolean): Promise<{ path: string } | null> =>
      ipcRenderer.invoke('project:save', project, saveAs),
    getRecent: (): Promise<string[]> => ipcRenderer.invoke('project:getRecent'),
    pruneCache: (referenced: string[]): Promise<void> =>
      ipcRenderer.invoke('project:pruneCache', referenced)
  },
  file: {
    importScriptDialog: (): Promise<ParsedImport | null> =>
      ipcRenderer.invoke('file:importScriptDialog'),
    pickClips: (): Promise<{ path: string; name: string }[] | null> =>
      ipcRenderer.invoke('file:pickClips'),
    readAudio: (kind: 'cache' | 'abs', file: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('file:readAudio', kind, file)
  },
  export: {
    stitch: (req: ExportRequest): Promise<{ path: string } | null> =>
      ipcRenderer.invoke('export:stitch', req),
    separate: (req: ExportSeparateRequest): Promise<{ dir: string; files: string[] } | null> =>
      ipcRenderer.invoke('export:separate', req)
  },
  shell: {
    showItemInFolder: (path: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', path)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
