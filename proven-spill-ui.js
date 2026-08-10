// ════════════════════════════════════════════════════════
// proven-spill-ui.js — Live puljespill- og sluttspillregistrering
// Oversikt/oppsett/arkiv ligger i proven-ui.js.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding } from './ui.js';
import { renderTomTilstand } from './render-helpers.js';
import {
  hentProvenEvent, hentPuljerForEvent, hentPulje,
  registrerPuljeKampResultat, overstyrPuljerangering, erPuljespillFerdig,
  startSluttspill, hentSluttspillForEvent, registrerSluttspillDelkamp,
  avsluttProvenEvent, trengerTredjeDelkamp, beregnSerieStatus,
  FINALE_DISIPLIN_REKKEFOLGE,
} from './proven.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger   = () => {};
let _krevAdmin = () => {};

export function provenSpillUIInit(deps) {
  _naviger   = deps.naviger;
  _krevAdmin = deps.krevAdmin;
}

let _event          = null;
let _puljer          = [];   // 4 puljedokumenter for gjeldende event
let _navnMap         = {};   // { spillerId: navn }
let _aktivPuljeFane  = 'A';
let _sluttspill       = null;

const DISIPLIN_NAVN = { pickleball: 'Pickleball', skyball: 'Skyball', speedminton: 'Speedminton' };
const DISIPLIN_IKON = { pickleball: '🎾', skyball: '🏸', speedminton: '🏐' };
function disiplinNavn(d) { return DISIPLIN_NAVN[d] ?? d; }

// ════════════════════════════════════════════════════════
// PULJESPILL
// ════════════════════════════════════════════════════════
export async function visProvenPuljespill(eventId) {
  _naviger('proven-puljespill');
  _event  = await hentProvenEvent(eventId);
  _puljer = await hentPuljerForEvent(eventId);
  _navnMap = {};
  _event.spillere.forEach(s => { _navnMap[s.id] = s.navn; });

  const tittelEl = document.getElementById('proven-puljespill-tittel');
  if (tittelEl) tittelEl.textContent = _event.navn;

  _aktivPuljeFane = _puljer[0]?.navn ?? 'A';
  renderPuljeFaner();
  await renderAktivPuljeFane();
}
window.visProvenPuljespill = visProvenPuljespill;

function renderPuljeFaner() {
  const container = document.getElementById('proven-pulje-faner');
  if (!container) return;
  container.innerHTML = _puljer.map(p => `
    <div class="sl-fase-fane ${p.navn === _aktivPuljeFane ? 'aktiv' : ''}" onclick="window.byttProvenPuljeFane?.('${p.navn}')">
      Pulje ${p.navn}
    </div>
  `).join('');
}

window.byttProvenPuljeFane = async function (navn) {
  _aktivPuljeFane = navn;
  renderPuljeFaner();
  await renderAktivPuljeFane();
};

async function renderAktivPuljeFane() {
  const container = document.getElementById('proven-puljespill-innhold');
  if (!container) return;
  const pulje = _puljer.find(p => p.navn === _aktivPuljeFane);
  if (!pulje) { container.innerHTML = renderTomTilstand('Fant ikke puljen.'); return; }

  let sluttspillKnapp = '';
  if (_event.status === 'puljespill') {
    const alleFerdig = await erPuljespillFerdig(_event.id);
    if (alleFerdig) {
      sluttspillKnapp = `
        <div class="sl-regel-boks" style="margin-top:14px">
          Alle puljekamper i alle ${_puljer.length} puljer er registrert.
          <button class="knapp knapp-primaer" style="width:100%;margin-top:10px" onclick="window.startProvenSluttspillUI?.()">
            Admin: Start sluttspill
          </button>
        </div>`;
    }
  }

  container.innerHTML = `
    <button class="knapp knapp-omriss knapp-liten" style="margin-bottom:12px" onclick="window.visProvenPuljeTabell?.('${pulje.id}')">
      📊 Se puljetabell
    </button>
    ${renderPuljeRunder(pulje)}
    ${sluttspillKnapp}
  `;
}

