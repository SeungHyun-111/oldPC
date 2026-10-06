import http from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectKtInventory } from './ktInventory.js'
import { collectShinsegaeInventory } from './shinsegaeInventory.js'
import { collectSkstoaInventory } from './skstoaInventory.js'
import { collectScheduleWithFallback, getScheduleItems } from './scheduleCollector.js'

const port = Number(process.env.OLDPC_API_PORT || 4174)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inventoryDir = resolve(projectRoot, 'data', 'inventories')
const inventoryChannels = new Set(['skstoa', 'shinsegae', 'ktalpha'])

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
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  })
  response.end(JSON.stringify(payload))
}

function getInventoryFilePath(channel) {
  if (!inventoryChannels.has(channel)) throw new Error('unknown inventory channel')
  return resolve(inventoryDir, `${channel}.json`)
}

async function readRequestBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 100 * 1024 * 1024) throw new Error('request body too large')
  }
  return body
}

async function handleLocalInventoryGet(channel, request, response) {
  try {
    const text = await readFile(getInventoryFilePath(channel), 'utf8')
    sendJson(request, response, 200, JSON.parse(text))
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(request, response, 200, null)
      return
    }
    sendJson(request, response, 500, { error: error.message })
  }
}

async function handleLocalInventoryPut(channel, request, response) {
  try {
    const payload = JSON.parse(await readRequestBody(request))
    await mkdir(inventoryDir, { recursive: true })
    const targetPath = getInventoryFilePath(channel)
    const tempPath = `${targetPath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(payload)}\n`, 'utf8')
    await rename(tempPath, targetPath)
    sendJson(request, response, 200, { ok: true, path: targetPath })
  } catch (error) {
    sendJson(request, response, 500, { error: error.message })
  }
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
      windowMinutes: 120,
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
      windowMinutes: 120,
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
      windowMinutes: 120,
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
        'access-control-allow-methods': 'GET, PUT, OPTIONS',
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

    const localInventoryMatch = url.pathname.match(/^\/api\/local-inventory\/([^/]+)$/)
    if (localInventoryMatch && request.method === 'GET') {
      handleLocalInventoryGet(localInventoryMatch[1], request, response)
      return
    }

    if (localInventoryMatch && request.method === 'PUT') {
      handleLocalInventoryPut(localInventoryMatch[1], request, response)
      return
    }

    sendJson(request, response, 404, { error: 'not found' })
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`oldPC API server: http://127.0.0.1:${port}`)
  })
