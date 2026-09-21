const BASE_URL = 'https://www.kshop.co.kr'
const IMAGE_BASE_URL = 'https://imgs.kshop.co.kr'
import https from 'node:https'

function getDateValue() {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
}

function formatClock(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatPrice(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return ''
  return `${number.toLocaleString('ko-KR')}원`
}

function normalizeImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('//')) return `${IMAGE_BASE_URL}${url.slice(1)}`
  if (url.startsWith('/')) return `${IMAGE_BASE_URL}${url}`
  return url
}

function getProductPrice(product) {
  return product?.priceSummary?.ecSlPc || 0
}

export function normalizeKtSchedule(payload) {
  const schedules = payload?.data?.tvScheduleList || []

  return schedules.flatMap((schedule) => {
    const startTime = formatClock(schedule.brdBgnDtm)
    const endTime = formatClock(schedule.brdClDtm)
    const timeRange = startTime && endTime ? `${startTime}~${endTime}` : ''

    return (schedule.productList || [])
      .map((product) => ({
        id: `${schedule.brdSchdId}-${product.dpPrdId}`,
        startTime,
        endTime,
        timeRange,
        title: product.prdNm || product.mobPrdNm || schedule.schdNm || '',
        brand: product.brndNm || '',
        price: formatPrice(getProductPrice(product)),
        imageUrl: normalizeImageUrl(product.rectPrdImgFlNm || product.prdImgFlNm || product.all3ImgFlNm),
        url: product.dpPrdId ? `${BASE_URL}/display/product/${product.dpPrdId}` : BASE_URL,
        isMainProduct: product.dlgPrdYn === 'Y',
      }))
      .filter((item) => item.id && item.title && item.timeRange)
  })
}

export async function fetchKtSchedule(dateValue = getDateValue()) {
  const url = `${BASE_URL}/display/web/emc/display/broadcast?broadcastType=tv&dateValue=${dateValue}`
  return normalizeKtSchedule(JSON.parse(await fetchText(url)))
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'user-agent': 'Mozilla/5.0 OldPCDashboard/0.1',
          accept: 'application/json',
          referer: `${BASE_URL}/?gnbMenuId=G000000002`,
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
            reject(new Error(`KT알파 편성표 요청 실패: ${response.statusCode}`))
            return
          }
          resolve(body)
        })
      },
    )

    request.on('error', reject)
    request.setTimeout(15000, () => {
      request.destroy(new Error('KT알파 편성표 요청 시간 초과'))
    })
  })
}
