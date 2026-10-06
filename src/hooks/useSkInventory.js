import { useEffect, useState } from 'react'
import { getLocalInventory, localInventoryEvent } from './localInventoryStore'

const emptyInventory = {
  broadcaster: '',
  products: [],
  totals: { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
  collectedAt: null,
  windowMinutes: 120,
}

export function useChannelInventory(channel, broadcaster) {
  const [inventory, setInventory] = useState({ ...emptyInventory, broadcaster })

  useEffect(() => {
    const applyInventory = (payload) => {
      setInventory({ ...emptyInventory, broadcaster, ...(payload || {}) })
    }

    getLocalInventory(channel).then(applyInventory)

    function handleLocalInventory(event) {
      if (event.detail?.channel === channel) applyInventory(event.detail.inventory)
    }

    function handleStorage(event) {
      if (event.key !== `oldpc.inventory.${channel}`) return
      getLocalInventory(channel).then(applyInventory)
    }

    window.addEventListener(localInventoryEvent, handleLocalInventory)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(localInventoryEvent, handleLocalInventory)
      window.removeEventListener('storage', handleStorage)
    }
  }, [broadcaster, channel])

  return inventory
}

export function useSkInventory() {
  return useChannelInventory('skstoa', 'SK')
}
