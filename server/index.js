import http from 'node:http'
import { collectKtInventory } from './ktInventory.js'
import { collectShinsegaeInventory } from './shinsegaeInventory.js'
import { collectSkstoaInventory } from './skstoaInventory.js'
import { collectScheduleWithFallback, getScheduleItems } from './scheduleCollector.js'

const port = Number(process.env.OLDPC_API_PORT || 4174)

function getCorsOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return '*'

  try {
    const { hostname } = new URL(origin)
    if (hostname === '127.0.0.1' || hostname === 'localhost') return origin
  } catch {
    return 'null'
  }

  return 'null'
}

function sendJson(request, response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': getCorsOrigin(request),
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  })
  response.end(JSON.stringify(payload))
}

async function handleSchedule(channel, request, response) {
  const payload = await collectScheduleWithFallback(channel)
  sendJson(request, response, payload.error && payload.cacheType === 'none' ? 502 : 200, payload)
}

async function handleSkstoaInventory(request, response) {
  try {
    const scheduleItems = await getScheduleItems('skstoa')
    const payload = await collectSkstoaInventory(scheduleItems)
    sendJson(request, response, 200, payload)
  } catch (error) {
    sendJson(request, response, 502, {
      broadcaster: 'SK',
      collectedAt: Date.now(),
      windowMinutes: 60,
      products: [],
      totals: { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
      error: error.message,
    })
  }
}

async function handleShinsegaeInventory(request, response) {
  try {
    const scheduleItems = await getScheduleItems('shinsegae')
    const payload = await collectShinsegaeInventory(scheduleItems)
    sendJson(request, response, 200, payload)
  } catch (error) {
    sendJson(request, response, 502, {
      broadcaster: '신세계',
      collectedAt: Date.now(),
      windowMinutes: 60,
      products: [],
      totals: { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
      error: error.message,
    })
  }
}

async function handleKtInventory(request, response) {
  try {
    const scheduleItems = await getScheduleItems('ktalpha')
    const payload = await collectKtInventory(scheduleItems)
    sendJson(request, response, 200, payload)
  } catch (error) {
    sendJson(request, response, 502, {
      broadcaster: 'K쇼핑',
      collectedAt: Date.now(),
      windowMinutes: 60,
      products: [],
      totals: { estimatedSold: 0, estimatedRevenue: 0, soldDelta: 0, currentStock: 0 },
      error: error.message,
    })
  }
}

http
  .createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`)

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-origin': getCorsOrigin(request),
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
        vary: 'origin',
      })
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/skstoa/schedule') {
      handleSchedule('skstoa', request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/skstoa/inventory') {
      handleSkstoaInventory(request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/shinsegae/schedule') {
      handleSchedule('shinsegae', request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/shinsegae/inventory') {
      handleShinsegaeInventory(request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/ktalpha/schedule') {
      handleSchedule('ktalpha', request, response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/ktalpha/inventory') {
      handleKtInventory(request, response)
      return
    }

    sendJson(request, response, 404, { error: 'not found' })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`oldPC API server: http://127.0.0.1:${port}`)
  })
