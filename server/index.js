import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchKtSchedule } from './ktSchedule.js'
import { fetchShinsegaeSchedule } from './shinsegaeSchedule.js'
import { collectSkstoaInventory } from './skstoaInventory.js'
import { fetchSkstoaSchedule } from './skstoaSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.join(__dirname, 'cache')
const port = Number(process.env.OLDPC_API_PORT || 4174)
const scheduleSlots = (process.env.SHOPPING_SCHEDULE_SLOTS || '07:00,08:00,09:00,10:00,12:00')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const channels = {
  skstoa: {
    cacheName: 'skstoa-schedule-cache.json',
    fetcher: fetchSkstoaSchedule,
  },
  shinsegae: {
    cacheName: 'shinsegae-schedule-cache.json',
    fetcher: fetchShinsegaeSchedule,
  },
  ktalpha: {
    cacheName: 'ktalpha-schedule-cache.json',
    fetcher: fetchKtSchedule,
  },
}
const state = Object.fromEntries(
  Object.keys(channels).map((key) => [key, { memorySchedule: null, remoteFetchCount: 0 }]),
)

function getCachePath(channel) {
  return path.join(cacheDir, channels[channel].cacheName)
}

async function readCache(channel) {
  try {
    return JSON.parse(await readFile(getCachePath(channel), 'utf8'))
  } catch {
    return null
  }
}

async function writeCache(channel, payload) {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(getCachePath(channel), JSON.stringify(payload, null, 2), 'utf8')
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
  })
  response.end(JSON.stringify(payload))
}

function getSlotDate(baseDate, slot) {
  const [hour, minute] = slot.split(':').map(Number)
  const date = new Date(baseDate)
  date.setHours(hour, minute || 0, 0, 0)
  return date
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getTomorrowFirstSlot(nowDate) {
  return getSlotDate(
    new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1),
    scheduleSlots[0] || '07:00',
  ).getTime()
}

function getScheduleTiming(now = new Date()) {
  const todaySlots = scheduleSlots
    .map((slot) => ({ slot, date: getSlotDate(now, slot) }))
    .sort((a, b) => a.date - b.date)
  const currentSlot =
    todaySlots.find((entry) => {
      const windowEnd = new Date(entry.date)
      windowEnd.setHours(windowEnd.getHours() + 1)
      return entry.date <= now && now < windowEnd
    }) || null
  const nextTodaySlot = todaySlots.find((entry) => entry.date > now)

  return {
    currentSlot,
    nextRefreshAt: nextTodaySlot?.date.getTime() || getTomorrowFirstSlot(now),
  }
}

function hasRefreshedToday(channel, dateKey) {
  return state[channel].memorySchedule?.refreshDate === dateKey
}

function shouldRefreshSchedule(channel, currentSlot, dateKey) {
  if (!currentSlot) return false
  return !hasRefreshedToday(channel, dateKey)
}

async function handleSchedule(channel, response) {
  const config = channels[channel]
  const channelState = state[channel]
  const nowDate = new Date()
  const now = nowDate.getTime()
  const todayKey = getDateKey(nowDate)
  const timing = getScheduleTiming(nowDate)
  const cached = channelState.memorySchedule || (await readCache(channel))

  if (cached && Array.isArray(cached.items) && !channelState.memorySchedule) {
    channelState.memorySchedule = cached
  }

  if (
    !shouldRefreshSchedule(channel, timing.currentSlot, todayKey) &&
    channelState.memorySchedule &&
    Array.isArray(channelState.memorySchedule.items)
  ) {
    sendJson(response, 200, {
      ...channelState.memorySchedule,
      fromCache: true,
      cacheType: 'memory',
      remoteFetchCount: channelState.remoteFetchCount,
      nextRefreshAt: hasRefreshedToday(channel, todayKey) ? getTomorrowFirstSlot(nowDate) : timing.nextRefreshAt,
      refreshSlots: scheduleSlots,
    })
    return
  }

  try {
    const items = await config.fetcher()
    channelState.remoteFetchCount += 1
    const payload = {
      items,
      fromCache: false,
      cacheType: 'remote',
      loadedAt: now,
      slotAt: timing.currentSlot?.date.getTime() || now,
      slotLabel: timing.currentSlot?.slot || 'startup',
      refreshDate: todayKey,
      remoteFetchCount: channelState.remoteFetchCount,
      nextRefreshAt: getTomorrowFirstSlot(nowDate),
      refreshSlots: scheduleSlots,
    }
    channelState.memorySchedule = payload
    await writeCache(channel, payload)
    sendJson(response, 200, payload)
  } catch (error) {
    if (Array.isArray(channelState.memorySchedule?.items) && channelState.memorySchedule.items.length) {
      sendJson(response, 200, {
        ...channelState.memorySchedule,
        fromCache: true,
        cacheType: 'file',
        remoteFetchCount: channelState.remoteFetchCount,
        nextRefreshAt: hasRefreshedToday(channel, todayKey) ? getTomorrowFirstSlot(nowDate) : timing.nextRefreshAt,
        refreshSlots: scheduleSlots,
        error: error.message,
      })
      return
    }

    sendJson(response, 502, {
      items: [],
      fromCache: false,
      loadedAt: null,
      cacheType: 'none',
      remoteFetchCount: channelState.remoteFetchCount,
      nextRefreshAt: timing.nextRefreshAt,
      refreshSlots: scheduleSlots,
      error: error.message,
    })
  }
}

async function getScheduleForInventory(channel) {
  const channelState = state[channel]
  if (Array.isArray(channelState.memorySchedule?.items)) return channelState.memorySchedule.items

  const cached = await readCache(channel)
  if (Array.isArray(cached?.items)) {
    channelState.memorySchedule = cached
    return cached.items
  }

  return []
}

async function handleSkstoaInventory(response) {
  try {
    const scheduleItems = await getScheduleForInventory('skstoa')
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
