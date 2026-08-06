/**
 * Offline product catalog cache (IndexedDB).
 * Keeps a local copy of products so search + barcode work without network.
 */

const DB_NAME = 'pos-enterprise'
const STORE = 'products'
const META = 'meta'
const VERSION = 2

export interface CachedProduct {
  id: string
  sku: string
  barcode?: string | null
  name: string
  sellingPrice: number | string
  taxRate: number | string
  trackInventory: boolean
  updatedAt?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('barcode', 'barcode', { unique: false })
        store.createIndex('sku', 'sku', { unique: false })
        store.createIndex('name', 'name', { unique: false })
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' })
      }
      // Ensure pendingSales still exists (from offlineQueue)
      if (!db.objectStoreNames.contains('pendingSales')) {
        db.createObjectStore('pendingSales', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, META], 'readwrite')
    const store = tx.objectStore(STORE)
    // Clear and rewrite for simplicity (full snapshot)
    store.clear()
    for (const p of products) {
      store.put({ ...p, updatedAt: new Date().toISOString() })
    }
    tx.objectStore(META).put({ key: 'productsSyncedAt', value: new Date().toISOString() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCachedProducts(search = ''): Promise<CachedProduct[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      let items = (req.result as CachedProduct[]) || []
      if (search.trim()) {
        const q = search.toLowerCase()
        items = items.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.barcode && p.barcode.toLowerCase().includes(q))
        )
      }
      resolve(items.slice(0, 80))
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedByBarcode(code: string): Promise<CachedProduct | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('barcode')
    const req = idx.get(code)
    req.onsuccess = () => resolve((req.result as CachedProduct) || null)
    req.onerror = () => reject(req.error)
  })
}

export async function getProductsSyncedAt(): Promise<string | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META, 'readonly')
    const req = tx.objectStore(META).get('productsSyncedAt')
    req.onsuccess = () => resolve(req.result?.value ?? null)
    req.onerror = () => reject(req.error)
  })
}
