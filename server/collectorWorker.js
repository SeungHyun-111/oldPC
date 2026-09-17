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
let runningStartedAt = 0
let activeStep = ''
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

async function readJson(ref) {
  const snapshot = await ref.get()
  return snapshot.exists() ? snapshot.val() : null
}

function withTimeout(task, timeoutMs, label) {
  return Promise.race([
    task,
    new Promise((_, reject) => {
      setTimeout(() => {
        log(`${label} timeout fired after ${timeoutMs}ms`)
        reject(new Error(`${label} timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    }),
  ])
}

async function collectOnce(db) {
  const rootRef = db.ref(basePath)
  const schedules = {}

  for (const channel of scheduleChannels) {
    activeStep = `${channel} schedule`
    const scheduleRef = rootRef.child(`channels/${channel}/schedule`)
    log(`collecting ${activeStep}`)
    try {
      schedules[channel] = await withTimeout(collectScheduleWithFallback(channel), scheduleTimeoutMs, activeStep)
      if (schedules[channel].cacheType === 'none' && schedules[channel].error) {
        const fallback = await readJson(scheduleRef)
        if (Array.isArray(fallback?.items) && fallback.items.length) {
          schedules[channel] = {
            ...fallback,
            fromCache: true,
            cacheType: 'rtdb',
            error: schedules[channel].error,
          }
          log(`using ${channel} schedule from RTDB fallback`)
        }
      }
      await writeJson(scheduleRef, schedules[channel])
      log(`wrote ${channel} schedule ${schedules[channel].items.length} items`)
    } catch (error) {
      log(`${channel} schedule failed: ${error.message}`)
      await rootRef.child(`channels/${channel}/scheduleError`).set(getErrorPayload(error))
    }
  }

  activeStep = 'SK inventory'
  log('collecting SK inventory')
  let inventory = null
  try {
    const skScheduleItems = schedules.skstoa?.items?.length ? schedules.skstoa.items : await getScheduleItems('skstoa')
    inventory = await withTimeout(collectSkstoaInventory(skScheduleItems), inventoryTimeoutMs, 'SK inventory')
    await writeJson(rootRef.child('channels/skstoa/inventory'), inventory)
  } catch (error) {
    log(`SK inventory failed: ${error.message}`)
    await rootRef.child('channels/skstoa/inventoryError').set(getErrorPayload(error))
  }

  await rootRef.child('collector').update({
    lastSuccessAt: Date.now(),
    intervalMs,
    status: 'ok',
    channels: scheduleChannels,
  })

  if (inventory) {
    log(
      `wrote ${scheduleChannels.length} schedules, SK products ${inventory.products.length}, revenue ${Math.round(
        inventory.totals.estimatedRevenue || 0,
      ).toLocaleString('ko-KR')}원`,
    )
  } else {
    log(`wrote schedules, SK inventory unavailable this tick`)
  }
}

async function tick(db) {
  if (running) {
    const elapsedMs = Date.now() - runningStartedAt
    log(`previous collection still running at "${activeStep}" for ${Math.round(elapsedMs / 1000)}s; skipped this tick`)

    if (elapsedMs > intervalMs * 2) {
      log(`collection watchdog released stuck run at "${activeStep}"`)
      running = false
    }
    return
  }

  running = true
  runningStartedAt = Date.now()
  activeStep = 'starting'
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
    activeStep = ''
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
