import { app } from 'electron'
import { join, basename, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  rmSync
} from 'fs'
import type { Project } from '../shared/types'
import { addRecentProject } from './settings'

export const PROJECT_EXT = '.freditor'

/**
 * Tracks where the currently open project lives and where its generated
 * audio cache is. Unsaved projects cache audio under userData; once saved,
 * the cache lives in a "<name>.freditor.assets" folder next to the file.
 */
let currentProjectPath: string | null = null
let currentCacheDir: string | null = null

function unsavedCacheDir(projectId: string): string {
  return join(app.getPath('userData'), 'audio-cache', projectId)
}

function savedCacheDir(projectPath: string): string {
  return join(dirname(projectPath), `${basename(projectPath, PROJECT_EXT)}${PROJECT_EXT}.assets`)
}

export function getCacheDir(): string {
  if (!currentCacheDir) throw new Error('No project open (no cache dir set)')
  if (!existsSync(currentCacheDir)) mkdirSync(currentCacheDir, { recursive: true })
  return currentCacheDir
}

export function getProjectPath(): string | null {
  return currentProjectPath
}

/** Resolve a cache file name to an absolute path, guarding against traversal. */
export function resolveCacheFile(fileName: string): string {
  if (fileName !== basename(fileName)) throw new Error(`Invalid cache file name: ${fileName}`)
  return join(getCacheDir(), fileName)
}

export function startNewProject(projectId: string): void {
  currentProjectPath = null
  currentCacheDir = unsavedCacheDir(projectId)
}

export function openProjectFile(path: string): Project {
  const raw = readFileSync(path, 'utf-8')
  const project = JSON.parse(raw) as Project
  if (!project || project.version !== 1 || !Array.isArray(project.sections)) {
    throw new Error('Not a valid freditor project file.')
  }
  currentProjectPath = path
  currentCacheDir = savedCacheDir(path)
  addRecentProject(path)
  return project
}

/**
 * Save the project JSON to `path`. If the audio cache currently lives
 * elsewhere (unsaved project, or save-as to a new location), copy the cached
 * audio into the new assets folder.
 */
export function saveProjectFile(project: Project, path: string): void {
  const newCacheDir = savedCacheDir(path)
  const oldCacheDir = currentCacheDir

  writeFileSync(path, JSON.stringify(project, null, 2), 'utf-8')

  if (oldCacheDir && oldCacheDir !== newCacheDir && existsSync(oldCacheDir)) {
    mkdirSync(newCacheDir, { recursive: true })
    for (const f of readdirSync(oldCacheDir)) {
      try {
        copyFileSync(join(oldCacheDir, f), join(newCacheDir, f))
      } catch (err) {
        console.error(`Failed to copy cache file ${f}:`, err)
      }
    }
    // Clean up the temporary unsaved-project cache only if it lived in userData
    if (oldCacheDir.startsWith(join(app.getPath('userData'), 'audio-cache'))) {
      try {
        rmSync(oldCacheDir, { recursive: true, force: true })
      } catch {
        /* non-fatal */
      }
    }
  }

  currentProjectPath = path
  currentCacheDir = newCacheDir
  addRecentProject(path)
}

/** Delete cached audio files that are no longer referenced by any line. */
export function pruneCache(referencedFiles: string[]): void {
  if (!currentCacheDir || !existsSync(currentCacheDir)) return
  const keep = new Set(referencedFiles)
  for (const f of readdirSync(currentCacheDir)) {
    if (!keep.has(f)) {
      try {
        rmSync(join(currentCacheDir, f))
      } catch {
        /* non-fatal */
      }
    }
  }
}
