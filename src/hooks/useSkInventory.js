import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'

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
    const unsubscribe = onValue(
      ref(rtdb, `${rtdbBasePath}/channels/skstoa/inventory`),
      (snapshot) => {
        setInventory({ ...emptyInventory, ...(snapshot.val() || {}) })
      },
      (error) => {
        setInventory((current) => ({ ...current, error: error.message }))
      },
    )

    return () => {
      unsubscribe()
    }
  }, [])

  return inventory
}
