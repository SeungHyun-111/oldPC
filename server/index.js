import http from 'node:http'
import { collectSkstoaInventory } from './skstoaInventory.js'
import { collectScheduleWithFallback, getScheduleItems } from './scheduleCollector.js'

const port = Number(process.env.OLDPC_API_PORT || 4174)

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
  })
  response.end(JSON.stringify(payload))
}

async function handleSchedule(channel, response) {
  const payload = await collectScheduleWithFallback(channel)
  sendJson(response, payload.error && payload.cacheType === 'none' ? 502 : 200, payload)
}

async function handleSkstoaInventory(response) {
  try {
    const scheduleItems = await getScheduleItems('skstoa')
    const payload = await collectSkstoaInventory(scheduleItems)
    sendJson(response, 200, payload)
  } catch (error) {
    sendJson(response, 502, {
      broadcaster: 'SK',
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

    if (request.method === 'GET' && url.pathname === '/api/skstoa/schedule') {
      handleSchedule('skstoa', response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/skstoa/inventory') {
      handleSkstoaInventory(response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/shinsegae/schedule') {
      handleSchedule('shinsegae', response)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/ktalpha/schedule') {
      handleSchedule('ktalpha', response)
      return
    }

    sendJson(response, 404, { error: 'not found' })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`oldPC API server: http://127.0.0.1:${port}`)
  })
