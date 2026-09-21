import https from 'node:https'

const BASE_URL = 'https://www.kshop.co.kr'
const maxSnapshots = 120
const detailState = new Map()
const windowMs = maxSnapshots * 60 * 1000
const endBufferMs = 60 * 1000
const stockKeys = new Set([
  'maxOrdPssQty',
  'briefOrderAbleCnt',
  'orderAbleCnt',
  'ordAbleCnt',
  'ordPsblQty',
  'orderPsblQty',
  'salePsblQty',
  'stockQty',
  'stckQty',
  'invQty',
])

function parseNumber(value) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function getKtProductId(value) {
  const parts = String(value || '').split('-')
  return parts.at(-1) || ''
}

function findFirstKeyValue(value, keyNames) {
  if (!value || typeof value !== 'object') return undefined

  for (const keyName of keyNames) {
    if (Object.prototype.hasOwnProperty.call(value, keyName)) return value[keyName]
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findFirstKeyValue(child, keyNames)
    if (found !== undefined) return found
  }

  return undefined
}

function getStockValue(value) {
  if (!value || typeof value !== 'object') return undefined

  for (const [key, stock] of Object.entries(value)) {
    if (stockKeys.has(key)) return stock
  }

  return undefined
}

function findAllStockItems(value, items = []) {
  if (!value || typeof value !== 'object') return items

  const stock = getStockValue(value)
  const children = Array.isArray(value.children) ? value.children : []
  if (stock !== undefined && !children.length) {
    items.push({
      optionId: String(value.itemCode || value.optionCode || value.optCode || value.prdOptNo || value.dpPrdId || value.prdId || items.length + 1),
      optionName: String(value.itemName || value.optionName || value.optName || value.prdOptNm || value.prdNm || '기본'),
      stock: parseNumber(stock),
    })
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    findAllStockItems(child, items)
  }

  return items
}

function getUnitOptions(unitList = [], parentName = '') {
  return unitList.flatMap((unit, index) => {
    const children = Array.isArray(unit.children) ? unit.children : []
    const unitName = String(unit.untDtlNm || unit.optionName || unit.itemName || '').trim()
    const optionName = [parentName, unitName].filter(Boolean).join(' / ') || '기본'

    if (children.length) return getUnitOptions(children, optionName)

    return [
      {
        optionId: String(unit.untSeq || unit.untDtlId || index + 1),
        optionName,
        stock: parseNumber(unit.maxOrdPssQty),
      },
    ]
  })
}

function getUnitSummaryStock(unitList = []) {
  return unitList.reduce((sum, unit) => sum + parseNumber(unit.maxOrdPssQty), 0)
}

function requestProduct(productId) {
  const url = `${BASE_URL}/display/web/emc/product/${productId}?gnbMenuId=G000000002`

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          accept: '*/*',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/json',
          'current-channel': 'alpha',
          'init-channel': 'alpha',
          referer: `${BASE_URL}/display/product/${productId}?gnbMenuId=G000000002`,
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        },
        rejectUnauthorized: false,
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`K쇼핑 상품 요청 실패: ${response.statusCode || 'unknown'}`))
            return
          }

          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error('K쇼핑 상품 JSON 파싱 실패'))
          }
        })
      },
    )

    request.setTimeout(15000, () => {
      request.destroy(new Error('K쇼핑 상품 요청 시간 초과'))
    })
    request.on('error', reject)
  })
}

