import { useEffect, useState } from 'react'
import { ref, set, update } from 'firebase/database'
import { rtdb, rtdbBasePath } from '../firebaseClient'
import { scheduleSources } from '../sources/scheduleSources'
import { getLocalInventory, setLocalInventory } from './localInventoryStore'

const apiBaseUrl = import.meta.env.VITE_OLDPC_API_BASE_URL || 'http://127.0.0.1:4174'
const publishIntervalMs = Number(import.meta.env.VITE_OLDPC_PUBLISH_INTERVAL_MS || 60_000)
const liveWindowMs = 120 * 60 * 1000
const endBufferMs = 60 * 1000
const outlierRevenueThreshold = 30_000_000
const publishSecond = 55
let globalRunning = false
let globalLastPublishBucketAt = 0
const inventorySources = [
  { key: 'skstoa', endpoint: '/api/skstoa/inventory' },
  { key: 'shinsegae', endpoint: '/api/shinsegae/inventory' },
  { key: 'ktalpha', endpoint: '/api/ktalpha/inventory' },
]
const zappingLiveWindowMs = 6 * 60 * 60 * 1000

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

function getProducts(inventory) {
  return Array.isArray(inventory?.products) ? inventory.products.filter(Boolean) : []
}

function getMinuteBucketAt(value) {
  return Math.floor(value / 60_000) * 60_000
}

function getNextPublishDelay(nowAt = Date.now()) {
  const now = new Date(nowAt)
  const next = new Date(nowAt)
  next.setMilliseconds(0)
  next.setSeconds(publishSecond)
  if (now.getSeconds() > publishSecond || (now.getSeconds() === publishSecond && now.getMilliseconds() > 0)) {
    next.setMinutes(next.getMinutes() + 1)
  }
  return Math.max(next.getTime() - nowAt, 0)
}

function getPointBucketAt(point, fallbackAt) {
  return point.bucketAt || getMinuteBucketAt(point.collectedAt || fallbackAt)
}

function getProductSessionKey(product) {
  return `${product.productId || ''}-${product.broadcastStartAt || 0}`
}

