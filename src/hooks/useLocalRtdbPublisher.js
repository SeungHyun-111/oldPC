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

function getProductSessionKey(product) {
  return `${product.productId || ''}-${product.broadcastStartAt || 0}`
}

function hasProgramHistory(product) {
  const startAt = product?.broadcastStartAt || 0
  const endAt = (product?.broadcastEndAt || 0) - endBufferMs
  if (!startAt || !endAt) return false

  return getHistory(product.history).some((point) => {
    const pointAt = point.collectedAt || point.bucketAt || 0
    return point.active && pointAt >= startAt && pointAt < endAt
  })
}

function createProgramBaseline(nextProduct, collectedAt, cycleBucketAt) {
  const price = nextProduct.price || 0
  const currentStock = nextProduct.currentStock || nextProduct.totalStock || 0
  const historyPoint = {
    collectedAt,
    bucketAt: cycleBucketAt,
    active: true,
    stock: currentStock,
    soldDelta: 0,
    revenueDelta: 0,
    price,
    estimatedSold: 0,
    estimatedRevenue: 0,
  }

  return {
    ...nextProduct,
    price,
    currentStock,
    totalStock: nextProduct.totalStock ?? currentStock,
    lastStock: currentStock,
    initialStock: currentStock,
    soldDelta: 0,
    estimatedSold: 0,
    estimatedRevenue: 0,
    restockQuantity: 0,
    history: normalizeHistory([historyPoint], collectedAt, cycleBucketAt),
    collectedAt,
    sampleOk: true,
    lastSuccessAt: collectedAt,
  }
}

function hasActiveSample(product) {
  return product?.sampleOk === true || getHistory(product?.history).some((point) => point.active)
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
      revenueDelta: (previous?.revenueDelta || 0) + (point.revenueDelta ?? (point.soldDelta || 0) * (point.price || 0)),
    })
  }

  return [...byBucket.values()].sort((a, b) => a.bucketAt - b.bucketAt).slice(-120)
}

function mergeInventoryProduct(nextProduct, previousProduct, collectedAt, cycleBucketAt) {
  const nextHasActiveSample = hasActiveSample(nextProduct)

  if (!previousProduct) {
    return nextHasActiveSample
      ? createProgramBaseline(nextProduct, collectedAt, cycleBucketAt)
      : {
          ...nextProduct,
          history: normalizeHistory(nextProduct.history, collectedAt, cycleBucketAt),
          collectedAt,
        }
  }

  if (!hasProgramHistory(previousProduct) && nextHasActiveSample) {
    return createProgramBaseline(nextProduct, collectedAt, cycleBucketAt)
  }

  const price = nextProduct.price || previousProduct.price || 0

  if (nextProduct.sampleOk === false) {
    return {
      ...previousProduct,
      error: nextProduct.error,
      sampleOk: false,
      attemptedAt: nextProduct.attemptedAt || collectedAt,
      history: normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt),
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
      sampleOk: true,
      lastSuccessAt: collectedAt,
    }
  }

  const currentStock = nextProduct.currentStock || nextProduct.totalStock || 0
  const previousStock = previousProduct.currentStock ?? previousProduct.lastStock ?? currentStock
  const soldDelta = Math.max(previousStock - currentStock, 0)
  const revenueDelta = soldDelta * price
  const estimatedSold = (previousProduct.estimatedSold || 0) + soldDelta
  const estimatedRevenue = (previousProduct.estimatedRevenue || 0) + revenueDelta
  const history = normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt)

  history.push({
    collectedAt,
    bucketAt: cycleBucketAt,
    active: true,
    stock: currentStock,
    soldDelta,
    revenueDelta,
    price,
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
    sampleOk: true,
    lastSuccessAt: collectedAt,
  }
}

function mergeInventoryPayload(nextInventory, previousInventory, cycleBucketAt) {
  const attemptedAt = nextInventory.attemptedAt || nextInventory.collectedAt || Date.now()
  const collectedAt = nextInventory.collectedAt || attemptedAt
  const previousBySession = new Map((previousInventory?.products || []).map((product) => [getProductSessionKey(product), product]))
  const nextProducts = nextInventory.products || []
  const nextBySession = new Map(nextProducts.map((product) => [getProductSessionKey(product), product]))
  const mergedBySession = new Map()

  for (const product of nextProducts) {
    mergedBySession.set(getProductSessionKey(product), mergeInventoryProduct(product, previousBySession.get(getProductSessionKey(product)), collectedAt, cycleBucketAt))
  }

  for (const previousProduct of previousInventory?.products || []) {
    const key = getProductSessionKey(previousProduct)
    if (nextBySession.has(key)) continue
    const history = normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt)
    if (history.length || previousProduct.broadcastEndAt >= collectedAt) {
      mergedBySession.set(key, {
        ...previousProduct,
        history,
      })
    }
  }

  const products = [...mergedBySession.values()]
  const okProducts = products.filter((product) => product.sampleOk !== false)
  const failedProducts = products.filter((product) => product.sampleOk === false)
  const lastSuccessAt =
    okProducts.length && nextProducts.some((product) => product.sampleOk !== false)
      ? collectedAt
      : previousInventory?.lastSuccessAt || null

  return {
    ...nextInventory,
    attemptedAt,
    lastSuccessAt,
    errorCount: failedProducts.length,
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
  const channelErrors = []

  for (const source of scheduleSources) {
    try {
      const payload = await fetchJson(source.endpoint)
      await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/schedule`), payload)
    } catch (error) {
      channelErrors.push(`${source.key} schedule: ${error.message}`)
      await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/scheduleError`), {
        message: error.message,
        at: Date.now(),
      })
    }
  }

  const inventoryStartedAt = Date.now()
  const cycleBucketAt = getMinuteBucketAt(inventoryStartedAt)

  for (const source of inventorySources) {
    const inventoryRef = ref(rtdb, `${rtdbBasePath}/channels/${source.key}/inventory`)
    try {
      const inventory = await fetchJson(source.endpoint)
      const previousInventory = (await get(inventoryRef)).val()
      await set(inventoryRef, sanitizeFirebaseValue(mergeInventoryPayload(inventory, previousInventory, cycleBucketAt)))
    } catch (error) {
      channelErrors.push(`${source.key} inventory: ${error.message}`)
      const previousInventory = (await get(inventoryRef)).val()
      if (previousInventory) {
        await set(
          inventoryRef,
          sanitizeFirebaseValue({
            ...previousInventory,
            attemptedAt: Date.now(),
            status: 'error',
            error: error.message,
          }),
        )
      }
      await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/inventoryError`), {
        message: error.message,
        at: Date.now(),
      })
    }
  }

  const completedAt = Date.now()
  const collectorUpdate = {
    lastAttemptAt: completedAt,
    lastBrowserPublishStartedAt: startedAt,
    lastBrowserInventoryStartedAt: inventoryStartedAt,
    lastBrowserPublishBucketAt: cycleBucketAt,
    intervalMs: publishIntervalMs,
    status: channelErrors.length ? 'partial-error' : 'ok',
    error: channelErrors.join(' / ') || null,
    mode: 'browser',
    channels: scheduleSources.map((source) => source.key),
  }

  if (!channelErrors.length) collectorUpdate.lastSuccessAt = completedAt

  await update(ref(rtdb, `${rtdbBasePath}/collector`), collectorUpdate)
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
