import { useEffect, useState } from 'react'
import { ref, set, update } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'
import { scheduleSources } from '../sources/scheduleSources'

const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
const publishIntervalMs = Number(import.meta.env.VITE_OLDPC_PUBLISH_INTERVAL_MS || 60_000)

function canPublishFromThisPage() {
  if (import.meta.env.VITE_OLDPC_BROWSER_PUBLISH === '0') return false
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || `${path} returned ${response.status}`)
  return payload
}

async function publishOnce() {
  const startedAt = Date.now()

  for (const source of scheduleSources) {
    const payload = await fetchJson(source.endpoint)
    await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/schedule`), payload)
  }

  const inventory = await fetchJson('/api/skstoa/inventory')
  await set(ref(rtdb, `${rtdbBasePath}/channels/skstoa/inventory`), inventory)

  await update(ref(rtdb, `${rtdbBasePath}/collector`), {
    lastSuccessAt: Date.now(),
    lastBrowserPublishStartedAt: startedAt,
    intervalMs: publishIntervalMs,
    status: 'ok',
    mode: 'browser',
    channels: scheduleSources.map((source) => source.key),
  })
}

export function useLocalRtdbPublisher() {
  const [status, setStatus] = useState({
    enabled: false,
    running: false,
    lastSuccessAt: null,
    error: '',
  })

  useEffect(() => {
    if (!canPublishFromThisPage()) return undefined

    let stopped = false
    let running = false

    async function run() {
      if (running || stopped) return
      running = true
      setStatus((current) => ({ ...current, enabled: true, running: true, error: '' }))

      try {
        await publishOnce()
        if (!stopped) {
          setStatus({
            enabled: true,
            running: false,
            lastSuccessAt: Date.now(),
            error: '',
          })
        }
      } catch (error) {
        console.error(error)
        if (!stopped) {
          setStatus((current) => ({
            ...current,
            enabled: true,
            running: false,
            error: error.message,
          }))
        }
      } finally {
        running = false
      }
    }

    run()
    const timer = window.setInterval(run, publishIntervalMs)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  return status
}
