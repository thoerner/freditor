import { ElectronAPI } from '@electron-toolkit/preload'
import type { FreditorApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: FreditorApi
  }
}
