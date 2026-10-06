const memoryStore = new Map()
const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
export const localInventoryEvent = 'oldpc:inventory-updated'

export async function getLocalInventory(channel) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/local-inventory/${channel}`, { cache: 'no-store' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `local inventory read failed: ${response.status}`)
    memoryStore.set(channel, payload)
    return payload
  } catch {
    return memoryStore.get(channel) || null
  }
}

export async function setLocalInventory(channel, inventory) {
  memoryStore.set(channel, inventory)

  try {
    const response = await fetch(`${apiBaseUrl}/api/local-inventory/${channel}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(inventory),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `local inventory save failed: ${response.status}`)
  } catch (error) {
    console.error(error)
  }

  window.dispatchEvent(new CustomEvent(localInventoryEvent, { detail: { channel, inventory } }))
}
