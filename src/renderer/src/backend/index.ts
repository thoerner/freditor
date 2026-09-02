import type { FreditorApi } from '../../../shared/api'
import { createWebApi } from './webapi'

/** True when running as a plain web app (no Electron preload). */
export const isWeb = typeof window !== 'undefined' && !window.api

export const api: FreditorApi = isWeb ? createWebApi() : window.api