function getInventoryPrice(nextProduct, previousProduct) {
  if (nextProduct.broadcaster === 'SK' || previousProduct?.broadcaster === 'SK') return nextProduct.price || 0
  if (nextProduct.broadcaster === 'K쇼핑' || previousProduct?.broadcaster === 'K쇼핑') return nextProduct.price || 0
  return nextProduct.price || previousProduct?.price || 0
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
    stockBriefOrderAbleCnt: nextProduct.totalBriefOrderAbleCnt ?? currentStock,
    stockOrderAbleQty: nextProduct.totalOrderAbleQty ?? currentStock,
    stockTmwDelyOrderAbleCnt: nextProduct.totalTmwDelyOrderAbleCnt ?? 0,
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

function getLastActiveSnapshot(history, startAt, endAt) {
  return getHistory(history)
    .filter((point) => {
      const pointAt = point.collectedAt || point.bucketAt || 0
      return point.active && pointAt >= startAt && pointAt < endAt
    })
    .sort((a, b) => (a.collectedAt || a.bucketAt || 0) - (b.collectedAt || b.bucketAt || 0))
    .at(-1)
}

function normalizeHistory(history, collectedAt, cycleBucketAt) {
  const byBucket = new Map()

  for (const point of getHistory(history).sort((a, b) => (a.collectedAt || 0) - (b.collectedAt || 0))) {
    const bucketAt = getPointBucketAt(point, cycleBucketAt)

    const previous = byBucket.get(bucketAt)
    const rawSoldDelta = point.soldDelta || 0
    const soldDelta = Math.max(rawSoldDelta, 0)
    const revenueDelta = Math.max(point.revenueDelta ?? soldDelta * (point.price || 0), 0)
    byBucket.set(bucketAt, {
      ...(previous || {}),
      ...point,
      bucketAt,
      collectedAt: Math.max(previous?.collectedAt || 0, point.collectedAt || bucketAt),
      soldDelta: (previous?.soldDelta || 0) + soldDelta,
      revenueDelta: (previous?.revenueDelta || 0) + revenueDelta,
      restockDelta: (previous?.restockDelta || 0) + Math.max(-rawSoldDelta, point.restockDelta || 0, 0),
    })
  }

  return [...byBucket.values()].sort((a, b) => a.bucketAt - b.bucketAt)
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

  const price = getInventoryPrice(nextProduct, previousProduct)

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
      restockQuantity: previousProduct.restockQuantity || 0,
      history: normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt),
      collectedAt,
      sampleOk: true,
      lastSuccessAt: collectedAt,
    }
  }

  const currentStock = nextProduct.currentStock || nextProduct.totalStock || 0
  const history = normalizeHistory(previousProduct.history, collectedAt, cycleBucketAt)
  const previousPoint = getLastActiveSnapshot(
    history,
    nextProduct.broadcastStartAt || previousProduct.broadcastStartAt || 0,
    (nextProduct.broadcastEndAt || previousProduct.broadcastEndAt || 0) - endBufferMs,
  )
  if (!previousPoint) {
    return createProgramBaseline(nextProduct, collectedAt, cycleBucketAt)
  }

  const previousStock = previousPoint.stock ?? currentStock
  const isKtProduct = nextProduct.broadcaster === 'K쇼핑' || previousProduct.broadcaster === 'K쇼핑'
  const rawStockDelta = previousStock - currentStock
  const rawSoldDelta = Math.max(rawStockDelta, 0)
  const rawRevenueDelta = rawSoldDelta * price
  const isSkProduct = nextProduct.broadcaster === 'SK' || previousProduct.broadcaster === 'SK'
  const isSsgProduct = nextProduct.broadcaster === '신세계' || previousProduct.broadcaster === '신세계' || nextProduct.broadcaster === 'SSG' || previousProduct.broadcaster === 'SSG'
  const outlierAppliedYn = (isSkProduct || isKtProduct || isSsgProduct) && rawRevenueDelta >= outlierRevenueThreshold ? 'Y' : 'N'
  const soldDelta = outlierAppliedYn === 'Y' ? 0 : rawSoldDelta
  const revenueDelta = outlierAppliedYn === 'Y' ? 0 : rawRevenueDelta
  const restockDelta = Math.max(-rawStockDelta, 0)
  const estimatedSold = (previousPoint.estimatedSold || 0) + soldDelta
  const estimatedRevenue = (previousPoint.estimatedRevenue || 0) + revenueDelta
  const restockQuantity = (previousPoint.restockQuantity || 0) + restockDelta

  history.push({
    collectedAt,
    bucketAt: cycleBucketAt,
    active: true,
    stock: currentStock,
    stockBriefOrderAbleCnt: nextProduct.totalBriefOrderAbleCnt ?? currentStock,
    stockOrderAbleQty: nextProduct.totalOrderAbleQty ?? currentStock,
    stockTmwDelyOrderAbleCnt: nextProduct.totalTmwDelyOrderAbleCnt ?? 0,
    rawStockDelta,
    rawSoldDelta,
    rawRevenueDelta,
    soldDelta,
    revenueDelta,
    outlierAppliedYn,
    outlierReason: outlierAppliedYn === 'Y' ? 'minute_revenue_over_30000000' : undefined,
    outlierStatus: outlierAppliedYn === 'Y' ? 'pending_neighbor_correction' : undefined,
    price,
    estimatedSold,
    estimatedRevenue,
    restockDelta,
  })

  return {
    ...previousProduct,
    ...nextProduct,
    price,
    currentStock,
    lastStock: currentStock,
    initialStock: history[0]?.stock ?? currentStock,
    rawStockDelta,
    rawSoldDelta,
    rawRevenueDelta,
    soldDelta,
    outlierAppliedYn,
    estimatedSold,
    estimatedRevenue,
    restockQuantity,
    history: normalizeHistory(history, collectedAt, cycleBucketAt),
    collectedAt,
    sampleOk: true,
    lastSuccessAt: collectedAt,
  }
}

