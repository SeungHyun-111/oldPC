import https from 'node:https'

const DETAIL_INFO_URL = 'https://www.shinsegaetvshopping.com/display/detailInfo'
const DETAIL_URL = 'https://www.shinsegaetvshopping.com/display/detail'
const maxSnapshots = 120
const detailState = new Map()
const windowMs = maxSnapshots * 60 * 1000
const endBufferMs = 60 * 1000
const detailConcurrency = 3

function parseNumber(value) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function findFirstKeyValue(value, keyName) {
  if (!value || typeof value !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(value, keyName)) return value[keyName]

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findFirstKeyValue(child, keyName)
    if (found !== undefined) return found
  }

  return undefined
}

function findOptionStocks(value, productId, options = []) {
  if (!value || typeof value !== 'object') return options

  if (Object.prototype.hasOwnProperty.call(value, 'briefOrderAbleCnt')) {
    const optionId = String(value.goodsdtCode || value.itemCode || value.optionCode || value.goodsCode || options.length + 1)
    const isProductSummary = optionId === productId

    if (!isProductSummary) {
      options.push({
        optionId,
        optionName: String(value.goodsdtInfo || value.optionName || value.itemName || value.goodsName || '기본'),
        stock: parseNumber(value.briefOrderAbleCnt),
      })
    }
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    findOptionStocks(child, productId, options)
  }

  return options
}

function findAllStocks(value, options = []) {
  if (!value || typeof value !== 'object') return options

  if (Object.prototype.hasOwnProperty.call(value, 'briefOrderAbleCnt')) {
    options.push({
      optionId: String(value.goodsdtCode || value.itemCode || value.optionCode || value.goodsCode || options.length + 1),
      optionName: String(value.goodsdtInfo || value.optionName || value.itemName || value.goodsName || '기본'),
      stock: parseNumber(value.briefOrderAbleCnt),
    })
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    findAllStocks(child, options)
  }

  return options
}

function requestDetailInfo(productId) {
  const body = JSON.stringify({
    targetType: 'goods',
    targetCode: productId,
  })

  return new Promise((resolve, reject) => {
    const request = https.request(
      DETAIL_INFO_URL,
      {
        method: 'POST',
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/json;charset=UTF-8',
          'content-length': Buffer.byteLength(body),
          origin: 'https://www.shinsegaetvshopping.com',
          referer: `${DETAIL_URL}/${productId}?prePg=broadcast_tvschedule`,
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
          'x-requested-with': 'XMLHttpRequest',
        },
        rejectUnauthorized: false,
      },
      (response) => {
        let bodyText = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          bodyText += chunk
        })
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`신세계 detailInfo 요청 실패: ${response.statusCode || 'unknown'}`))
            return
          }

          try {
            resolve(JSON.parse(bodyText))
          } catch {
            reject(new Error('신세계 detailInfo JSON 파싱 실패'))
          }
        })
      },
    )

    request.setTimeout(15000, () => {
      request.destroy(new Error('신세계 detailInfo 요청 시간 초과'))
    })
    request.on('error', reject)
    request.end(body)
  })
}

function parseDetailInfo(payload, fallback) {
  const options = findOptionStocks(payload, fallback.productId)
  const allStocks = findAllStocks(payload)
  const summaryStock = allStocks.find((option) => option.optionId === fallback.productId)?.stock
  const stockFromOptions = options.reduce((sum, option) => sum + option.stock, 0)
  const totalStock = stockFromOptions || summaryStock || parseNumber(findFirstKeyValue(payload, 'briefOrderAbleCnt'))
  const name = findFirstKeyValue(payload, 'goodsName') || findFirstKeyValue(payload, 'itemName') || fallback.productName
  const price = findFirstKeyValue(payload, 'salePrice') || findFirstKeyValue(payload, 'dcPrice') || findFirstKeyValue(payload, 'goodsPrice')

  return {
    broadcaster: '신세계',
    productId: fallback.productId,
    productName: String(name || fallback.productName || fallback.productId),
    price: parseNumber(price) || fallback.price || 0,
    totalStock,
    options: options.length ? options : [{ optionId: fallback.productId, optionName: '기본', stock: totalStock }],
  }
}

function getMinuteValue(time) {
  const [hour, minute] = String(time || '00:00').split(':').map(Number)
  return hour * 60 + minute
}

function getScheduleWindow(item, now = new Date()) {
  const startMinutes = getMinuteValue(item.startTime)
  const endMinutes = getMinuteValue(item.endTime)
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)

  let startAt = dayStart.getTime() + startMinutes * 60 * 1000
  let endAt = dayStart.getTime() + endMinutes * 60 * 1000

  if (endAt <= startAt) endAt += 24 * 60 * 60 * 1000
  if (startAt - now.getTime() > 12 * 60 * 60 * 1000) {
    startAt -= 24 * 60 * 60 * 1000
    endAt -= 24 * 60 * 60 * 1000
  }

  return { startAt, endAt }
}

function isActiveAt(product, now = Date.now()) {
  return product.broadcastStartAt <= now && now < product.broadcastEndAt - endBufferMs
}

