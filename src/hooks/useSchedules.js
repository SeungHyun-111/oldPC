import { useEffect, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'
import { scheduleSources } from '../sources/scheduleSources'

function createEmptySchedule() {
  return {
    items: [],
    loadedAt: null,
    fromCache: false,
    cacheType: '',
    remoteFetchCount: 0,
    nextRefreshAt: null,
    error: '',
  }
}

export function useSchedules() {
  const [schedules, setSchedules] = useState(() =>
    Object.fromEntries(scheduleSources.map((source) => [source.key, createEmptySchedule()])),
  )

  useEffect(() => {
    const unsubscribes = scheduleSources.map((source) =>
      onValue(
        ref(rtdb, `${rtdbBasePath}/channels/${source.key}/schedule`),
        (snapshot) => {
          const payload = snapshot.val() || {}
          setSchedules((current) => ({
            ...current,
            [source.key]: {
              items: payload.items || [],
              loadedAt: payload.loadedAt || null,
              fromCache: Boolean(payload.fromCache),
              cacheType: payload.cacheType || '',
              remoteFetchCount: payload.remoteFetchCount || 0,
              nextRefreshAt: payload.nextRefreshAt || null,
              error: payload.error || '',
            },
          }))
        },
        (error) => {
          setSchedules((current) => ({
            ...current,
            [source.key]: {
              ...current[source.key],
              error: error.message,
            },
          }))
        },
      ),
    )

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [])

  return schedules
}
