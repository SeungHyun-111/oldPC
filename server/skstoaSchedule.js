const SCHEDULE_URL = 'https://www.skstoa.com/tv_schedule'
const DETAIL_URL_PREFIX = 'https://www.skstoa.com/display/goods/'

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
  if (url.startsWith('/')) return `https://www.skstoa.com${url}`
  return url
}

function parseDetailUrl(block, id) {
  const detailPath = getFirstMatch(block, /goGoodsDetail\('([^']+)'\)/i)
  if (detailPath) return `${DETAIL_URL_PREFIX}${detailPath}`
  return id ? `${DETAIL_URL_PREFIX}${id}` : ''
}

function parsePrice(block, fallbackPrice) {
  const price = getFirstMatch(block, /<span class="price">\s*<span>([^<]+)<\/span>\s*원\s*<\/span>/i)
  if (price) return `${price}원`

  const number = Number(fallbackPrice)
  if (Number.isFinite(number)) return `${number.toLocaleString('ko-KR')}원`

  return ''
}

function parseProductImageUrl(block, title) {
  const playArea = block.match(/<td class="play_area">[\s\S]*?<\/td>/i)?.[0] || ''
  const playImage = getFirstMatch(playArea, /<img[^>]*class="lazyload"[^>]*data-src="([^"]+)"/i)
  if (playImage) return normalizeAssetUrl(playImage)

  const images = [...block.matchAll(/<img[^>]*class="lazyload"[^>]*data-src="([^"]+)"[^>]*alt="([^"]*)"/gi)]
  const productImage = images.find((match) => decodeEntities(match[2]) === title)?.[1] || images[0]?.[1] || ''
  return normalizeAssetUrl(productImage)
}

export function parseSchedule(html) {
  const listMatches = [...html.matchAll(/<div class="list ga-prd">/g)]
  let lastTimeRange = ''

  return listMatches
    .map((match, index) => {
      const listStart = match.index
      const nextStart = listMatches[index + 1]?.index ?? html.length
      const block = html.slice(listStart, nextStart)
      const timeRange = getFirstMatch(block, /<div class="[^"]*\btimebox\b[^"]*">([^<]+)<\/div>/i) || lastTimeRange

      if (timeRange) lastTimeRange = timeRange

      const id = getAttribute(block, 'p-id')
      const title = getAttribute(block, 'p-name')
      const brand = getAttribute(block, 'p-brand').trim()
      const rawPrice = getAttribute(block, 'p-price')
      const [startTime = '', endTime = ''] = timeRange.split('~').map((time) => time.trim())
      const imageUrl = parseProductImageUrl(block, title)

      return {
        id,
        startTime,
        endTime,
        timeRange,
        title,
        brand,
        price: parsePrice(block, rawPrice),
        imageUrl,
        url: parseDetailUrl(block, id),
      }
    })
    .filter((item) => item.id && item.title && item.timeRange)
}

export async function fetchSkstoaSchedule() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  const response = await fetch(SCHEDULE_URL, {
    signal: controller.signal,
    headers: {
      'user-agent': 'Mozilla/5.0 OldPCDashboard/0.1',
      accept: 'text/html,application/xhtml+xml',
    },
  }).finally(() => clearTimeout(timeout))

  if (!response.ok) {
    throw new Error(`SK스토아 편성표 요청 실패: ${response.status}`)
  }

  const html = await response.text()
  return parseSchedule(html)
}
