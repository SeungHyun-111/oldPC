import { useEffect, useState } from 'react'
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
    let ignore = false

    async function loadSchedule(source) {
      try {
        const response = await fetch(source.endpoint, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || `요청 실패: ${response.status}`)
        if (!ignore) {
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
        }
      } catch (error) {
        if (!ignore) {
          setSchedules((current) => ({
            ...current,
            [source.key]: {
              ...current[source.key],
              error: error.message,
            },
          }))
        }
      }
    }

    scheduleSources.forEach(loadSchedule)
    const timer = window.setInterval(() => {
      scheduleSources.forEach(loadSchedule)
    }, 60_000)

    return () => {
      ignore = true
      window.clearInterval(timer)
    }
  }, [])

  return schedules
}