function mergeInventoryPayload(nextInventory, previousInventory, cycleBucketAt) {
  const attemptedAt = nextInventory.attemptedAt || nextInventory.collectedAt || Date.now()
  const collectedAt = nextInventory.collectedAt || attemptedAt
  const previousProducts = getProducts(previousInventory)
  const nextProducts = getProducts(nextInventory)
  const previousBySession = new Map(previousProducts.map((product) => [getProductSessionKey(product), product]))
  const nextBySession = new Map(nextProducts.map((product) => [getProductSessionKey(product), product]))
  const mergedBySession = new Map()

  for (const product of nextProducts) {
    mergedBySession.set(getProductSessionKey(product), mergeInventoryProduct(product, previousBySession.get(getProductSessionKey(product)), collectedAt, cycleBucketAt))
  }

  for (const previousProduct of previousProducts) {
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
  const okProducts = products.filter((product) => product && product.sampleOk !== false)
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

function trimInventoryForLive(inventory, nowAt = Date.now()) {
  const cutoffAt = getMinuteBucketAt(nowAt - liveWindowMs)
  const products = getProducts(inventory)
    .map((product) => ({
      ...product,
      history: getHistory(product.history).filter((point) => getPointBucketAt(point, nowAt) >= cutoffAt),
    }))
    .filter((product) => product.history.length || (product.broadcastEndAt || 0) >= nowAt - liveWindowMs)

  return {
    ...inventory,
    products,
    windowMinutes: Math.round(liveWindowMs / 60_000),
    retentionDays: undefined,
    historySourcePath: 'inventoryHistory/current',
  }
}

function buildZappingLive(inventory, nowAt = Date.now()) {
  const cutoffAt = getMinuteBucketAt(nowAt - zappingLiveWindowMs)
  const byBucket = new Map()
  const activeProductsByBucket = new Map()

  for (const product of getProducts(inventory)) {
    const productKey = product.productId || product.rowId || product.productName
    for (const point of getHistory(product.history)) {
      const bucketAt = getPointBucketAt(point, nowAt)
      if (!bucketAt || bucketAt < cutoffAt) continue
      if (!isPointInProductWindow(product, bucketAt)) continue

      const soldDelta = Math.max(Number(point.soldDelta || 0), 0)
      const revenueDelta = Math.max(Number(point.revenueDelta ?? soldDelta * (point.price || product.price || 0)), 0)
      if (!soldDelta && !revenueDelta) continue

      const current = byBucket.get(bucketAt) || { bucketAt, revenue: 0, sold: 0 }
      current.revenue += revenueDelta
      current.sold += soldDelta
      byBucket.set(bucketAt, current)

      if (productKey) {
        if (!activeProductsByBucket.has(bucketAt)) activeProductsByBucket.set(bucketAt, new Set())
        activeProductsByBucket.get(bucketAt).add(productKey)
      }
    }
  }

  const points = [...byBucket.values()]
    .sort((a, b) => a.bucketAt - b.bucketAt)
    .map((point) => ({
      ...point,
      activeProductCount: activeProductsByBucket.get(point.bucketAt)?.size || 0,
    }))

  return {
    collectedAt: inventory?.collectedAt || nowAt,
    updatedAt: nowAt,
    windowMinutes: Math.round(zappingLiveWindowMs / 60_000),
    points,
    totals: points.reduce(
      (sum, point) => ({
        revenue: sum.revenue + (point.revenue || 0),
        sold: sum.sold + (point.sold || 0),
        activeProductCount: Math.max(sum.activeProductCount, point.activeProductCount || 0),
      }),
      { revenue: 0, sold: 0, activeProductCount: 0 },
    ),
  }
}

function isPointInProductWindow(product, bucketAt) {
  const startAt = product?.broadcastStartAt || 0
  const endAt = product?.broadcastEndAt || 0
  if (!startAt || !endAt) return true
  return startAt <= bucketAt && bucketAt < endAt
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
  const publishBucketAt = getMinuteBucketAt(startedAt)
  if (globalRunning || globalLastPublishBucketAt === publishBucketAt) return false
  globalRunning = true
  globalLastPublishBucketAt = publishBucketAt
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
    try {
      const inventory = await fetchJson(source.endpoint)
      const previousInventory = await getLocalInventory(source.key)
      const mergedInventory = sanitizeFirebaseValue(mergeInventoryPayload(inventory, previousInventory, cycleBucketAt))
      await setLocalInventory(source.key, mergedInventory)
      if (source.key === 'skstoa') {
        await set(ref(rtdb, `${rtdbBasePath}/channels/${source.key}/zappingLive`), sanitizeFirebaseValue(buildZappingLive(mergedInventory, inventoryStartedAt)))
      }
    } catch (error) {
      channelErrors.push(`${source.key} inventory: ${error.message}`)
      const previousInventory = await getLocalInventory(source.key)
      if (previousInventory) {
        await setLocalInventory(source.key, sanitizeFirebaseValue({
          ...previousInventory,
          attemptedAt: Date.now(),
          status: 'error',
          error: error.message,
        }))
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
    publishSecond,
    status: channelErrors.length ? 'partial-error' : 'ok',
    error: channelErrors.join(' / ') || null,
    mode: 'browser',
    channels: scheduleSources.map((source) => source.key),
  }

  if (!channelErrors.length) collectorUpdate.lastSuccessAt = completedAt

  await update(ref(rtdb, `${rtdbBasePath}/collector`), collectorUpdate)
  globalRunning = false
  return true
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
    let timer = null

    async function run() {
      if (stopped) return
      setStatus((current) => ({ ...current, enabled: true, running: true, error: '' }))

      try {
        const didPublish = await publishOnce()
        if (!stopped) {
          setStatus((current) => ({
            enabled: true,
            running: false,
            lastSuccessAt: didPublish ? Date.now() : current.lastSuccessAt,
            error: '',
          }))
        }
      } catch (error) {
        globalRunning = false
        console.error(error)
        if (!stopped) {
          setStatus((current) => ({
            ...current,
            enabled: true,
            running: false,
            error: error.message,
          }))
        }
      }
    }

    function scheduleNextRun() {
      if (stopped) return
      timer = window.setTimeout(async () => {
        await run()
        scheduleNextRun()
      }, getNextPublishDelay())
    }

    scheduleNextRun()

    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  return status
}
