// ════════════════════════════════════════════════════════
// firebase.js — Firebase-oppsett og delte samlingsreferanser
// ════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, setDoc,
  getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ════════════════════════════════════════════════════════
// MILJØ — bytt mellom 'prod' og 'test'
// ════════════════════════════════════════════════════════
const BRUK_MILJO = 'prod'; // 'prod' | 'test'

const FB_CONFIG_PROD = {
  apiKey:            'AIzaSyB_0rxDzHpV2HB6JdHm8SEHoGc8vE2F_rE',
  authDomain:        'pickle-rank-5fbe5.firebaseapp.com',
  projectId:         'pickle-rank-5fbe5',
  storageBucket:     'pickle-rank-5fbe5.firebasestorage.app',
  messagingSenderId: '761601873916',
  appId:             '1:761601873916:web:f3c13d21e809658fd80479',
};

const FB_CONFIG_TEST = {
  apiKey:            'AIzaSyByUGIQJwohLKWB2x7_qqOMWdi965Ph7ZE',
  authDomain:        'pickle-rank-test.firebaseapp.com',
  projectId:         'pickle-rank-test',
  storageBucket:     'pickle-rank-test.firebasestorage.app',
  messagingSenderId: '491693932367',
  appId:             '1:491693932367:web:b3c13902ef6adb981dcf3a',
};

const FB_CONFIG = BRUK_MILJO === 'test' ? FB_CONFIG_TEST : FB_CONFIG_PROD;

if (BRUK_MILJO === 'test') {
  console.log(`[Firebase] Miljø: ${BRUK_MILJO.toUpperCase()} (${FB_CONFIG.projectId})`);
}

// ════════════════════════════════════════════════════════
// SAMLINGSREFERANSER
// ════════════════════════════════════════════════════════
export const SAM = {
  SPILLERE:                'players',           // lesetilgang for spillervelgeren, ingen skriving herfra
  STAFETTLIGA_SESONGER:    'stafettligaSesonger',
  STAFETTLIGA_LAGKAMPER:   'stafettligaLagkamper',
  STAFETTLIGA_BONUSKAMPER: 'stafettligaBonuskamper',
};

// ════════════════════════════════════════════════════════
// FIREBASE INIT
// ════════════════════════════════════════════════════════
let db;
try {
  const fbApp = initializeApp(FB_CONFIG);
  db = getFirestore(fbApp);
} catch (e) {
  console.error('[Firebase] Kunne ikke koble til:', e?.message ?? e);
}

export { db };

export {
  collection, doc, addDoc, updateDoc, setDoc,
  getDoc, getDocs, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, runTransaction,
};
