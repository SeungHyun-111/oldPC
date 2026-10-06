const dbName = 'oldpc-local'
const dbVersion = 1
const storeName = 'inventories'
const memoryStore = new Map()
export const localInventoryEvent = 'oldpc:inventory-updated'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(dbName, dbVersion)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getLocalInventory(channel) {
  if (!window.indexedDB) return memoryStore.get(channel) || null

  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(channel)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => db.close()
    })
  } catch {
    return memoryStore.get(channel) || null
  }
}

export async function setLocalInventory(channel, inventory) {
  memoryStore.set(channel, inventory)

  if (window.indexedDB) {
    try {
      const db = await openDb()
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        transaction.objectStore(storeName).put(inventory, channel)
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      })
    } catch {
      // Keep the in-memory copy so the live screen can continue for this tab.
    }
  }

  window.dispatchEvent(new CustomEvent(localInventoryEvent, { detail: { channel, inventory } }))
}
