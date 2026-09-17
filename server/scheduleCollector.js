import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchKtSchedule } from './ktSchedule.js'
import { fetchShinsegaeSchedule } from './shinsegaeSchedule.js'
import { fetchSkstoaSchedule } from './skstoaSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.join(__dirname, 'cache')

export const scheduleSlots = (process.env.SHOPPING_SCHEDULE_SLOTS || '07:00,08:00,09:00,10:00,12:00')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

export const channels = {
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

export const scheduleState = Object.fromEntries(
  Object.keys(channels).map((key) => [key, { memorySchedule: null, remoteFetchCount: 0 }]),
)

function getCachePath(channel) {
  return path.join(cacheDir, channels[channel].cacheName)
}

export async function readScheduleCache(channel) {
  try {
    return JSON.parse(await readFile(getCachePath(channel), 'utf8'))
  } catch {
    return null
  }
}

async function writeScheduleCache(channel, payload) {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(getCachePath(channel), JSON.stringify(payload, null, 2), 'utf8')
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

export function getTomorrowFirstSlot(nowDate) {
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
  return scheduleState[channel].memorySchedule?.refreshDate === dateKey
}

function shouldRefreshSchedule(channel, currentSlot, dateKey, force) {
  if (force) return true
  if (!currentSlot) return false
  return !hasRefreshedToday(channel, dateKey)
}

export async function collectSchedule(channel, options = {}) {
  const config = channels[channel]
  if (!config) throw new Error(`Unknown schedule channel: ${channel}`)

  const channelState = scheduleState[channel]
  const nowDate = new Date()
  const now = nowDate.getTime()
  const todayKey = getDateKey(nowDate)
  const timing = getScheduleTiming(nowDate)
  const cached = channelState.memorySchedule || (await readScheduleCache(channel))

  if (cached && Array.isArray(cached.items) && !channelState.memorySchedule) {
    channelState.memorySchedule = cached
  }

  if (
    !shouldRefreshSchedule(channel, timing.currentSlot, todayKey, options.force) &&
    channelState.memorySchedule &&
    Array.isArray(channelState.memorySchedule.items)
  ) {
    return {
      ...channelState.memorySchedule,
      fromCache: true,
      cacheType: 'memory',
      remoteFetchCount: channelState.remoteFetchCount,
      nextRefreshAt: hasRefreshedToday(channel, todayKey) ? getTomorrowFirstSlot(nowDate) : timing.nextRefreshAt,
      refreshSlots: scheduleSlots,
    }
  }

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
  await writeScheduleCache(channel, payload)
  return payload
}

export async function collectScheduleWithFallback(channel, options = {}) {
  try {
    return await collectSchedule(channel, options)
  } catch (error) {
    const channelState = scheduleState[channel]
    const nowDate = new Date()
    const todayKey = getDateKey(nowDate)
    const timing = getScheduleTiming(nowDate)

    if (Array.isArray(channelState?.memorySchedule?.items) && channelState.memorySchedule.items.length) {
      return {
        ...channelState.memorySchedule,
        fromCache: true,
        cacheType: 'file',
        remoteFetchCount: channelState.remoteFetchCount,
        nextRefreshAt: hasRefreshedToday(channel, todayKey) ? getTomorrowFirstSlot(nowDate) : timing.nextRefreshAt,
        refreshSlots: scheduleSlots,
        error: error.message,
      }
    }

    return {
      items: [],
      fromCache: false,
      loadedAt: null,
      cacheType: 'none',
      remoteFetchCount: channelState?.remoteFetchCount || 0,
      nextRefreshAt: timing.nextRefreshAt,
      refreshSlots: scheduleSlots,
      error: error.message,
    }
  }
}

export async function getScheduleItems(channel) {
  const channelState = scheduleState[channel]
  if (Array.isArray(channelState?.memorySchedule?.items)) return channelState.memorySchedule.items

  const cached = await readScheduleCache(channel)
  if (Array.isArray(cached?.items)) {
    channelState.memorySchedule = cached
    return cached.items
  }

  return []
}
