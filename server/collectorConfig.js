import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const collectorConfig = {
  databaseURL: 'https://schedule-7ec7a-default-rtdb.asia-southeast1.firebasedatabase.app',
  serviceAccountPath: resolve(projectRoot, 'firebase-service-account.json'),
  rtdbBasePath: 'oldpc',
  intervalMs: 60_000,
}