function parseProduct(payload, fallback) {
  const productId = getKtProductId(fallback.productId)
  const productModel = payload?.data?.productModel || payload?.productModel || payload?.data || payload
  const targetRvo = productModel?.promotion?.targetRvo || {}
  const unitList = Array.isArray(productModel?.unitList) ? productModel.unitList : []
  const options = getUnitOptions(unitList).filter((option) => option.stock > 0)
  const allStocks = findAllStockItems(productModel)
  const summaryStock = allStocks.find((option) => option.optionId === productId)?.stock
  const stockFromOptions = options.reduce((sum, option) => sum + option.stock, 0)
  const totalStock = stockFromOptions || getUnitSummaryStock(unitList) || summaryStock || parseNumber(findFirstKeyValue(productModel, stockKeys))
  const name = productModel?.prdNm || findFirstKeyValue(productModel, ['productName', 'goodsName', 'itemName']) || fallback.productName
  const originalPrice = parseNumber(targetRvo.originalPrice)
  const slPc = parseNumber(targetRvo.slPc)

  return {
    broadcaster: 'K쇼핑',
    productId: fallback.productId,
    productName: String(name || fallback.productName || productId),
    originalPrice,
    slPc,
    price: slPc || originalPrice || 0,
    totalStock,
    options: options.length ? options : [{ optionId: productId, optionName: '기본', stock: totalStock }],
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

function getWindowProducts(scheduleItems) {
  const now = new Date()
  const windowStart = now.getTime() - windowMs
  const windowEnd = now.getTime()

  return scheduleItems
    .map((item) => {
      const { startAt, endAt } = getScheduleWindow(item, now)
      const productId = getKtProductId(item.id)
      return {
        productId: item.id,
        productName: item.title || '',
        imageUrl: item.imageUrl || '',
        url: item.url || `${BASE_URL}/display/product/${productId}`,
        timeRange: item.timeRange || '',
        broadcastStartAt: startAt,
        broadcastEndAt: endAt,
      }
    })
    .filter((product) => getKtProductId(product.productId) && intersectsWindow(product, windowStart, windowEnd))
}

function updateStats(product, snapshot) {
  const sessionKey = getProductSessionKey(product)
  const previous = detailState.get(sessionKey)
  const collectedAt = Date.now()
  const stock = snapshot.totalStock
  const price = snapshot.price || 0
  const hasPreviousProgramHistory = (previous?.history || []).some((point) => {
    const pointAt = point.collectedAt || 0
    return point.active && pointAt >= product.broadcastStartAt && pointAt < product.broadcastEndAt - endBufferMs
  })
  const rawStockDelta = hasPreviousProgramHistory ? previous.lastStock - stock : 0
  const soldDelta = Math.max(rawStockDelta, 0)
  const revenueDelta = soldDelta * price
  const restockDelta = Math.max(-rawStockDelta, 0)
  const estimatedSold = (hasPreviousProgramHistory ? previous?.estimatedSold || 0 : 0) + soldDelta
  const estimatedRevenue = (hasPreviousProgramHistory ? previous?.estimatedRevenue || 0 : 0) + revenueDelta
  const restockQuantity = (hasPreviousProgramHistory ? previous?.restockQuantity || 0 : 0) + restockDelta
  const history = [
    ...(hasPreviousProgramHistory ? previous?.history || [] : []),
    {
      collectedAt,
      sampleOk: true,
      active: true,
      stock,
      rawStockDelta,
      soldDelta,
      revenueDelta,
      price,
      estimatedSold,
      estimatedRevenue,
      restockDelta,
    },
  ].slice(-maxSnapshots)

  const next = {
    ...product,
    ...snapshot,
    currentStock: stock,
    initialStock: hasPreviousProgramHistory ? previous?.initialStock ?? stock : stock,
    lastStock: stock,
    rawStockDelta,
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

export async function collectKtInventory(scheduleItems = []) {
  const attemptedAt = Date.now()
  const windowProducts = getWindowProducts(scheduleItems)
  const activeProducts = windowProducts.filter((product) => isActiveAt(product))
  const results = []
  const errors = []
  const activeSuccesses = []

  for (const product of activeProducts) {
    try {
      const payload = await requestProduct(getKtProductId(product.productId))
      const snapshot = parseProduct(payload, product)
      const result = updateStats(product, snapshot)
      activeSuccesses.push(result)
      results.push(result)
    } catch (error) {
      const previous = detailState.get(getProductSessionKey(product))
      if (previous) {
        results.push({ ...previous, attemptedAt, sampleOk: false, error: error.message })
      } else {
        errors.push(`${product.productId}: ${error.message}`)
      }
    }
  }

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
        broadcaster: 'K쇼핑',
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
  const completedAt = Date.now()

  return {
    broadcaster: 'K쇼핑',
    attemptedAt,
    collectedAt: completedAt,
    lastSuccessAt: activeSuccesses.length ? Math.max(...activeSuccesses.map((product) => product.lastSuccessAt || product.collectedAt || 0)) : undefined,
    windowMinutes: maxSnapshots,
    products: results,
    error: errors.join(' / ') || undefined,
    errorCount: results.filter((product) => product.sampleOk === false).length,
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
