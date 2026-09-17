const BASE_URL = 'https://www.shinsegaetvshopping.com'
const SCHEDULE_URL = `${BASE_URL}/broadcast/tvschedule-ajax`
import https from 'node:https'

function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function getAttribute(html, name) {
  const match = html.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return decodeEntities(match?.[1])
}

function getFirstMatch(html, pattern) {
  return decodeEntities(html.match(pattern)?.[1])
}

function normalizeAssetUrl(url) {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${BASE_URL}${url}`
  return url
}

function getTodayPath() {
  const now = new Date()
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
}

function parsePrice(block) {
  const bestPrice = getFirstMatch(block, /<span class="_bestPrice">([^<]+)<\/span>/i)
  const discount = getAttribute(block, 'data-gtm-item-discount')
  const price = bestPrice || discount
  return price ? `${price}원` : ''
}

function parseDetailUrl(block, goodsCode) {
  const detailPath = getFirstMatch(block, /goPage\('([^']+)'/i)
  if (detailPath) return `${BASE_URL}${detailPath}`
  return goodsCode ? `${BASE_URL}/display/detail/${goodsCode}` : ''
}

function hasVodPlayer(card) {
  return /startMainVod\s*\(/i.test(card) && /\bdata-src="https:\/\/v\.kr\.kollus\.com\//i.test(card)
}

export function parseShinsegaeSchedule(html) {
  const blockMatches = [...html.matchAll(/<dl\b[^>]*>/gi)]

  return blockMatches.flatMap((match, index) => {
    const blockStart = match.index
    const nextStart = blockMatches[index + 1]?.index ?? html.length
    const block = html.slice(blockStart, nextStart)
    const timeRange = getFirstMatch(block, /<span class="_time">([^<]+)<\/span>/i)
    const [startTime = '', endTime = ''] = timeRange.split('~').map((time) => time.trim())
    const cardMatches = [...block.matchAll(/<div class="card gtm_list_item"/g)]

    return cardMatches
      .map((cardMatch) => {
        const cardStart = cardMatch.index
        const cardEnd = block.indexOf('<div class="area-buttons">', cardStart)
        const card = block.slice(cardStart, cardEnd > cardStart ? cardEnd : undefined)
        const id = getAttribute(card, 'data-gtm-item-id')
        const title = getAttribute(card, 'data-gtm-item-name')
        const brand = getAttribute(card, 'data-gtm-item-brand')
        const imageUrl = normalizeAssetUrl(getFirstMatch(card, /<img[^>]*src="([^"]+)"/i))
        const isMainProduct = getAttribute(card, 'data-main') === 'Y'
        const hasVod = isMainProduct && hasVodPlayer(card)

        return {
          id,
          startTime,
          endTime,
          timeRange,
          title,
          brand,
          price: parsePrice(card),
          imageUrl,
          url: parseDetailUrl(card, id),
          isMainProduct,
          hasVod,
        }
      })
      .filter((item) => item.id && item.title && item.timeRange)
  })
}

export async function fetchShinsegaeSchedule(datePath = getTodayPath()) {
  const url = `${SCHEDULE_URL}?fromDate=${encodeURIComponent(datePath)}`
  const html = await fetchText(url)
  return parseShinsegaeSchedule(html)
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'user-agent': 'Mozilla/5.0 OldPCDashboard/0.1',
          accept: 'text/html,application/xhtml+xml',
          referer: `${BASE_URL}/broadcast/tvschedule`,
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
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`신세계 편성표 요청 실패: ${response.statusCode}`))
            return
          }
          resolve(body)
        })
      },
    )

    request.on('error', reject)
    request.setTimeout(15000, () => {
      request.destroy(new Error('신세계 편성표 요청 시간 초과'))
    })
  })
}
