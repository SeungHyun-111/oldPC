import https from 'node:https'

const collectionWindowMinutes = 120
const historyRetentionMs = 14 * 24 * 60 * 60 * 1000
const detailState = new Map()
const windowMs = collectionWindowMinutes * 60 * 1000
const endBufferMs = 60 * 1000
const outlierRevenueThreshold = 30_000_000

function decodeUnicodeEscapes(value) {
  if (!value) return ''
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function parseNumber(value) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function findOrderAbleOptions(value, options = []) {
  if (!value || typeof value !== 'object') return options

  if (Object.prototype.hasOwnProperty.call(value, 'goodsdtCode') && Object.prototype.hasOwnProperty.call(value, 'orderAbleQty')) {
    options.push({
      optionId: String(value.goodsdtCode || ''),
      optionName: decodeUnicodeEscapes(value.goodsdtInfo || value.formName || ''),
      orderAbleQty: parseNumber(value.orderAbleQty),
      tmwDelyOrderAbleCnt: parseNumber(value.tmwDelyOrderAbleCnt),
      saleGb: value.saleGb || '',
    })
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') findOrderAbleOptions(child, options)
  }

  return options
}

function parseJsonOptionOrderAbleMap(html) {
  const rawJson = html.match(/var\s+jsonOptionColorList\s*=\s*JSON\.parse\('([\s\S]*?)'\);/)?.[1]
  if (!rawJson) return new Map()

  try {
    const parsed = JSON.parse(rawJson)
    return new Map(findOrderAbleOptions(parsed).filter((option) => option.optionId).map((option) => [option.optionId, option]))
  } catch {
    return new Map()
  }
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          referer: 'https://www.skstoa.com/tv_schedule',
        },
      },
      (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          response.resume()
          reject(new Error(`SK detail ${response.statusCode || 'failed'}`))
          return
        }

        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve(body))
      },
    )

    request.setTimeout(15000, () => {
      request.destroy(new Error('SK detail timeout'))
    })
    request.on('error', reject)
  })
}

async function fetchJson(url) {
  const text = await fetchText(url)
  return JSON.parse(text)
}

async function fetchEmpPriceMap(products) {
  const goodsCodes = [...new Set(products.map((product) => product.productId).filter(Boolean))]
  if (!goodsCodes.length) return new Map()

  const url = `https://www.skstoa.com/goods-search/empPriceSearch?goodsCodes=${encodeURIComponent(goodsCodes.join(','))}&dealCodes=`
  const payload = await fetchJson(url)
  if (String(payload?.code) !== '200' || !Array.isArray(payload.emPriceList)) {
    throw new Error(`SK empPriceSearch ${payload?.code || 'failed'}`)
  }

  return new Map(payload.emPriceList.map((item) => [String(item.goodsCode || ''), item]))
}

function parseSkEmpPrice(item, fallback) {
  const stock = parseNumber(item?.orderAbleQty)
  const price = parseNumber(item?.emPrice || item?.salePrice || fallback.price)

  return {
    broadcaster: 'SK',
    productId: fallback.productId,
    productName: fallback.productName || fallback.productId,
    price,
    totalStock: stock,
    totalBriefOrderAbleCnt: stock,
    totalOrderAbleQty: stock,
    totalTmwDelyOrderAbleCnt: 0,
    stockSource: 'empPriceSearch.orderAbleQty',
    options: [
      {
        optionId: fallback.productId,
        optionName: '상품합계',
        stock,
        briefOrderAbleCnt: stock,
        orderAbleQty: stock,
        tmwDelyOrderAbleCnt: 0,
        saleGb: stock > 0 ? '00' : '',
      },
    ],
  }
}

