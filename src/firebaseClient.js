import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: 'AIzaSyD6niu4zNqWdapz_FWFtzpQxNueZWWeE98',
  authDomain: 'schedule-7ec7a.firebaseapp.com',
  databaseURL: 'https://schedule-7ec7a-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'schedule-7ec7a',
  storageBucket: 'schedule-7ec7a.firebasestorage.app',
  messagingSenderId: '119318348927',
  appId: '1:119318348927:web:7e94b54146419308432b4a',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const rtdb = getDatabase(firebaseApp)
export const rtdbBasePath = import.meta.env.VITE_OLDPC_RTDB_BASE_PATH || 'oldpc'
