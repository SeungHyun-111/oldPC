import { useEffect, useState } from 'react'
import { scheduleSources } from '../sources/scheduleSources'

const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
const refreshMs = Number(import.meta.env.VITE_OLDPC_SCHEDULE_REFRESH_MS || 60_000)

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
    let stopped = false
    let timer = null

    async function refreshSchedules() {
      await Promise.all(scheduleSources.map(async (source) => {
        const requestUrl = `${apiBaseUrl}${source.endpoint}`
        try {
          const response = await fetch(requestUrl, { cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            console.error('[oldPC schedule fetch failed]', {
              channel: source.key,
              label: source.label,
              requestUrl,
              status: response.status,
              statusText: response.statusText,
              serverError: payload.error || '',
              response: payload,
            })
            throw new Error(payload.error || `${source.endpoint} returned ${response.status}`)
          }
          if (stopped) return

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
        } catch (error) {
          if (stopped) return
          console.error('[oldPC schedule error]', {
            channel: source.key,
            label: source.label,
            requestUrl,
            message: error.message,
            error,
          })
          setSchedules((current) => ({
            ...current,
            [source.key]: {
              ...current[source.key],
              error: error.message,
            },
          }))
        }
      }))
    }

    refreshSchedules()
    timer = window.setInterval(refreshSchedules, refreshMs)

    return () => {
      stopped = true
      if (timer) window.clearInterval(timer)
    }
  }, [])

  return schedules
}
