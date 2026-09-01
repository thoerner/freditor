import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import type {
  ExportRequest,
  ExportSeparateRequest,
  GenerateRequest,
  GenerateResult,
  Project
} from '../shared/types'
import * as settings from './settings'
import * as el from './elevenlabs'
import * as projectio from './projectio'
import { stitchAndExport, exportSeparate } from './audioexport'

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export function registerIpcHandlers(): void {
  // ---- Settings / API key ----
  ipcMain.handle('settings:get', () => settings.getSettingsView())
  ipcMain.handle('settings:setApiKey', (_e, key: string) => {
    settings.setApiKey(key)
    return settings.getSettingsView()
  })
  ipcMain.handle('settings:clearApiKey', () => {
    settings.clearApiKey()
    return settings.getSettingsView()
  })

  // ---- ElevenLabs ----
  ipcMain.handle('el:validateKey', (_e, key?: string) => el.validateKey(key))
  ipcMain.handle('el:listVoices', () => el.listVoices())
  ipcMain.handle('el:getSubscription', () => el.getSubscription())
  ipcMain.handle('el:generate', async (_e, req: GenerateRequest): Promise<GenerateResult> => {
    const result = await el.textToSpeech(req)
    const fileName = `${req.lineId}-${req.hash.slice(0, 10)}.mp3`
    writeFileSync(projectio.resolveCacheFile(fileName), result.audio)
    return {
      audioFile: fileName,
      requestId: result.requestId,
      characterCost: result.characterCost
    }
  })

  // ---- Project lifecycle ----
  ipcMain.handle('project:new', (_e, projectId: string) => {
    projectio.startNewProject(projectId)
  })

  ipcMain.handle('project:openDialog', async () => {
    const win = focusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Open project',
      filters: [{ name: 'Freditor project', extensions: ['freditor'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    const project = projectio.openProjectFile(path)
    return { project, path }
  })

  ipcMain.handle('project:openPath', (_e, path: string) => {
    const project = projectio.openProjectFile(path)
    return { project, path }
  })

  ipcMain.handle('project:save', async (_e, project: Project, saveAs: boolean) => {
    let path = projectio.getProjectPath()
    if (!path || saveAs) {
      const win = focusedWindow()
      const res = await dialog.showSaveDialog(win!, {
        title: 'Save project',
        defaultPath: `${project.name || 'untitled'}.freditor`,
        filters: [{ name: 'Freditor project', extensions: ['freditor'] }]
      })
      if (res.canceled || !res.filePath) return null
      path = res.filePath.endsWith('.freditor') ? res.filePath : `${res.filePath}.freditor`
    }
    projectio.saveProjectFile(project, path)
    return { path }
  })

  ipcMain.handle('project:getRecent', () => settings.getRecentProjects())
  ipcMain.handle('project:pruneCache', (_e, referenced: string[]) =>
    projectio.pruneCache(referenced)
  )

  // ---- Files ----
  ipcMain.handle('file:importScriptDialog', async () => {
    const win = focusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import script',
      filters: [
        { name: 'Scripts', extensions: ['txt', 'md', 'docx'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    let text: string
    if (path.toLowerCase().endsWith('.docx')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth') as typeof import('mammoth')
      const out = await mammoth.extractRawText({ path })
      text = out.value
    } else {
      text = readFileSync(path, 'utf-8')
    }
    return { text, fileName: basename(path) }
  })

  ipcMain.handle('file:pickClips', async () => {
    const win = focusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Insert audio clip(s)',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths.map((p) => ({ path: p, name: basename(p) }))
  })

  /** Read audio bytes for renderer-side decoding/playback */
  ipcMain.handle('file:readAudio', (_e, kind: 'cache' | 'abs', file: string) => {
    const path = kind === 'cache' ? projectio.resolveCacheFile(file) : file
    const buf = readFileSync(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // ---- Export ----
  const resolvePath = (kind: 'cache' | 'abs', file: string): string =>
    kind === 'cache' ? projectio.resolveCacheFile(file) : file

  ipcMain.handle('export:stitch', async (_e, req: ExportRequest) => {
    const win = focusedWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export audio',
      defaultPath: `${req.suggestedName}.${req.format}`,
      filters: [{ name: req.format.toUpperCase(), extensions: [req.format] }]
    })
    if (res.canceled || !res.filePath) return null
    const outPath = res.filePath.endsWith(`.${req.format}`)
      ? res.filePath
      : `${res.filePath}.${req.format}`
    const entries = req.entries.map((e) => ({
      path: resolvePath(e.kind, e.file),
      gapAfterMs: e.gapAfterMs
    }))
    await stitchAndExport(entries, req.format, outPath)
    return { path: outPath }
  })

  ipcMain.handle('export:separate', async (_e, req: ExportSeparateRequest) => {
    const win = focusedWindow()
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose export folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const dir = join(res.filePaths[0])
    const files = await exportSeparate(
      req.files.map((f) => ({ path: resolvePath(f.kind, f.file), name: f.name })),
      req.format,
      dir
    )
    return { dir, files }
  })

  ipcMain.handle('shell:showItemInFolder', (_e, path: string) => {
    shell.showItemInFolder(path)
  })
}
