import { useEffect, useState } from 'react'

const emptyInventory = {
  broadcaster: 'SK',
  products: [],
  totals: { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
  collectedAt: null,
  windowMinutes: 60,
}

export function useSkInventory() {
  const [inventory, setInventory] = useState(emptyInventory)

  useEffect(() => {
    let active = true

    async function loadInventory() {
      try {
        const response = await fetch('/api/skstoa/inventory', { cache: 'no-store' })
        const payload = await response.json()
        if (active) setInventory(payload)
      } catch (error) {
        if (active) setInventory((current) => ({ ...current, error: error.message }))
      }
    }

    loadInventory()
    const timer = window.setInterval(loadInventory, 60000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return inventory
}
