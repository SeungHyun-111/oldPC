import { collectSkstoaInventory } from './skstoaInventory.js'
import { collectorConfig } from './collectorConfig.js'
import { channels, collectScheduleWithFallback, getScheduleItems } from './scheduleCollector.js'
import { getRtdb } from './firebaseRtdb.js'

const intervalMs = collectorConfig.intervalMs
const basePath = collectorConfig.rtdbBasePath
const scheduleChannels = Object.keys(channels)
const scheduleTimeoutMs = 25_000
const inventoryTimeoutMs = 45_000
let running = false
let stopped = false

function log(message) {
  console.log(`[collector ${new Date().toISOString()}] ${message}`)
}

function getErrorPayload(error) {
  return {
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    at: Date.now(),
  }
}

async function writeJson(ref, value) {
  await ref.set(JSON.parse(JSON.stringify(value)))
}

function withTimeout(task, timeoutMs, label) {
  return Promise.race([
    task,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

async function collectOnce(db) {
  const rootRef = db.ref(basePath)
  const schedules = {}

  for (const channel of scheduleChannels) {
    log(`collecting ${channel} schedule`)
    schedules[channel] = await withTimeout(collectScheduleWithFallback(channel), scheduleTimeoutMs, `${channel} schedule`)
    await writeJson(rootRef.child(`channels/${channel}/schedule`), schedules[channel])
    log(`wrote ${channel} schedule ${schedules[channel].items.length} items`)
  }

  log('collecting SK inventory')
  const inventory = await withTimeout(collectSkstoaInventory(await getScheduleItems('skstoa')), inventoryTimeoutMs, 'SK inventory')
  await writeJson(rootRef.child('channels/skstoa/inventory'), inventory)
  await rootRef.child('collector').update({
    lastSuccessAt: Date.now(),
    intervalMs,
    status: 'ok',
    channels: scheduleChannels,
  })

  log(
    `wrote ${scheduleChannels.length} schedules, SK products ${inventory.products.length}, revenue ${Math.round(
      inventory.totals.estimatedRevenue || 0,
    ).toLocaleString('ko-KR')}원`,
  )
}

async function tick(db) {
  if (running) {
    log('previous collection still running; skipped this tick')
    return
  }

  running = true
  try {
    await collectOnce(db)
  } catch (error) {
    log(`failed: ${error.message}`)
    await db.ref(`${basePath}/collector`).update({
      lastErrorAt: Date.now(),
      status: 'error',
      error: getErrorPayload(error),
    })
  } finally {
    running = false
  }
}

async function main() {
  const db = await getRtdb()
  log(`started, interval ${intervalMs}ms, RTDB path "${basePath}"`)
  const timer = setInterval(() => {
    tick(db)
  }, intervalMs)
  tick(db)

  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    log('stopped')
    process.exit(0)
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
