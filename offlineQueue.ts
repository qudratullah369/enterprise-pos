/**
 * Offline sales queue using IndexedDB.
 * Queues failed sale requests when offline and retries when back online.
 */

const DB_NAME = 'pos-enterprise'
const STORE = 'pendingSales'
const VERSION = 1

export interface PendingSale {
  id: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueueSale(payload: unknown): Promise<PendingSale> {
  const db = await openDb()
  const item: PendingSale = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve(item)
    tx.onerror = () => reject(tx.error)
  })
}

export async function listPending(): Promise<PendingSale[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result as PendingSale[])
    req.onerror = () => reject(req.error)
  })
}

export async function removePending(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function updatePending(item: PendingSale): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Flush queue: POST each pending sale. Returns count synced.
 */
export async function flushQueue(
  postSale: (payload: unknown) => Promise<unknown>
): Promise<{ synced: number; failed: number }> {
  const pending = await listPending()
  let synced = 0
  let failed = 0

  for (const item of pending) {
    try {
      await postSale(item.payload)
      await removePending(item.id)
      synced++
    } catch (err: any) {
      item.attempts += 1
      item.lastError = err?.message ?? 'Unknown error'
      await updatePending(item)
      failed++
    }
  }

  return { synced, failed }
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}
