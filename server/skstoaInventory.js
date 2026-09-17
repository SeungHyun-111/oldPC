import https from 'node:https'

const maxSnapshots = 60
const detailState = new Map()
const windowMs = maxSnapshots * 60 * 1000
const endBufferMs = 60 * 1000

function decodeUnicodeEscapes(value) {
  if (!value) return ''
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

function parseNumber(value) {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
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

function parseSkDetail(html, fallback) {
  const selectedPrefix = `selectedOptions["${fallback.productId}"]["001"]`
  const selectedName = html.match(
    new RegExp(`${selectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.goodsName\\s*=\\s*"([^"]+)"`),
  )?.[1]
  const selectedPrice = html.match(
    new RegExp(`${selectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.goodsPrice\\s*=\\s*"([^"]+)"`),
  )?.[1]

  const options = []
  const blocks = html.split('goodsOptions.push(Object.create(null));').slice(1)

  for (const block of blocks) {
    const optionId = block.match(/goodsdtCode\s*=\s*"([^"]+)"/)?.[1]
    const optionName = block.match(/goodsdtInfo\s*=\s*"([^"]*)"/)?.[1] || block.match(/gtmDtInfo\s*=\s*"([^"]*)"/)?.[1]
    const saleGb = block.match(/saleGb\s*=\s*"([^"]+)"/)?.[1]
    const stockRaw = block.match(/briefOrderAbleCnt\s*=\s*"?([0-9]+)"?/)?.[1]

    if (!optionId || stockRaw == null) continue
    options.push({
      optionId,
      optionName: decodeUnicodeEscapes(optionName) || '기본',
      stock: Number(stockRaw),
      saleGb: saleGb || '',
    })
  }

  const totalStock = options.reduce((sum, option) => sum + option.stock, 0)

  return {
    broadcaster: 'SK',
    productId: fallback.productId,
    productName: decodeUnicodeEscapes(selectedName) || fallback.productName || fallback.productId,
    price: parseNumber(selectedPrice) || fallback.price || 0,
    totalStock,
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
  const previous = detailState.get(product.productId)
  const stock = snapshot.totalStock
  const price = snapshot.price || product.price || 0
  const delta = previous ? previous.lastStock - stock : 0
  const soldDelta = Math.max(delta, 0)
  const restockDelta = Math.max(-delta, 0)
  const estimatedSold = (previous?.estimatedSold || 0) + soldDelta
  const restockQuantity = (previous?.restockQuantity || 0) + restockDelta
  const history = [
    ...(previous?.history || []),
    {
      collectedAt: Date.now(),
      active: true,
      stock,
      soldDelta,
      estimatedSold,
      estimatedRevenue: estimatedSold * price,
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
    estimatedRevenue: estimatedSold * price,
    restockQuantity,
    history,
    collectedAt: Date.now(),
  }

  detailState.set(product.productId, next)
  return next
}

export async function collectSkstoaInventory(scheduleItems = []) {
  const windowProducts = getWindowProducts(scheduleItems)
  const activeProducts = windowProducts.filter((product) => isActiveAt(product))
  const results = []

  for (const product of activeProducts) {
    try {
      const html = await fetchText(`https://www.skstoa.com/display/goods/${product.productId}`)
      const snapshot = parseSkDetail(html, product)
      results.push(updateStats(product, snapshot))
    } catch (error) {
      const previous = detailState.get(product.productId)
      if (previous) {
        results.push({ ...previous, error: error.message })
      }
    }
  }

  for (const product of windowProducts) {
    if (activeProducts.some((activeProduct) => activeProduct.productId === product.productId)) continue
    const previous = detailState.get(product.productId)
    if (previous) {
      results.push({
        ...previous,
        ...product,
        history: (previous.history || []).filter((point) => point.collectedAt >= Date.now() - windowMs),
      })
    } else {
      results.push({
        ...product,
        broadcaster: 'SK',
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

  return {
    broadcaster: 'SK',
    collectedAt: Date.now(),
    windowMinutes: maxSnapshots,
    products: results,
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
