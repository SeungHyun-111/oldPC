import { collectSkstoaInventory } from './skstoaInventory.js'
import { collectorConfig } from './collectorConfig.js'
import { channels, collectScheduleWithFallback, getScheduleItems } from './scheduleCollector.js'
import { getRtdb } from './firebaseRtdb.js'

const intervalMs = collectorConfig.intervalMs
const basePath = collectorConfig.rtdbBasePath
const scheduleChannels = Object.keys(channels)
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

async function collectOnce(db) {
  const rootRef = db.ref(basePath)
  const schedules = {}

  for (const channel of scheduleChannels) {
    schedules[channel] = await collectScheduleWithFallback(channel)
    await writeJson(rootRef.child(`channels/${channel}/schedule`), schedules[channel])
  }

  const inventory = await collectSkstoaInventory(await getScheduleItems('skstoa'))
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
  await tick(db)

  const timer = setInterval(() => {
    tick(db)
  }, intervalMs)

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
