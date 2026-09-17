import { useEffect, useState } from 'react'
import { get, ref, set, update } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'
import { scheduleSources } from '../sources/scheduleSources'

const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
const publishIntervalMs = Number(import.meta.env.VITE_OLDPC_PUBLISH_INTERVAL_MS || 60_000)
const historyWindowMs = 60 * 60 * 1000
const inventorySources = [
  { key: 'skstoa', endpoint: '/api/skstoa/inventory' },
  { key: 'shinsegae', endpoint: '/api/shinsegae/inventory' },
]

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

function getRecentHistory(history, collectedAt) {
  const windowStart = collectedAt - historyWindowMs
  return (history || []).filter((point) => point.collectedAt >= windowStart)
}

function mergeInventoryProduct(nextProduct, previousProduct, collectedAt) {
  if (!previousProduct) return nextProduct

  const price = nextProduct.price || previousProduct.price || 0
  const currentStock = nextProduct.currentStock || nextProduct.totalStock || 0
  const previousStock = previousProduct.currentStock ?? previousProduct.lastStock ?? currentStock
  const soldDelta = Math.max(previousStock - currentStock, 0)
  const estimatedSold = (previousProduct.estimatedSold || 0) + soldDelta
  const estimatedRevenue = estimatedSold * price
  const history = getRecentHistory(previousProduct.history, collectedAt)

  history.push({
    collectedAt,
    active: true,
    stock: currentStock,
    soldDelta,
    estimatedSold,
    estimatedRevenue,
  })

  return {
    ...previousProduct,
    ...nextProduct,
    price,
    currentStock,
    lastStock: currentStock,
    initialStock: previousProduct.initialStock ?? nextProduct.initialStock ?? currentStock,
    soldDelta,
    estimatedSold,
    estimatedRevenue,
    history: history.slice(-60),
    collectedAt,
  }
}

function mergeInventoryPayload(nextInventory, previousInventory) {
  const collectedAt = nextInventory.collectedAt || Date.now()
  const previousById = new Map((previousInventory?.products || []).map((product) => [product.productId, product]))
  const nextProducts = nextInventory.products || []

  const products = nextProducts.length
    ? nextProducts.map((product) => mergeInventoryProduct(product, previousById.get(product.productId), collectedAt))
    : (previousInventory?.products || [])
        .map((product) => ({
          ...product,
          history: getRecentHistory(product.history, collectedAt),
        }))
        .filter((product) => product.history.length || product.broadcastEndAt >= collectedAt - historyWindowMs)

  return {
    ...nextInventory,
    products,
    totals: products.reduce(
      (sum, product) => ({
        estimatedSold: sum.estimatedSold + (product.estimatedSold || 0),
        estimatedRevenue: sum.estimatedRevenue + (product.estimatedRevenue || 0),
        soldDelta: sum.soldDelta + (product.soldDelta || 0),
        currentStock: sum.currentStock + (product.currentStock || 0),
      }),
      { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
    ),
  }
}

async function publishOnce() {
  const startedAt = Date.now()

  for (const source of scheduleSources) {
    const payload = await fetchJson(source.endpoint)
    await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/schedule`), payload)
  }

  for (const source of inventorySources) {
    const inventory = await fetchJson(source.endpoint)
    const inventoryRef = ref(rtdb, `${rtdbBasePath}/channels/${source.key}/inventory`)
    const previousInventory = (await get(inventoryRef)).val()
    await set(inventoryRef, mergeInventoryPayload(inventory, previousInventory))
  }

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
