import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'

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
    const unsubscribe = onValue(
      ref(rtdb, `${rtdbBasePath}/channels/${channel}/inventory`),
      (snapshot) => {
        setInventory({ ...emptyInventory, broadcaster, ...(snapshot.val() || {}) })
      },
      (error) => {
        setInventory((current) => ({ ...current, error: error.message }))
      },
    )

    return () => {
      unsubscribe()
    }
  }, [broadcaster, channel])

  return inventory
}

export function useSkInventory() {
  return useChannelInventory('skstoa', 'SK')
}
