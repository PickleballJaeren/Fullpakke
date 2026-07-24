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
  visStafettligaOversikt();
};

function oppdaterKlubbUI() {
  const klubb = getAktivKlubb();
  const velger = document.getElementById('klubb-velger');
  if (velger && aktivKlubbId) velger.value = aktivKlubbId;
  const demoInfo = document.getElementById('demo-info');
  if (demoInfo) demoInfo.style.display = klubb?.demo ? 'block' : 'none';
}
window.getErAdmin = getErAdmin;

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
