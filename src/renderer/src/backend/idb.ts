// Minimal IndexedDB wrapper for the web build's audio storage.
// Keys: "cache:<fileName>" for generated audio, "clip:<uuid>:<name>" for user clips.

const DB_NAME = 'freditor'
const STORE = 'audio'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbPut(key: string, value: ArrayBuffer): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(value, key))
}

export async function idbGet(key: string): Promise<ArrayBuffer> {
  const value = await tx<ArrayBuffer | undefined>('readonly', (s) => s.get(key))
  if (!value) throw new Error(`Audio not found in browser storage: ${key}`)
  return value
}

export function idbDelete(key: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(key))
}

export function idbKeys(): Promise<IDBValidKey[]> {
  return tx('readonly', (s) => s.getAllKeys())
}
