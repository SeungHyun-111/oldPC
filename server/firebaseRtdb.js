import { readFile } from 'node:fs/promises'
import admin from 'firebase-admin'

async function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(await readFile(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'))
  }

  return null
}

export async function getRtdb() {
  if (!process.env.FIREBASE_DATABASE_URL) {
    throw new Error('FIREBASE_DATABASE_URL is required')
  }

  if (!admin.apps.length) {
    const serviceAccount = await getServiceAccount()
    admin.initializeApp({
      credential: serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    })
  }

  return admin.database()
}
