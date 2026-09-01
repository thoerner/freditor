/** Strip Electron's "Error invoking remote method 'x': Error:" prefix from IPC errors. */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.match(/Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?(.*)$/s)
  return (m ? m[1] : raw).trim() || 'Unknown error'
}