function intersectsWindow(product, windowStart, windowEnd) {
  return product.broadcastStartAt <= windowEnd && product.broadcastEndAt >= windowStart
}

function getProductSessionKey(product) {
  return `${product.productId || ''}-${product.broadcastStartAt || 0}`
}

function pruneDetailState(now = Date.now()) {
  for (const [key, product] of detailState.entries()) {
    if ((product.broadcastEndAt || 0) < now - windowMs) detailState.delete(key)
  }
}

async function mapLimit(items, limit, worker) {
  const results = []
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function getWindowProducts(scheduleItems) {
  const now = new Date()
  const windowStart = now.getTime() - windowMs
  const windowEnd = now.getTime()

  return scheduleItems
    .map((item) => {
      const { startAt, endAt } = getScheduleWindow(item, now)
      return {
        productId: String(item.id || '').trim(),
        productName: item.title || '',
        price: parseNumber(item.price),
        imageUrl: item.imageUrl || '',
        url: item.url || `${DETAIL_URL}/${item.id}`,
        timeRange: item.timeRange || '',
        broadcastStartAt: startAt,
        broadcastEndAt: endAt,
      }
    })
    .filter((product) => product.productId && intersectsWindow(product, windowStart, windowEnd))
}

function updateStats(product, snapshot) {
  const sessionKey = getProductSessionKey(product)
  const previous = detailState.get(sessionKey)
  const collectedAt = Date.now()
  const stock = snapshot.totalStock
  const price = snapshot.price || product.price || 0
  const delta = previous ? previous.lastStock - stock : 0
  const soldDelta = Math.max(delta, 0)
  const revenueDelta = soldDelta * price
  const restockDelta = Math.max(-delta, 0)
  const estimatedSold = (previous?.estimatedSold || 0) + soldDelta
  const estimatedRevenue = (previous?.estimatedRevenue || 0) + revenueDelta
  const restockQuantity = (previous?.restockQuantity || 0) + restockDelta
  const history = [
    ...(previous?.history || []),
    {
      collectedAt,
      sampleOk: true,
      active: true,
      stock,
      soldDelta,
      revenueDelta,
      price,
      estimatedSold,
      estimatedRevenue,
    },
  ].slice(-maxSnapshots)

  const next = {
    ...product,
    ...snapshot,
    currentStock: stock,
    initialStock: previous?.initialStock ?? stock,
    lastStock: stock,
    soldDelta,
    estimatedSold,
    estimatedRevenue,
    restockQuantity,
    history,
    collectedAt,
    attemptedAt: collectedAt,
    lastSuccessAt: collectedAt,
    sampleOk: true,
  }

  detailState.set(sessionKey, next)
  return next
}

export async function collectShinsegaeInventory(scheduleItems = []) {
  const attemptedAt = Date.now()
  const windowProducts = getWindowProducts(scheduleItems)
  const activeProducts = windowProducts.filter((product) => isActiveAt(product))
  const results = []
  const errors = []

  const activeResults = await mapLimit(activeProducts, detailConcurrency, async (product) => {
    try {
      const payload = await requestDetailInfo(product.productId)
      const snapshot = parseDetailInfo(payload, product)
      return updateStats(product, snapshot)
    } catch (error) {
      const previous = detailState.get(getProductSessionKey(product))
      if (previous) {
        return { ...previous, attemptedAt, sampleOk: false, error: error.message }
      }
      errors.push(`${product.productId}: ${error.message}`)
      return null
    }
  })
  results.push(...activeResults.filter(Boolean))

  for (const product of windowProducts) {
    if (activeProducts.some((activeProduct) => getProductSessionKey(activeProduct) === getProductSessionKey(product))) continue
    const previous = detailState.get(getProductSessionKey(product))
    if (previous) {
      results.push({
        ...previous,
        ...product,
        history: (previous.history || []).filter((point) => point.collectedAt >= Date.now() - windowMs),
      })
    } else {
      results.push({
        ...product,
        broadcaster: '신세계',
        totalStock: 0,
        currentStock: 0,
        initialStock: 0,
        estimatedSold: 0,
        estimatedRevenue: 0,
        restockQuantity: 0,
        soldDelta: 0,
        history: [],
        options: [],
      })
    }
  }
  pruneDetailState()
  const activeSuccesses = activeResults.filter((product) => product?.sampleOk !== false)
  const completedAt = Date.now()

  return {
    broadcaster: '신세계',
    attemptedAt,
    collectedAt: completedAt,
    lastSuccessAt: activeSuccesses.length ? Math.max(...activeSuccesses.map((product) => product.lastSuccessAt || product.collectedAt || 0)) : undefined,
    windowMinutes: maxSnapshots,
    products: results,
    error: errors.join(' / ') || undefined,
    errorCount: results.filter((product) => product.sampleOk === false).length,
    collectionMs: completedAt - attemptedAt,
    requestedCount: activeProducts.length,
    successCount: activeSuccesses.length,
    totals: results.reduce(
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