function renderPuljeRunder(pulje) {
  let html = '';
  for (let runde = 1; runde <= 4; runde++) {
    const r = pulje.runder[`runde${runde}`];
    html += `<div class="seksjon-etikett">Runde ${runde}</div>`;
    if (r.hviler) {
      html += `<div class="pv-hviler-kort">💤 Pulje ${escHtml(pulje.navn)} hviler denne runden</div>`;
      continue;
    }
    html += `<div class="pv-disiplin-merke" style="margin-bottom:8px">${DISIPLIN_IKON[r.disiplin] ?? ''} ${escHtml(disiplinNavn(r.disiplin))}</div>`;
    for (const kampKey of Object.keys(r.kamper)) {
      html += renderPuljeKampKort(pulje, runde, kampKey, r.kamper[kampKey]);
    }
  }
  return html;
}

function renderPuljeKampKort(pulje, runde, kampKey, kamp) {
  const navn1 = _navnMap[kamp.par[0]] ?? '?';
  const navn2 = _navnMap[kamp.par[1]] ?? '?';
  const idSuffix = `${pulje.id}_${runde}_${kampKey}`;
  const statusBadge = kamp.ferdig ? '<span class="sl-bekreft-status sl-bekreft-ok">✓ Registrert</span>' : '';

  return `
    <div class="sl-delkamp-kort">
      <div class="sl-delkamp-tittel"><span>Bane ${kamp.baneNr}</span>${statusBadge}</div>
      <div class="sl-par-rad"><span class="sl-navn">${escHtml(navn1)}</span></div>
      <div class="sl-mot">mot</div>
      <div class="sl-par-rad"><span class="sl-navn">${escHtml(navn2)}</span></div>
      <div class="sl-poeng-rad">
        <input id="pv-p1-${idSuffix}" class="sl-poeng-input" type="number" min="0" inputmode="numeric"
               value="${kamp.poeng1 ?? ''}" placeholder="0">
        <div style="color:var(--muted2)">–</div>
        <input id="pv-p2-${idSuffix}" class="sl-poeng-input" type="number" min="0" inputmode="numeric"
               value="${kamp.poeng2 ?? ''}" placeholder="0">
      </div>
      <button class="knapp knapp-primaer" style="width:100%;margin-top:10px"
              onclick="window.lagreProvenPuljeKamp?.('${pulje.id}', ${runde}, '${kampKey}')">
        ${kamp.ferdig ? 'Oppdater resultat' : 'Lagre resultat'}
      </button>
    </div>`;
}