function parseSkDetail(html, fallback) {
  const selectedPrefix = `selectedOptions["${fallback.productId}"]["001"]`
  const escapedSelectedPrefix = selectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const selectedName = html.match(
    new RegExp(`${escapedSelectedPrefix}\\.goodsName\\s*=\\s*"([^"]+)"`),
  )?.[1]
  const selectedPrice = html.match(
    new RegExp(`${escapedSelectedPrefix}\\.goodsPrice\\s*=\\s*"?([\\d.,]+)"?`),
  )?.[1]
  const goodsSalePrice = html.match(/var\s+goodsSalePrice\s*=\s*Number\("([^"]+)"\)/)?.[1]

  const options = []
  const orderAbleByOptionId = parseJsonOptionOrderAbleMap(html)
  const blocks = html.split('goodsOptions.push(Object.create(null));').slice(1)

  for (const block of blocks) {
    const optionId = block.match(/goodsdtCode\s*=\s*"([^"]+)"/)?.[1]
    const optionName = block.match(/goodsdtInfo\s*=\s*"([^"]*)"/)?.[1] || block.match(/gtmDtInfo\s*=\s*"([^"]*)"/)?.[1]
    const saleGb = block.match(/saleGb\s*=\s*"([^"]+)"/)?.[1]
    const briefOrderAbleCntRaw = block.match(/briefOrderAbleCnt\s*=\s*"?([0-9]+)"?/)?.[1]
    const tmwDelyOrderAbleCntRaw = block.match(/tmwDelyOrderAbleCnt\s*=\s*"?([0-9]+)"?/)?.[1]
    const orderAbleOption = orderAbleByOptionId.get(optionId)

    if (!optionId || (briefOrderAbleCntRaw == null && !orderAbleOption)) continue
    const briefOrderAbleCnt = parseNumber(briefOrderAbleCntRaw)
    const orderAbleQty = orderAbleOption ? orderAbleOption.orderAbleQty : briefOrderAbleCnt
    const tmwDelyOrderAbleCnt = orderAbleOption ? orderAbleOption.tmwDelyOrderAbleCnt : parseNumber(tmwDelyOrderAbleCntRaw)
    options.push({
      optionId,
      optionName: decodeUnicodeEscapes(optionName) || '기본',
      stock: orderAbleQty,
      briefOrderAbleCnt,
      orderAbleQty,
      tmwDelyOrderAbleCnt,
      saleGb: saleGb || '',
    })
  }

  const totalStock = options.reduce((sum, option) => sum + option.orderAbleQty, 0)
  const totalBriefOrderAbleCnt = options.reduce((sum, option) => sum + option.briefOrderAbleCnt, 0)
  const totalTmwDelyOrderAbleCnt = options.reduce((sum, option) => sum + option.tmwDelyOrderAbleCnt, 0)

  return {
    broadcaster: 'SK',
    productId: fallback.productId,
    productName: decodeUnicodeEscapes(selectedName) || fallback.productName || fallback.productId,
    price: parseNumber(selectedPrice || goodsSalePrice),
    totalStock,
    totalBriefOrderAbleCnt,
    totalOrderAbleQty: totalStock,
    totalTmwDelyOrderAbleCnt,
    options,
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
    if ((product.broadcastEndAt || 0) < now - historyRetentionMs) detailState.delete(key)
  }
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
        url: item.url || `https://www.skstoa.com/display/goods/${item.id}`,
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
  const briefStock = snapshot.totalBriefOrderAbleCnt ?? stock
  const orderAbleStock = snapshot.totalOrderAbleQty ?? stock
  const tmwDelyStock = snapshot.totalTmwDelyOrderAbleCnt ?? 0
  const price = snapshot.price || 0
  const hasPreviousProgramHistory = (previous?.history || []).some((point) => {
    const pointAt = point.collectedAt || 0
    return point.active && pointAt >= product.broadcastStartAt && pointAt < product.broadcastEndAt - endBufferMs
  })
  const rawStockDelta = hasPreviousProgramHistory ? previous.lastStock - stock : 0
  const rawSoldDelta = Math.max(rawStockDelta, 0)
  const rawRevenueDelta = rawSoldDelta * price
  const outlierAppliedYn = rawRevenueDelta >= outlierRevenueThreshold ? 'Y' : 'N'
  const soldDelta = outlierAppliedYn === 'Y' ? 0 : rawSoldDelta
  const revenueDelta = outlierAppliedYn === 'Y' ? 0 : rawRevenueDelta
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
      stockBriefOrderAbleCnt: briefStock,
      stockOrderAbleQty: orderAbleStock,
      stockTmwDelyOrderAbleCnt: tmwDelyStock,
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
    },
  ].filter((point) => (point.collectedAt || collectedAt) >= collectedAt - historyRetentionMs)

  const next = {
    ...product,
    ...snapshot,
    currentStock: stock,
    initialStock: hasPreviousProgramHistory ? previous?.initialStock ?? stock : stock,
    lastStock: stock,
    rawStockDelta,
    rawSoldDelta,
    rawRevenueDelta,
    soldDelta,
    outlierAppliedYn,
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

export async function collectSkstoaInventory(scheduleItems = []) {
  const attemptedAt = Date.now()
  const windowProducts = getWindowProducts(scheduleItems)
  const activeProducts = windowProducts.filter((product) => isActiveAt(product))
  const results = []
  const errors = []
  const activeSuccesses = []
  let empPriceMap = new Map()

  try {
    empPriceMap = await fetchEmpPriceMap(activeProducts)
  } catch (error) {
    if (activeProducts.length) errors.push(`empPriceSearch: ${error.message}`)
  }

  for (const product of activeProducts) {
    try {
      const empPrice = empPriceMap.get(product.productId)
      const snapshot = empPrice
        ? parseSkEmpPrice(empPrice, product)
        : parseSkDetail(await fetchText(`https://www.skstoa.com/display/goods/${product.productId}`), product)
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
        history: (previous.history || []).filter((point) => point.collectedAt >= Date.now() - historyRetentionMs),
      })
    } else {
      results.push({
        ...product,
        broadcaster: 'SK',
        totalStock: 0,
        totalBriefOrderAbleCnt: 0,
        totalOrderAbleQty: 0,
        totalTmwDelyOrderAbleCnt: 0,
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
    broadcaster: 'SK',
    attemptedAt,
    collectedAt: completedAt,
    lastSuccessAt: activeSuccesses.length ? Math.max(...activeSuccesses.map((product) => product.lastSuccessAt || product.collectedAt || 0)) : undefined,
    windowMinutes: collectionWindowMinutes,
    retentionDays: 14,
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
