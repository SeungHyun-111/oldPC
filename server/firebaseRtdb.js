import { readFile } from 'node:fs/promises'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import { collectorConfig } from './collectorConfig.js'

async function getServiceAccount() {
  return JSON.parse(await readFile(collectorConfig.serviceAccountPath, 'utf8'))
}

export async function getRtdb() {
  if (!getApps().length) {
    const serviceAccount = await getServiceAccount()
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: collectorConfig.databaseURL,
    })
  }

  return getDatabase()
}
