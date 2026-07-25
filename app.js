// ════════════════════════════════════════════════════════
// app.js — Oppstart, klubbvalg og modulkobling
// Stafettligaen — dedikert app.
// ════════════════════════════════════════════════════════

import { db } from './firebase.js';
import { naviger, visMelding, visFBFeil, registrerBeforeunload } from './ui.js';
import {
  registrerPinGetter, registrerKlubbIdGetter,
  krevAdmin as krevAdminBase,
  getErAdmin, setErAdmin, gjenopprettAdminStatus, nullstillAdmin,
  pinInput, bekreftPin, lukkPinModal,
} from './admin.js';
import { stafettligaInit } from './stafettliga.js';
import { stafettligaUIInit, visStafettligaOversikt } from './stafettliga-ui.js';
import { stafettligaSpillUIInit } from './stafettliga-spill-ui.js';

// Eksponer PIN-modal-funksjonene globalt (kalles fra inline onclick i index.html)
window.pinInput    = pinInput;
window.bekreftPin  = bekreftPin;
window.lukkPinModal = lukkPinModal;
window.visStafettligaOversikt = visStafettligaOversikt;

// ════════════════════════════════════════════════════════
// KLUBBER — samme klubbliste/PIN-oppsett som hovedappen
// ════════════════════════════════════════════════════════
const KLUBBER = {
  'pickleball-jaeren': { navn: 'Pickleball Jæren', pin: '9436', demo: false },
  'fokus-pickleball':  { navn: 'Fokus Pickleball',  pin: '4350', demo: false },
  'tsi-pickleball':    { navn: 'TSI Pickleball',    pin: '9299', demo: false },
  'loten-pickleball':  { navn: 'Løten Tennisklubb', pin: '2341', demo: false },
  'demo':              { navn: 'Demo',               pin: null,  demo: true  },
};

let aktivKlubbId = null;

function getAktivKlubb() {
  return aktivKlubbId ? (KLUBBER[aktivKlubbId] ?? null) : null;
}

function getAdminPin() {
  return getAktivKlubb()?.pin ?? null;
}

function krevAdminMedDemo(tittel, tekst, callback) {
  krevAdminBase(tittel, tekst, callback, !!getAktivKlubb()?.demo);
}
window.krevAdmin = krevAdminMedDemo;

window.byttKlubb = function (klubbId) {
  if (!klubbId || !KLUBBER[klubbId]) {
    aktivKlubbId = null;
    oppdaterKlubbUI();
    return;
  }
  const forrigeKlubbId = aktivKlubbId;
  aktivKlubbId = klubbId;
  registrerKlubbIdGetter(() => aktivKlubbId);
  registrerPinGetter(getAdminPin);

  if (forrigeKlubbId && forrigeKlubbId !== klubbId) nullstillAdmin();

  const erAdminFraForrige = gjenopprettAdminStatus();
  if (!erAdminFraForrige) setErAdmin(KLUBBER[klubbId].demo);

  oppdaterKlubbUI();
  visMelding('Klubb valgt: ' + KLUBBER[klubbId].navn);
};

function oppdaterKlubbUI() {
  const klubb = getAktivKlubb();
  const velger = document.getElementById('klubb-velger');
  if (velger && aktivKlubbId) velger.value = aktivKlubbId;
  const demoInfo = document.getElementById('demo-info');
  if (demoInfo) demoInfo.style.display = klubb?.demo ? 'block' : 'none';
  const klubbHandlinger = document.getElementById('hjem-klubb-handlinger');
  if (klubbHandlinger) klubbHandlinger.style.display = aktivKlubbId ? 'flex' : 'none';
}
window.getErAdmin = getErAdmin;

// ════════════════════════════════════════════════════════
// DEL APPEN — QR-kode + kopier lenke (hjem-skjermen)
// ════════════════════════════════════════════════════════
function renderHjemQR() {
  const container = document.getElementById('hjem-qr');
  if (!container || typeof qrcode === 'undefined') return;
  const url = location.origin + location.pathname;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
    const svg = container.querySelector('svg');
    if (svg) { svg.style.width = '160px'; svg.style.height = '160px'; svg.style.display = 'block'; }
  } catch (e) {
    console.warn('[QR] Kunne ikke generere QR-kode:', e?.message);
  }
}

window.kopierAppLenke = async function () {
  const url = location.origin + location.pathname;
  try {
    await navigator.clipboard.writeText(url);
    visMelding('Lenke kopiert!');
  } catch (e) {
    prompt('Kopier lenken manuelt:', url);
  }
};

window.visDelAppenSeksjon = function () {
  if (!aktivKlubbId) {
    visMelding('Velg klubb først for å dele appen', 'advarsel');
    return;
  }
  krevAdminMedDemo('Del appen', 'Kun admin kan vise QR-koden og lenken til appen.', () => {
    const boks = document.getElementById('del-appen-boks');
    if (boks) boks.style.display = 'block';
    renderHjemQR();
  });
};

// Lukk (og tøm) Del appen-boksen igjen hver gang man kommer til hjemskjermen —
// den skal alltid måtte åpnes på nytt med admin-PIN, ikke stå værende åpen.
document.addEventListener('sl-naviger', (e) => {
  if (e.detail?.skjerm !== 'hjem') return;
  const boks = document.getElementById('del-appen-boks');
  if (boks) boks.style.display = 'none';
  const qr = document.getElementById('hjem-qr');
  if (qr) qr.innerHTML = '';
});

// ════════════════════════════════════════════════════════
// OPPSTART
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!db) {
    visFBFeil('Firebase er ikke konfigurert. Sjekk FB_CONFIG i firebase.js.');
    return;
  }

  stafettligaInit({
    naviger,
    krevAdmin: krevAdminMedDemo,
    getAktivKlubbId: () => aktivKlubbId,
  });
  stafettligaUIInit({
    naviger,
    krevAdmin: krevAdminMedDemo,
    getAktivKlubbId: () => aktivKlubbId,
  });
  stafettligaSpillUIInit({
    naviger,
    krevAdmin: krevAdminMedDemo,
  });

  registrerBeforeunload(() => false);

  // Velg klubb automatisk hvis ?klubb=X finnes i lenken, ellers vis hjem-skjerm
  const urlParams = new URLSearchParams(location.search);
  const urlKlubbId = urlParams.get('klubb');
  if (urlKlubbId && KLUBBER[urlKlubbId]) {
    window.byttKlubb(urlKlubbId);
  } else {
    naviger('hjem');
  }
});
