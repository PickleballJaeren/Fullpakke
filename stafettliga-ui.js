// ════════════════════════════════════════════════════════
// stafettliga-ui.js — Oversikt, oppsett og tabell
// Live kampregistrering ligger i stafettliga-spill-ui.js.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding } from './ui.js';
import { renderMetaChip, renderTomTilstand } from './render-helpers.js';
import {
  opprettSesong, startSesong, hentSesong, hentAktiveSesonger, hentAvsluttedeSesonger,
  beregnLagoppsett, hentSpillere, opprettSpiller, avsluttSesong, slettSesong,
  oppdaterSesongLag, sesongKanRedigeres,
} from './stafettliga.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger         = () => {};
let _krevAdmin       = () => {};
let _getAktivKlubbId = () => null;

export function stafettligaUIInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}

let _aktivSesongId = null;
export function getAktivStafettligaSesongId() { return _aktivSesongId; }

// ════════════════════════════════════════════════════════
// OVERSIKT
// ════════════════════════════════════════════════════════
export async function visStafettligaOversikt() {
  _naviger('stafettliga-oversikt');
  const container = document.getElementById('stafettliga-oversikt-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const sesonger = await hentAktiveSesonger();
  if (!sesonger.length) {
    container.innerHTML = renderTomTilstand('Ingen aktive sesonger ennå. Trykk «+ Ny» for å starte en Stafettliga-kveld.', true);
    return;
  }

  container.innerHTML = sesonger.map(s => `
    <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneStafettligaSesong?.('${s.id}')">
      <div style="flex:1">
        <div style="font-size:17px;font-weight:600">${escHtml(s.navn)}</div>
        <div style="font-size:13px;color:var(--muted2);margin-top:2px">
          ${s.antallLag} lag · ${escHtml(s.status)}
        </div>
      </div>
      <span class="t-status-merke ${s.status === 'aktiv' ? 'ts-aktiv' : 'ts-setup'}">${escHtml(s.status)}</span>
    </div>
  `).join('');
}
window.visStafettligaOversikt = visStafettligaOversikt;

// ════════════════════════════════════════════════════════
// ARKIV — avsluttede sesonger
// ════════════════════════════════════════════════════════
export async function visStafettligaArkiv() {
  _naviger('stafettliga-arkiv');
  const container = document.getElementById('stafettliga-arkiv-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const sesonger = await hentAvsluttedeSesonger();
  if (!sesonger.length) {
    container.innerHTML = renderTomTilstand('Ingen avsluttede sesonger ennå.', true);
    return;
  }

  container.innerHTML = sesonger.map(s => `
    <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneStafettligaSesong?.('${s.id}')">
      <div style="flex:1">
        <div style="font-size:17px;font-weight:600">${escHtml(s.navn)}</div>
        <div style="font-size:13px;color:var(--muted2);margin-top:2px">
          ${s.antallLag} lag · avsluttet
        </div>
      </div>
      <span class="t-status-merke ts-ferdig">ferdig</span>
    </div>
  `).join('');
}
window.visStafettligaArkiv = visStafettligaArkiv;

export async function apneStafettligaSesong(sesongId) {
  _aktivSesongId = sesongId;
  const sesong = await hentSesong(sesongId);
  if (sesong.status === 'oppsett') {
    // Ikke startet ennå — tilbake til oppsettskjermen (enkel MVP: åpne tabellskjerm uansett,
    // admin kan trykke "Start sesong" der).
  }
  await visStafettligaTabell(sesongId);
}
window.apneStafettligaSesong = apneStafettligaSesong;

// ════════════════════════════════════════════════════════
// OPPSETT
// ════════════════════════════════════════════════════════
export function opprettStafettligaSesong() {
  _krevAdmin('Ny sesong', 'Kun admin kan opprette en ny Stafettliga-sesong.', () => {
    _naviger('stafettliga-oppsett');
    renderOppsettSteg1();
  });
}
window.opprettStafettligaSesong = opprettStafettligaSesong;

function renderOppsettSteg1() {
  const container = document.getElementById('stafettliga-oppsett-innhold');
  container.innerHTML = `
    <div style="padding:16px">
      <label style="font-size:14px;color:var(--muted2)">Navn på sesongen</label>
      <input id="sl-navn" type="text" placeholder="Stafettligaen — torsdag" style="width:100%;margin:6px 0 16px">

      <label style="font-size:14px;color:var(--muted2)">Antall deltakere (16–28)</label>
      <input id="sl-antall" type="number" min="16" max="28" placeholder="F.eks. 22" style="width:100%;margin:6px 0 8px"
             oninput="window.oppdaterStafettligaRegelVisning?.()">

      <div id="sl-regel-info"></div>

      <label style="font-size:14px;color:var(--muted2);display:block;margin-top:16px">Antall lagstafetter i fase 3</label>
      <div style="display:flex;gap:16px;margin:8px 0 4px">
        <label style="display:flex;align-items:center;gap:6px;font-size:15px">
          <input type="radio" name="sl-antall-stafetter" value="1"> 1 stafett
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:15px">
          <input type="radio" name="sl-antall-stafetter" value="2" checked> 2 stafetter
        </label>
      </div>

      <button class="knapp knapp-primaer" style="width:100%;margin-top:16px" onclick="window.gaTilLagoppsett?.()">
        Neste — sett opp lag
      </button>
    </div>
  `;
}

window.oppdaterStafettligaRegelVisning = function () {
  const antall = parseInt(document.getElementById('sl-antall')?.value, 10);
  const infoEl = document.getElementById('sl-regel-info');
  if (!infoEl) return;
  if (isNaN(antall) || antall < 16 || antall > 28) {
    infoEl.innerHTML = '';
    return;
  }
  try {
    const { antallLag, lagStorrelser, regel } = beregnLagoppsett(antall);
    infoEl.innerHTML = `
      <div class="sl-regel-boks">
        <strong>${antallLag} lag</strong> · lagstørrelser: <strong>${lagStorrelser.join(' + ')}</strong> · Regel <strong>${regel}</strong>
      </div>`;
  } catch (e) {
    infoEl.innerHTML = `<div class="sl-regel-boks" style="color:var(--red2)">${escHtml(e.message)}</div>`;
  }
};

window.gaTilLagoppsett = async function () {
  const navn   = document.getElementById('sl-navn')?.value?.trim();
  const antall = parseInt(document.getElementById('sl-antall')?.value, 10);
  const antallStafetter = parseInt(document.querySelector('input[name="sl-antall-stafetter"]:checked')?.value, 10) || 2;
  let oppsett;
  try {
    oppsett = beregnLagoppsett(antall);
  } catch (e) {
    visMelding(e.message, 'feil');
    return;
  }
  _antallStafetter = antallStafetter;
  await renderOppsettSteg2(navn, antall, oppsett);
};

// ════════════════════════════════════════════════════════
// SPILLERVELGER-STATE — i minnet mens oppsettet fylles ut
// ════════════════════════════════════════════════════════
let _alleSpillere   = [];             // [{id, navn}] fra players-samlingen
let _valgteSpillere = {};             // { [lagIdx]: { niva1: [{id,navn}], niva2: [{id,navn}] } }
let _lagStorrelser  = [];
let _sesongNavn      = '';
let _antallDeltakere = 0;
let _antallStafetter = 2;             // 1 eller 2 — valgt i steg 1, evt. hentet fra sesongen ved redigering

// Redigeringsmodus: gjenbruker samme spillervelger-UI til å endre lag/spillere
// på en sesong som allerede er opprettet, men ikke startet (ingen resultater registrert ennå).
let _redigerModus    = false;
let _redigerSesongId = null;
let _redigerLagNavn  = [];

function _alleValgteIder() {
  const ider = new Set();
  Object.values(_valgteSpillere).forEach(lag => {
    (lag.niva1 ?? []).forEach(s => ider.add(s.id));
    (lag.niva2 ?? []).forEach(s => ider.add(s.id));
  });
  return ider;
}

async function renderOppsettSteg2(navn, antallDeltakere, oppsett) {
  _redigerModus = false;
  _redigerSesongId = null;
  _redigerLagNavn = [];
  const tittelEl = document.getElementById('stafettliga-oppsett-tittel');
  if (tittelEl) tittelEl.textContent = 'Ny sesong';
  _sesongNavn = navn;
  _antallDeltakere = antallDeltakere;
  _lagStorrelser = oppsett.lagStorrelser;
  _valgteSpillere = {};
  _lagStorrelser.forEach((_, i) => { _valgteSpillere[i] = { niva1: [], niva2: [] }; });

  const container = document.getElementById('stafettliga-oppsett-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster spillere …</div>';
  _alleSpillere = await hentSpillere();

  renderSpillervelgerUI();
}

function renderSpillervelgerUI() {
  const container = document.getElementById('stafettliga-oppsett-innhold');

  const lagHtml = _lagStorrelser.map((storrelse, i) => {
    const valgt = _valgteSpillere[i];
    const totalt = valgt.niva1.length + valgt.niva2.length;
    return `
      <div class="t-lag-element" style="flex-direction:column;align-items:stretch;gap:10px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <input class="sl-lagnavn" type="text" value="${escHtml(_redigerLagNavn[i] ?? `Lag ${i + 1}`)}" style="font-size:16px;font-weight:600;flex:1;margin-right:8px" data-lag-idx="${i}">
          <span class="t-status-merke ${totalt === storrelse ? 'ts-ferdig' : 'ts-setup'}">${totalt} / ${storrelse}</span>
        </div>
        ${renderNivaVelger(i, 'niva1', 'Nivå 1')}
        ${renderNivaVelger(i, 'niva2', 'Nivå 2')}
      </div>
    `;
  }).join('');

  const alleFerdig = _lagStorrelser.every((storrelse, i) =>
    _valgteSpillere[i].niva1.length + _valgteSpillere[i].niva2.length === storrelse);

  container.innerHTML = `
    <div style="padding:0 0 16px">
      <div class="sl-regel-boks">Søk opp og velg spillere fra klubbens spillerliste for hvert nivå på hvert lag.</div>
      ${lagHtml}
      <button class="knapp knapp-primaer" style="width:100%;margin-top:8px" ${alleFerdig ? '' : 'disabled'}
              onclick="window.lagreStafettligaOppsett?.()">
        ${_redigerModus ? 'Lagre endringer' : 'Opprett og start sesong'}
      </button>
    </div>
  `;
}

function renderNivaVelger(lagIdx, niva, tittel) {
  const valgte = _valgteSpillere[lagIdx][niva];
  const chips = valgte.map(s => `
    <span class="sl-valgt-chip">
      ${escHtml(s.navn)}
      <button onclick="window.fjernStafettligaSpiller?.(${lagIdx}, '${niva}', '${s.id}')">✕</button>
    </span>
  `).join('');

  return `
    <div>
      <label><span class="sl-niva-merke sl-niva-${niva === 'niva1' ? '1' : '2'}" style="vertical-align:middle;margin-right:6px">${niva === 'niva1' ? '1' : '2'}</span>${tittel}</label>
      <div style="margin:6px 0">${chips || '<span style="font-size:13px;color:var(--muted2)">Ingen valgt ennå</span>'}</div>
      <input type="text" placeholder="Søk etter spiller …" oninput="window.sokStafettligaSpiller?.(${lagIdx}, '${niva}', this.value, this)">
      <div class="sl-spillervelger-treff" id="sl-treff-${lagIdx}-${niva}" style="display:none"></div>
    </div>
  `;
}

window.sokStafettligaSpiller = function (lagIdx, niva, sokTekst, inputEl) {
  const treffContainer = document.getElementById(`sl-treff-${lagIdx}-${niva}`);
  const tekst = sokTekst.trim();
  if (!tekst) { treffContainer.style.display = 'none'; treffContainer.innerHTML = ''; return; }

  const tekstLower  = tekst.toLowerCase();
  const valgteIder  = _alleValgteIder();
  const treff = _alleSpillere
    .filter(s => !valgteIder.has(s.id) && s.navn.toLowerCase().includes(tekstLower))
    .slice(0, 8);

  const finnesFraFor = _alleSpillere.some(s => s.navn.toLowerCase() === tekstLower);

  let html = treff.length
    ? treff.map(s => `
        <div class="sl-spillervelger-rad" onclick="window.velgStafettligaSpiller?.(${lagIdx}, '${niva}', '${s.id}', '${escHtml(s.navn)}')">
          <span>${escHtml(s.navn)}</span>
        </div>
      `).join('')
    : '<div class="sl-spillervelger-rad" style="color:var(--muted2)">Ingen treff</div>';

  if (!finnesFraFor) {
    html += `
      <div class="sl-spillervelger-rad" style="color:var(--green,#2ecc71);font-weight:600" data-navn="${escHtml(tekst)}"
           onclick="window.leggTilNyStafettligaSpiller?.(${lagIdx}, '${niva}', this)">
        + Opprett ny spiller: «${escHtml(tekst)}»
      </div>`;
  }

  treffContainer.style.display = 'block';
  treffContainer.innerHTML = html;
};

window.velgStafettligaSpiller = function (lagIdx, niva, spillerId, spillerNavn) {
  _valgteSpillere[lagIdx][niva].push({ id: spillerId, navn: spillerNavn });
  renderSpillervelgerUI();
};

window.leggTilNyStafettligaSpiller = async function (lagIdx, niva, el) {
  const navn = el?.dataset?.navn?.trim();
  if (!navn) return;

  el.textContent = 'Oppretter …';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0.6';

  try {
    const nySpiller = await opprettSpiller(navn);
    _alleSpillere.push(nySpiller);
    _alleSpillere.sort((a, b) => a.navn.localeCompare(b.navn, 'no'));
    _valgteSpillere[lagIdx][niva].push(nySpiller);
    renderSpillervelgerUI();
    visMelding(`${nySpiller.navn} opprettet og lagt til`);
  } catch (e) {
    visMelding(e.message, 'feil');
    el.textContent = `+ Opprett ny spiller: «${navn}»`;
    el.style.pointerEvents = '';
    el.style.opacity = '';
  }
};

window.fjernStafettligaSpiller = function (lagIdx, niva, spillerId) {
  _valgteSpillere[lagIdx][niva] = _valgteSpillere[lagIdx][niva].filter(s => s.id !== spillerId);
  renderSpillervelgerUI();
};

window.lagreStafettligaOppsett = async function () {
  const lag = _lagStorrelser.map((storrelse, i) => {
    const navnEl = document.querySelector(`.sl-lagnavn[data-lag-idx="${i}"]`);
    return {
      navn: navnEl?.value?.trim() || `Lag ${i + 1}`,
      spillere: { niva1: _valgteSpillere[i].niva1, niva2: _valgteSpillere[i].niva2 },
    };
  });

  try {
    if (_redigerModus && _redigerSesongId) {
      const sesongId = _redigerSesongId;
      await oppdaterSesongLag(sesongId, lag);
      _redigerModus = false;
      _redigerSesongId = null;
      _aktivSesongId = sesongId;
      await visStafettligaTabell(sesongId);
    } else {
      const sesongId = await opprettSesong({ navn: _sesongNavn, antallDeltakere: _antallDeltakere, lag, antallStafetter: _antallStafetter });
      await startSesong(sesongId);
      _aktivSesongId = sesongId;
      await visStafettligaTabell(sesongId);
    }
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

// ════════════════════════════════════════════════════════
// REDIGER LAG — kun mulig før noe resultat er registrert i sesongen.
// Gjenbruker spillervelger-UI-et fra oppsettet, forhåndsutfylt med
// eksisterende lagnavn og spillere.
// ════════════════════════════════════════════════════════
export async function redigerStafettligaLag(sesongId) {
  const kanRedigere = await sesongKanRedigeres(sesongId);
  if (!kanRedigere) {
    visMelding('Kan ikke redigere lag etter at kamper er startet.', 'advarsel');
    return;
  }
  _krevAdmin('Rediger lag', 'Endre lagnavn eller spillere før kampene starter.', async () => {
    const sesong = await hentSesong(sesongId);

    _redigerModus    = true;
    _redigerSesongId = sesongId;
    _sesongNavn       = sesong.navn;
    _antallDeltakere  = sesong.antallDeltakere;
    _antallStafetter  = sesong.antallStafetter ?? 2;
    _lagStorrelser    = sesong.lagStorrelser;
    _redigerLagNavn   = sesong.lag.map(l => l.navn);
    _valgteSpillere   = {};
    sesong.lag.forEach((l, i) => {
      _valgteSpillere[i] = {
        niva1: [...(l.spillere.niva1 ?? [])],
        niva2: [...(l.spillere.niva2 ?? [])],
      };
    });

    _naviger('stafettliga-oppsett');
    const tittelEl = document.getElementById('stafettliga-oppsett-tittel');
    if (tittelEl) tittelEl.textContent = 'Rediger lag';
    const container = document.getElementById('stafettliga-oppsett-innhold');
    container.innerHTML = '<div class="tom-tilstand-liten">Laster spillere …</div>';
    _alleSpillere = await hentSpillere();
    renderSpillervelgerUI();
  });
}
window.redigerStafettligaLag = redigerStafettligaLag;

// Tilbake-knappen på oppsett-skjermen: i redigeringsmodus tilbake til tabellen,
// ellers til oversikten (som normalt for ny-sesong-flyten).
window.tilbakeFraStafettligaOppsett = function () {
  if (_redigerModus && _redigerSesongId) {
    const sesongId = _redigerSesongId;
    _redigerModus = false;
    _redigerSesongId = null;
    visStafettligaTabell(sesongId);
    return;
  }
  _naviger('stafettliga-oversikt');
};


// ════════════════════════════════════════════════════════
// TABELL
// ════════════════════════════════════════════════════════
export async function visStafettligaTabell(sesongId) {
  _aktivSesongId = sesongId;
  _naviger('stafettliga-tabell');
  const container = document.getElementById('stafettliga-tabell-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const sesong = await hentSesong(sesongId);
  const tabell = sesong.tabell ?? [];
  const kanRedigereLag = sesong.status === 'aktiv' && await sesongKanRedigeres(sesongId);

  const chips = renderMetaChip('🏆', sesong.navn) + renderMetaChip('👥', `${sesong.antallLag} lag`);

  const tabellHtml = tabell.length
    ? tabell.map(r => `
        <div class="sl-tabell-rad">
          <div class="sl-tabell-plass">${r.plass}</div>
          <div class="sl-tabell-navn">${escHtml(r.navn)}</div>
          <div class="sl-tabell-prosent">${r.poengprosent.toFixed(1)}%</div>
          <div class="sl-tabell-poeng">${r.lagpoeng}</div>
        </div>
      `).join('')
    : renderTomTilstand('Ingen resultater registrert ennå.');

  const kanAvslutte = sesong.status === 'aktiv' || sesong.status === 'plasseringskamper';
  const avsluttKnapp = kanAvslutte
    ? `<button class="knapp knapp-omriss" style="width:100%;margin-top:8px;color:var(--red2,#e05252)"
         onclick="window.avsluttStafettligaSesong?.('${sesongId}')">
         Avslutt økt
       </button>`
    : '';
  const redigerLagKnapp = kanRedigereLag
    ? `<button class="knapp knapp-omriss" style="width:100%;margin-top:8px" onclick="window.redigerStafettligaLag?.('${sesongId}')">
         Rediger lag
       </button>`
    : '';

  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:14px 16px 0">${chips}</div>
    <div style="margin-top:10px">${tabellHtml}</div>
    <div style="padding:16px">
      <button class="knapp knapp-omriss" style="width:100%" onclick="window.visStafettligaLagkamper?.('${sesongId}')">
        Se lagkamper
      </button>
      ${redigerLagKnapp}
      ${avsluttKnapp}
      <button class="knapp knapp-omriss" style="width:100%;margin-top:8px;color:var(--muted2)"
        onclick="window.slettStafettligaSesong?.('${sesongId}', '${escHtml(sesong.navn)}')">
        Slett økt
      </button>
    </div>
  `;
}
window.tilbakeTilStafettligaSesong = () => { if (_aktivSesongId) visStafettligaTabell(_aktivSesongId); };

// Tilbake-knappen på tabell-skjermen: avsluttede sesonger ble åpnet fra
// arkivet og skal gå tilbake dit, aktive sesonger går til oversikten.
window.tilbakeFraStafettligaTabell = async function () {
  if (_aktivSesongId) {
    try {
      const sesong = await hentSesong(_aktivSesongId);
      if (sesong.status === 'ferdig') { visStafettligaArkiv(); return; }
    } catch (e) { /* faller tilbake til oversikten under */ }
  }
  _naviger('stafettliga-oversikt');
};

window.avsluttStafettligaSesong = function (sesongId) {
  _krevAdmin('Avslutt økt', 'Avslutter økten og flytter den til arkivet. Dette kan ikke angres.', async () => {
    if (!confirm('Er du sikker på at du vil avslutte økten? Dette flytter den til arkivet og kan ikke angres.')) return;
    try {
      await avsluttSesong(sesongId);
      window.visStafettligaOversikt?.();
    } catch (e) {
      visMelding(e.message, 'feil');
    }
  });
};

window.slettStafettligaSesong = function (sesongId, sesongNavn) {
  _krevAdmin('Slett økt', `Sletter «${sesongNavn}» permanent. Dette kan ikke angres.`, async () => {
    const bekreftelse = prompt(`Skriv inn øktens navn for å bekrefte sletting:\n«${sesongNavn}»`);
    if (bekreftelse !== sesongNavn) {
      if (bekreftelse !== null) visMelding('Navnet stemte ikke — økten ble ikke slettet.', 'advarsel');
      return;
    }
    try {
      await slettSesong(sesongId);
      visMelding('Økten ble slettet.');
      window.visStafettligaOversikt?.();
    } catch (e) {
      visMelding(e.message, 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// STORSKJERM — genererer lenke (+ QR) til den live viewer-siden
// (stafettliga-viewer.html) for gjeldende klubb og økt, slik at
// den kan åpnes på en TV/projektor. Krever ikke admin-PIN siden
// viewer-siden kun er lesbar, ingen skriving skjer derfra.
// ════════════════════════════════════════════════════════
window.visStorskjermModal = function () {
  if (!_aktivSesongId) return;
  const klubbId = _getAktivKlubbId();

  const url = new URL('stafettliga-viewer.html', location.href);
  url.searchParams.set('klubb', klubbId ?? '');
  url.searchParams.set('sesong', _aktivSesongId);
  const lenke = url.toString();

  const modal      = document.getElementById('modal-storskjerm');
  const qrContainer = document.getElementById('storskjerm-qr');
  const lenkeTekst  = document.getElementById('storskjerm-lenke-tekst');
  const apneLenke   = document.getElementById('storskjerm-apne-lenke');
  if (!modal || !qrContainer || !lenkeTekst) return;

  lenkeTekst.textContent = lenke;
  if (apneLenke) apneLenke.href = lenke;
  modal.dataset.lenke = lenke;

  qrContainer.innerHTML = '';
  if (typeof qrcode !== 'undefined') {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(lenke);
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
      const svg = qrContainer.querySelector('svg');
      if (svg) { svg.style.width = '180px'; svg.style.height = '180px'; svg.style.display = 'block'; }
    } catch (e) {
      console.warn('[Storskjerm] Kunne ikke generere QR-kode:', e?.message);
    }
  }

  modal.style.display = 'flex';
};

window.kopierStorskjermLenke = async function () {
  const modal = document.getElementById('modal-storskjerm');
  const lenke = modal?.dataset?.lenke;
  if (!lenke) return;
  try {
    await navigator.clipboard.writeText(lenke);
    visMelding('Lenke kopiert!');
  } catch (e) {
    prompt('Kopier lenken manuelt:', lenke);
  }
};

window.lukkStorskjermModal = function () {
  const modal = document.getElementById('modal-storskjerm');
  if (modal) modal.style.display = 'none';
};
