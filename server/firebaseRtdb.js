import { readFile } from 'node:fs/promises'
import admin from 'firebase-admin'
import { collectorConfig } from './collectorConfig.js'

async function getServiceAccount() {
  return JSON.parse(await readFile(collectorConfig.serviceAccountPath, 'utf8'))
}

export async function getRtdb() {
  if (!admin.apps.length) {
    const serviceAccount = await getServiceAccount()
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: collectorConfig.databaseURL,
    })
  }

  return admin.database()
}
