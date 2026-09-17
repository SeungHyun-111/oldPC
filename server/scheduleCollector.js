import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchKtSchedule } from './ktSchedule.js'
import { fetchShinsegaeSchedule } from './shinsegaeSchedule.js'
import { fetchSkstoaSchedule } from './skstoaSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.join(__dirname, 'cache')
const scheduleCacheVersion = 3

export const scheduleSlots = ['hourly']

export const channels = {
  skstoa: {
    cacheName: 'skstoa-schedule-cache.json',
    fetcher: fetchSkstoaSchedule,
    cacheVersion: scheduleCacheVersion,
  },
  shinsegae: {
    cacheName: 'shinsegae-schedule-cache.json',
    fetcher: fetchShinsegaeSchedule,
    cacheVersion: scheduleCacheVersion,
  },
  ktalpha: {
    cacheName: 'ktalpha-schedule-cache.json',
    fetcher: fetchKtSchedule,
    cacheVersion: scheduleCacheVersion,
  },
}

export const scheduleState = Object.fromEntries(
  Object.keys(channels).map((key) => [
    key,
    { memorySchedule: null, remoteFetchCount: 0, lastRefreshAttemptKey: '', lastRefreshError: '' },
  ]),
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

function getHourStart(date) {
  const hourStart = new Date(date)
  hourStart.setMinutes(0, 0, 0)
  return hourStart
}

function getNextHourStart(date) {
  const nextHour = getHourStart(date)
  nextHour.setHours(nextHour.getHours() + 1)
  return nextHour
}

function getDateHourKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    + `-${String(date.getHours()).padStart(2, '0')}`
}

export function getTomorrowFirstSlot(nowDate) {
  return getNextHourStart(nowDate).getTime()
}

function getScheduleTiming(now = new Date()) {
  const hourStart = getHourStart(now)

  return {
    currentSlot: { slot: `${String(hourStart.getHours()).padStart(2, '0')}:00`, date: hourStart },
    nextRefreshAt: getNextHourStart(now).getTime(),
  }
}

function hasRefreshedThisHour(channel, dateHourKey) {
  return scheduleState[channel].memorySchedule?.refreshHour === dateHourKey
}

function shouldRefreshSchedule(channel, currentSlot, dateHourKey, force) {
  if (force) return true
  if (!currentSlot) return false
  const channelState = scheduleState[channel]
  return !hasRefreshedThisHour(channel, dateHourKey) && channelState.lastRefreshAttemptKey !== dateHourKey
}

function isScheduleCacheCompatible(channel, payload) {
  if (!payload || !Array.isArray(payload.items)) return false
  const expectedCacheVersion = channels[channel]?.cacheVersion
  if (expectedCacheVersion && payload.cacheVersion !== expectedCacheVersion) return false
  if (channel !== 'shinsegae') return true
  if (!payload.items.length) return true
  return payload.items.some((item) => Object.hasOwn(item, 'isMainProduct'))
}

export async function collectSchedule(channel, options = {}) {
  const config = channels[channel]
  if (!config) throw new Error(`Unknown schedule channel: ${channel}`)

  const channelState = scheduleState[channel]
  const nowDate = new Date()
  const now = nowDate.getTime()
  const hourKey = getDateHourKey(nowDate)
  const timing = getScheduleTiming(nowDate)
  const cached = channelState.memorySchedule || (await readScheduleCache(channel))
  const cacheCompatible = isScheduleCacheCompatible(channel, cached)

  if (cacheCompatible && !channelState.memorySchedule) {
    channelState.memorySchedule = cached
  }

  if (
    !shouldRefreshSchedule(channel, timing.currentSlot, hourKey, options.force) &&
    channelState.memorySchedule &&
    isScheduleCacheCompatible(channel, channelState.memorySchedule)
  ) {
    return {
      ...channelState.memorySchedule,
      fromCache: true,
      cacheType: 'memory',
      remoteFetchCount: channelState.remoteFetchCount,
      nextRefreshAt: timing.nextRefreshAt,
      refreshSlots: scheduleSlots,
      ...(channelState.lastRefreshError ? { error: channelState.lastRefreshError } : {}),
    }
  }

  if (!shouldRefreshSchedule(channel, timing.currentSlot, hourKey, options.force) && !channelState.memorySchedule) {
    throw new Error(channelState.lastRefreshError || '편성표 수집 대기 중')
  }

  channelState.lastRefreshAttemptKey = hourKey
  const items = await config.fetcher()
  channelState.remoteFetchCount += 1
  channelState.lastRefreshError = ''
  const payload = {
    items,
    cacheVersion: config.cacheVersion,
    fromCache: false,
    cacheType: 'remote',
    loadedAt: now,
    slotAt: timing.currentSlot?.date.getTime() || now,
    slotLabel: timing.currentSlot?.slot || 'startup',
    refreshHour: hourKey,
    remoteFetchCount: channelState.remoteFetchCount,
    nextRefreshAt: timing.nextRefreshAt,
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
    const hourKey = getDateHourKey(nowDate)
    const timing = getScheduleTiming(nowDate)
    channelState.lastRefreshAttemptKey = hourKey
    channelState.lastRefreshError = error.message

    if (Array.isArray(channelState?.memorySchedule?.items) && channelState.memorySchedule.items.length) {
      return {
        ...channelState.memorySchedule,
        fromCache: true,
        cacheType: 'file',
        remoteFetchCount: channelState.remoteFetchCount,
        nextRefreshAt: timing.nextRefreshAt,
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
  if (isScheduleCacheCompatible(channel, cached)) {
    channelState.memorySchedule = cached
    return cached.items
  }

  return []
}
