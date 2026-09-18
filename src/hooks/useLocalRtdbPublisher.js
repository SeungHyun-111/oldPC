import { useEffect, useState } from 'react'
import { get, ref, set, update } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'
import { scheduleSources } from '../sources/scheduleSources'

const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
const publishIntervalMs = Number(import.meta.env.VITE_OLDPC_PUBLISH_INTERVAL_MS || 60_000)
const historyWindowMs = 120 * 60 * 1000
const endBufferMs = 60 * 1000
const inventorySources = [
  { key: 'skstoa', endpoint: '/api/skstoa/inventory' },
  { key: 'shinsegae', endpoint: '/api/shinsegae/inventory' },
  { key: 'ktalpha', endpoint: '/api/ktalpha/inventory' },
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

function getHistory(history) {
  return history || []
}

function getMinuteBucketAt(value) {
  return Math.floor(value / 60_000) * 60_000
}

function getPointBucketAt(point, fallbackAt) {
  return point.bucketAt || getMinuteBucketAt(point.collectedAt || fallbackAt)
}

function normalizeHistory(history, collectedAt, cycleBucketAt) {
  const cutoffAt = getMinuteBucketAt(collectedAt - historyWindowMs)
  const byBucket = new Map()

  for (const point of getHistory(history).sort((a, b) => (a.collectedAt || 0) - (b.collectedAt || 0))) {
    const bucketAt = getPointBucketAt(point, cycleBucketAt)
    if (bucketAt < cutoffAt) continue

    const previous = byBucket.get(bucketAt)
    byBucket.set(bucketAt, {
      ...(previous || {}),
      ...point,
      bucketAt,
      collectedAt: Math.max(previous?.collectedAt || 0, point.collectedAt || bucketAt),
      soldDelta: (previous?.soldDelta || 0) + (point.soldDelta || 0),
    })
  }

  return [...byBucket.values()].sort((a, b) => a.bucketAt - b.bucketAt).slice(-120)
}

function mergeInventoryProduct(nextProduct, previousProduct, collectedAt, cycleBucketAt) {
  if (!previousProduct) {
    return {
      ...nextProduct,
      history: normalizeHistory(nextProduct.history, collectedAt, cycleBucketAt),
      collectedAt,
    }
  }

  if (collectedAt >= (nextProduct.broadcastEndAt || previousProduct.broadcastEndAt || 0) - endBufferMs) {
    return {
      ...previousProduct,
      ...nextProduct,
      currentStock: previousProduct.currentStock,
      totalStock: previousProduct.totalStock,
      lastStock: previousProduct.lastStock,
      soldDelta: 0,
      estimatedSold: previousProduct.estimatedSold || 0,
      estimatedRevenue: previousProduct.estimatedRevenue || 0,
      history: normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt),
      collectedAt,
    }
  }

  const price = nextProduct.price || previousProduct.price || 0
  const currentStock = nextProduct.currentStock || nextProduct.totalStock || 0
  const previousStock = previousProduct.currentStock ?? previousProduct.lastStock ?? currentStock
  const soldDelta = Math.max(previousStock - currentStock, 0)
  const estimatedSold = (previousProduct.estimatedSold || 0) + soldDelta
  const estimatedRevenue = estimatedSold * price
  const history = normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt)

  history.push({
    collectedAt,
    bucketAt: cycleBucketAt,
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
    history: normalizeHistory(history, collectedAt, cycleBucketAt),
    collectedAt,
  }
}

function mergeInventoryPayload(nextInventory, previousInventory, cycleBucketAt) {
  const collectedAt = nextInventory.collectedAt || Date.now()
  const previousById = new Map((previousInventory?.products || []).map((product) => [product.productId, product]))
  const nextProducts = nextInventory.products || []

  const products = nextProducts.length
    ? nextProducts.map((product) => mergeInventoryProduct(product, previousById.get(product.productId), collectedAt, cycleBucketAt))
    : (previousInventory?.products || [])
        .map((product) => ({
          ...product,
          history: normalizeHistory(product.history, collectedAt, cycleBucketAt),
        }))
        .filter((product) => product.history.length || product.broadcastEndAt >= collectedAt)

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

function sanitizeFirebaseValue(value) {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(sanitizeFirebaseValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, sanitizeFirebaseValue(entryValue)]),
  )
}

async function publishOnce() {
  const startedAt = Date.now()

  for (const source of scheduleSources) {
    const payload = await fetchJson(source.endpoint)
    await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/schedule`), payload)
  }

  const inventoryStartedAt = Date.now()
  const cycleBucketAt = getMinuteBucketAt(inventoryStartedAt)

  for (const source of inventorySources) {
    const inventory = await fetchJson(source.endpoint)
    const inventoryRef = ref(rtdb, `${rtdbBasePath}/channels/${source.key}/inventory`)
    const previousInventory = (await get(inventoryRef)).val()
    await set(inventoryRef, sanitizeFirebaseValue(mergeInventoryPayload(inventory, previousInventory, cycleBucketAt)))
  }

  await update(ref(rtdb, `${rtdbBasePath}/collector`), {
    lastSuccessAt: Date.now(),
    lastBrowserPublishStartedAt: startedAt,
    lastBrowserInventoryStartedAt: inventoryStartedAt,
    lastBrowserPublishBucketAt: cycleBucketAt,
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