window.lagreProvenPuljeKamp = async function (puljeId, runde, kampKey) {
  const idSuffix = `${puljeId}_${runde}_${kampKey}`;
  const p1 = parseInt(document.getElementById(`pv-p1-${idSuffix}`)?.value, 10);
  const p2 = parseInt(document.getElementById(`pv-p2-${idSuffix}`)?.value, 10);
  try {
    await registrerPuljeKampResultat(puljeId, runde, kampKey, p1, p2);
    _puljer = await hentPuljerForEvent(_event.id);
    await renderAktivPuljeFane();
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

// Tilbake-knappen på puljespill-skjermen går til oversikten.
window.tilbakeFraProvenPuljespill = function () {
  window.visProvenOversikt?.();
};

// ════════════════════════════════════════════════════════
// PULJETABELL-MODAL (m/ admin-overstyring)
// ════════════════════════════════════════════════════════
window.visProvenPuljeTabell = async function (puljeId) {
  const modal     = document.getElementById('modal-proven-tabell');
  const container = document.getElementById('proven-tabell-innhold');
  if (!modal || !container) return;
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';
  modal.style.display = 'flex';

  try {
    const pulje = await hentPulje(puljeId);
    renderPuljeTabellModal(pulje);
  } catch (e) {
    container.innerHTML = renderTomTilstand('Kunne ikke laste tabell: ' + e.message);
  }
};

function renderPuljeTabellModal(pulje) {
  const container = document.getElementById('proven-tabell-innhold');
  const rows = (pulje.tabell || []).map(r => `
    <div class="sl-tabell-rad">
      <div class="sl-tabell-plass">${r.plass}</div>
      <div class="sl-tabell-navn">${escHtml(_navnMap[r.spillerId] ?? '?')}</div>
      ${r.manuell
        ? '<span style="font-size:12px;color:var(--yellow)">manuell</span>'
        : `<div class="sl-tabell-prosent">${(r.poengprosent ?? 0).toFixed(1)}%</div><div class="sl-tabell-poeng">${r.poeng ?? ''}</div>`}
    </div>
  `).join('');

  container.innerHTML = `
    ${rows || renderTomTilstand('Ingen resultater registrert ennå.')}
    <button class="knapp knapp-omriss" style="width:100%;margin-top:12px" onclick="window.krevAdminOverstyrPuljerangering?.('${pulje.id}')">
      Admin: Overstyr rangering
    </button>
    ${pulje.manuellRekkefolge
      ? `<button class="knapp knapp-omriss" style="width:100%;margin-top:8px" onclick="window.fjernProvenOverstyring?.('${pulje.id}')">Fjern overstyring</button>`
      : ''}
  `;
}

window.krevAdminOverstyrPuljerangering = function (puljeId) {
  _krevAdmin('Overstyr rangering', 'Skriv inn ny rekkefølge — 4 navn, kommaseparert, best først.', () => {
    (async () => {
      const pulje = await hentPulje(puljeId);
      const forslag = (pulje.tabell || []).map(r => _navnMap[r.spillerId]).join(', ');
      const svar = prompt('Rekkefølge (kommaseparert navn, best først):', forslag);
      if (svar === null) return;
      const navnListe = svar.split(',').map(n => n.trim()).filter(Boolean);
      const idListe = navnListe.map(navn => Object.keys(_navnMap).find(id => _navnMap[id] === navn));
      if (idListe.length !== 4 || idListe.some(id => !id) || new Set(idListe).size !== 4) {
        visMelding('Kunne ikke tolke alle 4 navn riktig — sjekk stavemåte og prøv igjen.', 'feil');
        return;
      }
      try {
        await overstyrPuljerangering(puljeId, idListe);
        renderPuljeTabellModal(await hentPulje(puljeId));
        _puljer = await hentPuljerForEvent(_event.id);
      } catch (e) {
        visMelding(e.message, 'feil');
      }
    })();
  });
};

window.fjernProvenOverstyring = function (puljeId) {
  _krevAdmin('Fjern overstyring', 'Går tilbake til automatisk rangering.', () => {
    (async () => {
      try {
        await overstyrPuljerangering(puljeId, null);
        renderPuljeTabellModal(await hentPulje(puljeId));
        _puljer = await hentPuljerForEvent(_event.id);
      } catch (e) {
        visMelding(e.message, 'feil');
      }
    })();
  });
};

window.lukkProvenTabellModal = function () {
  const modal = document.getElementById('modal-proven-tabell');
  if (modal) modal.style.display = 'none';
};

// ════════════════════════════════════════════════════════
// SLUTTSPILL
// ════════════════════════════════════════════════════════
window.startProvenSluttspillUI = function () {
  _krevAdmin('Start sluttspill', 'Genererer kvartfinaler basert på puljetabellene. Puljespillet låses etter dette.', () => {
    (async () => {
      try {
        await startSluttspill(_event.id);
        window.visProvenSluttspill?.(_event.id);
      } catch (e) {
        visMelding(e.message, 'feil');
      }
    })();
  });
};

export async function visProvenSluttspill(eventId) {
  _naviger('proven-sluttspill');
  _event = await hentProvenEvent(eventId);
  _navnMap = {};
  _event.spillere.forEach(s => { _navnMap[s.id] = s.navn; });
  _sluttspill = await hentSluttspillForEvent(eventId);

  const tittelEl = document.getElementById('proven-sluttspill-tittel');
  if (tittelEl) tittelEl.textContent = _event.navn;

  renderSluttspill();
}
window.visProvenSluttspill = visProvenSluttspill;

function spillerNavn(id) { return id ? (_navnMap[id] ?? '?') : 'Venter …'; }

function renderSerieKort(seriePosisjon, tittel, serie, disiplinFast = null) {
  if (!serie) return '';
  if (!serie.spiller1 || !serie.spiller2) {
    return `
      <div class="pv-bracket-serie">
        <div class="pv-bracket-tittel">${escHtml(tittel)}</div>
        <div style="color:var(--muted2);font-size:14px">Venter på deltakere …</div>
      </div>`;
  }

  const status = beregnSerieStatus(serie.delkamper);
  const delkampKeys = Object.keys(serie.delkamper);
  if (!serie.avgjort && trengerTredjeDelkamp(serie.delkamper) && !delkampKeys.includes('d3')) {
    delkampKeys.push('d3');
  }

  const delkampHtml = delkampKeys.map((key, i) => {
    const d = serie.delkamper[key] ?? { poeng1: null, poeng2: null, ferdig: false };
    const idSuffix = `${seriePosisjon}_${key}`;
    const disiplinLabel = disiplinFast
      ? `<div class="pv-disiplin-merke" style="margin:8px 0 4px">${DISIPLIN_IKON[disiplinFast[i]] ?? ''} ${escHtml(disiplinNavn(disiplinFast[i]))}</div>`
      : '';
    if (serie.avgjort && !d.ferdig) return ''; // ikke vist en tredje kamp som aldri ble spilt (2-0-serier)
    return `
      ${disiplinLabel}
      <div class="sl-poeng-rad">
        <input id="pv-sp1-${idSuffix}" class="sl-poeng-input" type="number" min="0" value="${d.poeng1 ?? ''}" ${serie.avgjort ? 'disabled' : ''} placeholder="0">
        <div style="color:var(--muted2)">–</div>
        <input id="pv-sp2-${idSuffix}" class="sl-poeng-input" type="number" min="0" value="${d.poeng2 ?? ''}" ${serie.avgjort ? 'disabled' : ''} placeholder="0">
      </div>
      ${!serie.avgjort
        ? `<button class="knapp knapp-primaer knapp-liten" style="width:100%;margin:6px 0 10px"
             onclick="window.lagreProvenSluttspillKamp?.('${seriePosisjon}','${key}')">${d.ferdig ? 'Oppdater' : 'Lagre'}</button>`
        : ''}
    `;
  }).join('');

  return `
    <div class="pv-bracket-serie">
      <div class="pv-bracket-tittel">${escHtml(tittel)} ${serie.avgjort ? '<span class="sl-bekreft-status sl-bekreft-ok">✓ Avgjort</span>' : ''}</div>
      <div class="pv-bracket-spiller ${serie.vinnerId === serie.spiller1 ? 'pv-bracket-vinner' : ''}">
        <span>${escHtml(spillerNavn(serie.spiller1))}</span><span>${status.seire1}</span>
      </div>
      <div class="pv-bracket-spiller ${serie.vinnerId === serie.spiller2 ? 'pv-bracket-vinner' : ''}">
        <span>${escHtml(spillerNavn(serie.spiller2))}</span><span>${status.seire2}</span>
      </div>
      ${delkampHtml}
    </div>`;
}

function renderSluttspill() {
  const container = document.getElementById('proven-sluttspill-innhold');
  if (!container) return;
  if (!_sluttspill) { container.innerHTML = renderTomTilstand('Sluttspill ikke funnet ennå.'); return; }

  const avsluttKnapp = (_sluttspill.finale?.avgjort && _event.status !== 'ferdig')
    ? `<div class="sl-regel-boks" style="margin-top:14px">
         🏆 ${escHtml(spillerNavn(_sluttspill.finale.vinnerId))} vant Prøven!
         <button class="knapp knapp-primaer" style="width:100%;margin-top:10px" onclick="window.avsluttProvenEventUI?.()">
           Admin: Avslutt og lagre i Hall of Fame
         </button>
       </div>`
    : '';
  const ferdigMerke = _event.status === 'ferdig'
    ? `<div class="sl-regel-boks" style="margin-top:14px">🔒 Denne Prøven er avsluttet og ligger i arkivet.</div>`
    : '';

  // 16-format har et fast, strukturelt kvartfinaleoppsett ("vinner A mot 2.plass B") —
  // 12-format sin kvartfinale er databasert (kollisjonsfri parring av topp 2 + 2 beste
  // 3'ere), så en fast beskrivelse ville vært misvisende der. Vis derfor generiske
  // titler for 12-format, og la selve kortet (spillernavn) tale for seg.
  const er16Format = _event.format !== 12;
  const qfTittel = (nr, beskrivelse16) => er16Format ? `QF${nr} · ${beskrivelse16}` : `Kvartfinale ${nr}`;
  const sfTittel = (nr, beskrivelse16) => er16Format ? `SF${nr} · ${beskrivelse16}` : `Semifinale ${nr}`;

  container.innerHTML = `
    <div class="seksjon-etikett">Kvartfinaler</div>
    ${renderSerieKort('qf1', qfTittel(1, 'Vinner A vs. 2. plass B'), _sluttspill.qf1)}
    ${renderSerieKort('qf2', qfTittel(2, 'Vinner B vs. 2. plass A'), _sluttspill.qf2)}
    ${renderSerieKort('qf3', qfTittel(3, 'Vinner C vs. 2. plass D'), _sluttspill.qf3)}
    ${renderSerieKort('qf4', qfTittel(4, 'Vinner D vs. 2. plass C'), _sluttspill.qf4)}

    <div class="seksjon-etikett" style="margin-top:14px">Semifinaler</div>
    ${renderSerieKort('sf1', sfTittel(1, 'Vinner QF1 vs. vinner QF4'), _sluttspill.sf1)}
    ${renderSerieKort('sf2', sfTittel(2, 'Vinner QF2 vs. vinner QF3'), _sluttspill.sf2)}

    <div class="seksjon-etikett" style="margin-top:14px">Finale</div>
    ${renderSerieKort('finale', 'Finale', _sluttspill.finale, FINALE_DISIPLIN_REKKEFOLGE)}

    ${avsluttKnapp}
    ${ferdigMerke}
  `;
}

window.lagreProvenSluttspillKamp = async function (seriePosisjon, delkampKey) {
  const idSuffix = `${seriePosisjon}_${delkampKey}`;
  const p1 = parseInt(document.getElementById(`pv-sp1-${idSuffix}`)?.value, 10);
  const p2 = parseInt(document.getElementById(`pv-sp2-${idSuffix}`)?.value, 10);
  try {
    await registrerSluttspillDelkamp(_sluttspill.id, seriePosisjon, delkampKey, p1, p2);
    _sluttspill = await hentSluttspillForEvent(_event.id);
    renderSluttspill();
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

window.avsluttProvenEventUI = function () {
  _krevAdmin('Avslutt Prøven', 'Lagrer vinneren i Hall of Fame og oppdaterer alle 16 spilleres livstidsstatistikk. Kan ikke angres.', () => {
    if (!confirm('Er du sikker på at du vil avslutte Prøven? Dette lagrer resultatet permanent i arkivet.')) return;
    (async () => {
      try {
        await avsluttProvenEvent(_event.id);
        visMelding('Prøven er avsluttet!');
        window.visProvenArkiv?.();
      } catch (e) {
        visMelding(e.message, 'feil');
      }
    })();
  });
};

// Tilbake-knappen på sluttspill-skjermen går til oversikten (eller arkivet for ferdige eventer).
window.tilbakeFraProvenSluttspill = function () {
  if (_event?.status === 'ferdig') { window.visProvenArkiv?.(); return; }
  window.visProvenOversikt?.();
};
