// ════════════════════════════════════════════════════════
// proven-ui.js — Oversikt, oppsett (spillerplukk + puljetrekning)
// og arkiv/Hall of Fame for Mesteren.
// Live kampregistrering ligger i proven-spill-ui.js.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding } from './ui.js';
import { renderTomTilstand } from './render-helpers.js';
import {
  provenInit, hentSpillere, opprettSpiller,
  opprettProvenEvent, hentProvenEvent, hentAktiveProvenEventer, hentAvsluttedeProvenEventer,
  trekkPuljerForEvent, lagrePuljejustering, startPuljespill,
  slettProvenEvent, hentHallOfFameTopp,
  KILDER,
} from './proven.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger   = () => {};
let _krevAdmin = () => {};

let _getAktivKlubbId = () => null;

export function provenUIInit(deps) {
  _naviger   = deps.naviger;
  _krevAdmin = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
  provenInit(deps); // videresender samme avhengigheter til Firestore-laget (proven.js)
}

let _aktivEventId = null;
export function getAktivProvenEventId() { return _aktivEventId; }

const KILDE_NAVN = {
  '8eren': '8\'eren', naloyet: 'Nåløyet', wildcard: 'Wildcard', admin_invite: 'Admin Invite',
};

// ════════════════════════════════════════════════════════
// OVERSIKT
// ════════════════════════════════════════════════════════
export async function visProvenOversikt() {
  _naviger('proven-oversikt');
  const container = document.getElementById('proven-oversikt-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const eventer = await hentAktiveProvenEventer();
  if (!eventer.length) {
    container.innerHTML = renderTomTilstand('Ingen aktive Mesteren-eventer ennå. Trykk «+ Ny» for å starte.', true);
    return;
  }

  const STATUS_TEKST  = { oppsett: 'Oppsett', puljespill: 'Puljespill', sluttspill: 'Sluttspill' };
  const STATUS_KLASSE = { oppsett: 'ts-setup', puljespill: 'ts-aktiv', sluttspill: 'ts-seeding' };

  container.innerHTML = eventer.map(e => `
    <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneProvenEvent?.('${e.id}')">
      <div style="flex:1">
        <div style="font-size:17px;font-weight:600">${escHtml(e.navn)} <span style="color:var(--muted2);font-weight:400">#${e.eventNr}</span></div>
        <div style="font-size:13px;color:var(--muted2);margin-top:2px">${e.format ?? 16} spillere</div>
      </div>
      <span class="t-status-merke ${STATUS_KLASSE[e.status] ?? 'ts-setup'}">${escHtml(STATUS_TEKST[e.status] ?? e.status)}</span>
      <button class="knapp knapp-omriss knapp-liten" style="margin-left:8px" onclick="event.stopPropagation();window.slettProvenEventUI?.('${e.id}','${escHtml(e.navn)}')">✕</button>
    </div>
  `).join('');
}
window.visProvenOversikt = visProvenOversikt;

// ════════════════════════════════════════════════════════
// ARKIV / HALL OF FAME
// ════════════════════════════════════════════════════════
export async function visProvenArkiv() {
  _naviger('proven-arkiv');
  const container = document.getElementById('proven-arkiv-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const [eventer, topp] = await Promise.all([hentAvsluttedeProvenEventer(), hentHallOfFameTopp(5)]);

  // Hall of Fame-topplisten har kun spillerId — hent navn fra de avsluttede eventenes spillerlister.
  const navnMap = {};
  eventer.forEach(e => (e.spillere || []).forEach(s => { navnMap[s.id] = s.navn; }));

  let toppHtml = '';
  if (topp.length) {
    toppHtml = `
      <div class="seksjon-etikett" style="margin-top:18px">🏆 Hall of Fame</div>
      <div class="kort">
        ${topp.map((t, i) => `
          <div class="sl-tabell-rad">
            <div class="sl-tabell-plass">${i + 1}</div>
            <div class="sl-tabell-navn">${escHtml(navnMap[t.spillerId] ?? t.spillerId)}</div>
            <div class="sl-tabell-poeng" title="Antall event-seire">${t.eventseire ?? 0}</div>
          </div>
        `).join('')}
      </div>`;
  }

  const eventerHtml = eventer.length
    ? eventer.map(e => `
        <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneProvenEvent?.('${e.id}')">
          <div style="flex:1">
            <div style="font-size:17px;font-weight:600">${escHtml(e.navn)} <span style="color:var(--muted2);font-weight:400">#${e.eventNr}</span></div>
            <div style="font-size:13px;color:var(--muted2);margin-top:2px">Vinner: ${escHtml((e.spillere || []).find(s => s.id === e.vinnerId)?.navn ?? '?')}</div>
          </div>
          <span class="t-status-merke ts-ferdig">ferdig</span>
        </div>
      `).join('')
    : renderTomTilstand('Ingen avsluttede eventer ennå.');

  container.innerHTML = `
    <div class="seksjon-etikett">Avsluttede eventer</div>
    ${eventerHtml}
    ${toppHtml}
  `;
}
window.visProvenArkiv = visProvenArkiv;

/** Åpner et event og ruter til riktig skjerm ut fra status. */
export async function apneProvenEvent(eventId) {
  _aktivEventId = eventId;
  const event = await hentProvenEvent(eventId);
  if (event.status === 'oppsett') {
    await visProvenPuljetrekning(eventId);
  } else if (event.status === 'puljespill') {
    window.visProvenPuljespill?.(eventId);
  } else if (event.status === 'sluttspill' || event.status === 'ferdig') {
    window.visProvenSluttspill?.(eventId);
  }
}
window.apneProvenEvent = apneProvenEvent;

window.slettProvenEventUI = function (eventId, navn) {
  _krevAdmin('Slett Mesteren-event', `Sletter «${navn}» permanent. Dette kan ikke angres.`, () => {
    const bekreftelse = prompt(`Skriv inn eventets navn for å bekrefte sletting:\n«${navn}»`);
    if (bekreftelse !== navn) {
      if (bekreftelse !== null) visMelding('Navnet stemte ikke — eventet ble ikke slettet.', 'advarsel');
      return;
    }
    slettProvenEvent(eventId).then(() => {
      visMelding('Eventet ble slettet.');
      window.visProvenOversikt?.();
    }).catch(e => visMelding(e.message, 'feil'));
  });
};

// ════════════════════════════════════════════════════════
// OPPRETTING — steg 1: navn + plukk 16 spillere m/ kilde
// ════════════════════════════════════════════════════════
export function opprettProvenEventUI() {
  _krevAdmin('Nytt event', 'Kun admin kan opprette et nytt Mesteren-event.', () => {
    _naviger('proven-oppsett');
    document.getElementById('proven-oppsett-tittel').textContent = 'Nytt event';
    renderFormatvalgUI();
  });
}

let _provenFormat = null; // 12 eller 16 — valgt før spillerplukk starter

function renderFormatvalgUI() {
  const container = document.getElementById('proven-oppsett-innhold');
  container.innerHTML = `
    <div style="padding:16px 0">
      <div class="seksjon-etikett">Velg format</div>
      <div class="sl-regel-boks">Antall deltakere avgjør puljestruktur og hvordan sluttspillet settes opp. Kan ikke endres etter at spillerplukk er startet.</div>
      <button class="knapp knapp-primaer" style="width:100%;margin-top:12px" onclick="window.velgProvenFormat?.(16)">
        16 deltakere <span style="opacity:.7;font-weight:400">— 4 puljer à 4</span>
      </button>
      <button class="knapp knapp-omriss" style="width:100%;margin-top:10px" onclick="window.velgProvenFormat?.(12)">
        12 deltakere <span style="opacity:.7">— 3 puljer à 4</span>
      </button>
    </div>
  `;
}

window.velgProvenFormat = function (format) {
  _provenFormat = format;
  renderSpillerplukkSteg1();
};
window.opprettProvenEventUI = opprettProvenEventUI;

let _alleSpillere = [];
let _valgteSpillere = []; // [{id, navn, kilde, wildcardBegrunnelse}]
let _provenNavn = '';
let _aktivKilde = '8eren';       // hvilken kilde nye avkrysninger tagges med akkurat nå
let _sokTekst = '';
let _spillerlisteApen = false;   // "Velg spillere" er lukket til man trykker på den, som kilde-boksen

async function renderSpillerplukkSteg1() {
  _valgteSpillere = [];
  _provenNavn = '';
  _aktivKilde = '8eren';
  _sokTekst = '';
  _spillerlisteApen = false;
  const container = document.getElementById('proven-oppsett-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster spillere …</div>';
  _alleSpillere = await hentSpillere();
  renderSpillerplukkUI();
}

function renderSpillerplukkUI() {
  const container = document.getElementById('proven-oppsett-innhold');
  const antallTotalt = _valgteSpillere.length;
  const antallAktivKilde = _valgteSpillere.filter(s => s.kilde === _aktivKilde).length;

  container.innerHTML = `
    <div style="padding:16px 0">
      <label style="font-size:14px;color:var(--muted2)">Navn på eventet</label>
      <input id="pv-navn" type="text" placeholder="Mesteren" value="${escHtml(_provenNavn)}" style="width:100%;margin:6px 0 16px" oninput="window._provenSettNavn?.(this.value)">

      <div class="sl-regel-boks" id="pv-total-teller"><strong>${antallTotalt} / ${_provenFormat}</strong> spillere valgt totalt.</div>

      <label style="font-size:14px;color:var(--muted2);display:block;margin-top:14px">Kvalifiseringsstatus</label>
      <select id="pv-aktiv-kilde" style="width:100%;margin:6px 0 16px" onchange="window.byttAktivKilde?.(this.value)">
        ${KILDER.map(k => `<option value="${k}" ${k === _aktivKilde ? 'selected' : ''}>${escHtml(KILDE_NAVN[k])}</option>`).join('')}
      </select>

      <div style="cursor:pointer;background:#060e1c;border:1px solid var(--border2);border-radius:10px;padding:14px 16px;
                  display:flex;align-items:center;justify-content:space-between;margin-top:14px"
           onclick="window.toggleProvenSpillerlisteApen?.()">
        <div>
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted2)">Velg spillere</div>
          <div id="pv-antall-aktiv-kilde" style="font-size:18px;font-weight:600;color:var(--yellow);margin-top:2px">${antallAktivKilde} valgt</div>
        </div>
        <span style="color:var(--muted2);font-size:13px">${_spillerlisteApen ? '▲' : '▼'}</span>
      </div>

      ${_spillerlisteApen ? `
        <div style="margin-top:10px">
          <input id="pv-sok" type="text" placeholder="Søk etter spiller …" value="${escHtml(_sokTekst)}" style="margin-bottom:8px" oninput="window.sokProvenSpiller?.(this.value)">
          <div class="sl-spillervelger-treff" id="pv-spillerliste" style="display:block;max-height:420px"></div>
        </div>
      ` : ''}

      <button id="pv-neste-knapp" class="knapp knapp-primaer" style="width:100%;margin-top:16px" ${antallTotalt === _provenFormat ? '' : 'disabled'}
              onclick="window.gaTilPuljetrekning?.()">
        Neste — trekk puljer
      </button>
    </div>
  `;
  renderSpillerlisteInnhold();
}

/** Rendrer KUN listen (ikke søkefeltet rundt) — kalles på hvert tastetrykk i søket uten å miste fokus. */
function renderSpillerlisteInnhold() {
  const container = document.getElementById('pv-spillerliste');
  if (!container) return;

  const tekst = _sokTekst.trim().toLowerCase();
  const treff = tekst ? _alleSpillere.filter(s => s.navn.toLowerCase().includes(tekst)) : _alleSpillere;

  let html = treff.map(renderSpillerRad).join('');

  const finnesFraFor = tekst && _alleSpillere.some(s => s.navn.toLowerCase() === tekst);
  if (tekst && !finnesFraFor && _valgteSpillere.length < _provenFormat) {
    html += `
      <div class="sl-spillervelger-rad" style="color:var(--green2);font-weight:600" data-navn="${escHtml(_sokTekst.trim())}"
           onclick="window.leggTilNyProvenSpiller?.(this)">
        + Opprett ny spiller: «${escHtml(_sokTekst.trim())}» (${escHtml(KILDE_NAVN[_aktivKilde])})
      </div>`;
  }

  container.innerHTML = html || renderTomTilstand(tekst ? 'Ingen treff.' : 'Ingen spillere i klubben ennå.');
}

function renderSpillerRad(spiller) {
  const valgt = _valgteSpillere.find(s => s.id === spiller.id);
  const erValgtMedAktivKilde = valgt && valgt.kilde === _aktivKilde;
  const merkelapp = (valgt && !erValgtMedAktivKilde)
    ? `<span style="font-size:12px;color:var(--muted2);margin-left:8px">(${escHtml(KILDE_NAVN[valgt.kilde])})</span>`
    : '';

  let html = `
    <div class="sl-spillervelger-rad" style="${erValgtMedAktivKilde ? 'background:rgba(34,197,94,.18)' : ''}"
         onclick="window.toggleProvenSpiller?.('${spiller.id}')">
      <span>${escHtml(spiller.navn)}${merkelapp}</span>
      <span style="${erValgtMedAktivKilde ? 'color:var(--green2);font-weight:700' : 'color:var(--muted2)'}">${erValgtMedAktivKilde ? '✓' : '+'}</span>
    </div>`;

  if (erValgtMedAktivKilde && _aktivKilde === 'wildcard') {
    html += `
      <div style="padding:8px 14px 12px;background:#060e1c">
        <input type="text" placeholder="Begrunnelse (valgfritt, kun synlig for admin)" value="${escHtml(valgt.wildcardBegrunnelse ?? '')}"
               oninput="window.settWildcardBegrunnelse?.('${spiller.id}', this.value)">
      </div>`;
  }
  return html;
}

window._provenSettNavn = function (v) { _provenNavn = v; };

window.byttAktivKilde = function (kilde) {
  _aktivKilde = kilde;
  renderSpillerplukkUI();
};

window.toggleProvenSpillerlisteApen = function () {
  _spillerlisteApen = !_spillerlisteApen;
  renderSpillerplukkUI();
};

/** Trykk på en avkrysset (✓) rad fjerner spilleren helt. Trykk på en "+"-rad legger til/flytter spilleren til aktiv kilde. */
window.toggleProvenSpiller = function (spillerId) {
  const eksisterende = _valgteSpillere.find(s => s.id === spillerId);
  if (eksisterende && eksisterende.kilde === _aktivKilde) {
    _valgteSpillere = _valgteSpillere.filter(s => s.id !== spillerId);
  } else if (eksisterende) {
    eksisterende.kilde = _aktivKilde; // flytt til aktiv kilde — endrer ikke totalt antall
  } else {
    if (_valgteSpillere.length >= _provenFormat) { visMelding(`Du har allerede valgt ${_provenFormat} spillere.`, 'advarsel'); return; }
    const spiller = _alleSpillere.find(s => s.id === spillerId);
    _valgteSpillere.push({ id: spillerId, navn: spiller?.navn ?? '?', kilde: _aktivKilde, wildcardBegrunnelse: '' });
  }
  oppdaterProvenSpillerplukkTellere(); // IKKE full ombygging — ville nullstilt scrollposisjonen i listen
};

/**
 * Oppdaterer kun tellerne + listeinnholdet, uten å bygge om hele "Velg spillere"-skjermen.
 * Bevarer scrollposisjonen i spillerlisten eksplisitt (en full innerHTML-ombygging av
 * listen ville ellers nullstilt den til toppen ved hvert trykk).
 */
function oppdaterProvenSpillerplukkTellere() {
  const listeContainer = document.getElementById('pv-spillerliste');
  const scrollPos = listeContainer ? listeContainer.scrollTop : 0;

  const antallTotalt = _valgteSpillere.length;
  const antallAktivKilde = _valgteSpillere.filter(s => s.kilde === _aktivKilde).length;

  const totalEl = document.getElementById('pv-total-teller');
  if (totalEl) totalEl.innerHTML = `<strong>${antallTotalt} / ${_provenFormat}</strong> spillere valgt totalt.`;

  const kildeTellerEl = document.getElementById('pv-antall-aktiv-kilde');
  if (kildeTellerEl) kildeTellerEl.textContent = `${antallAktivKilde} valgt`;

  const nesteKnapp = document.getElementById('pv-neste-knapp');
  if (nesteKnapp) nesteKnapp.disabled = antallTotalt !== _provenFormat;

  renderSpillerlisteInnhold(); // bygger om KUN listen (samme container-element, ikke hele skjermen)

  if (listeContainer) listeContainer.scrollTop = scrollPos;
}

window.sokProvenSpiller = function (tekst) {
  _sokTekst = tekst;
  renderSpillerlisteInnhold();
};

window.leggTilNyProvenSpiller = async function (el) {
  const navn = el?.dataset?.navn?.trim();
  if (!navn) return;
  if (_valgteSpillere.length >= _provenFormat) { visMelding(`Du har allerede valgt ${_provenFormat} spillere.`, 'advarsel'); return; }
  el.textContent = 'Oppretter …';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0.6';
  try {
    const ny = await opprettSpiller(navn);
    _alleSpillere.push(ny);
    _alleSpillere.sort((a, b) => a.navn.localeCompare(b.navn, 'no'));
    _valgteSpillere.push({ id: ny.id, navn: ny.navn, kilde: _aktivKilde, wildcardBegrunnelse: '' });
    _sokTekst = '';
    renderSpillerplukkUI();
    visMelding(`${ny.navn} opprettet og lagt til (${KILDE_NAVN[_aktivKilde]})`);
  } catch (e) {
    visMelding(e.message, 'feil');
    el.textContent = `+ Opprett ny spiller: «${navn}»`;
    el.style.pointerEvents = '';
    el.style.opacity = '';
  }
};

window.settWildcardBegrunnelse = function (spillerId, tekst) {
  const s = _valgteSpillere.find(s => s.id === spillerId);
  if (s) s.wildcardBegrunnelse = tekst;
};

// ════════════════════════════════════════════════════════
// OPPRETTING — steg 2: puljetrekning + manuell justering
// ════════════════════════════════════════════════════════
window.gaTilPuljetrekning = async function () {
  if (_valgteSpillere.length !== _provenFormat) { visMelding(`Velg nøyaktig ${_provenFormat} spillere.`, 'advarsel'); return; }
  try {
    const eventId = await opprettProvenEvent({ navn: _provenNavn, format: _provenFormat, spillere: _valgteSpillere });
    _aktivEventId = eventId;
    await visProvenPuljetrekning(eventId);
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

let _puljeUtkast = null;       // [{navn, spillereIds}] — arbeidskopi mens admin justerer
let _navnPaSpillerId = {};     // { spillerId: navn } — for visning under justering

async function visProvenPuljetrekning(eventId) {
  _aktivEventId = eventId;
  _naviger('proven-oppsett');
  document.getElementById('proven-oppsett-tittel').textContent = 'Puljetrekning';
  const container = document.getElementById('proven-oppsett-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const event = await hentProvenEvent(eventId);
  _navnPaSpillerId = {};
  event.spillere.forEach(s => { _navnPaSpillerId[s.id] = s.navn; });
  _puljeUtkast = event.puljer ? JSON.parse(JSON.stringify(event.puljer)) : await trekkPuljerForEvent(eventId);

  renderPuljetrekningUI();
}

function renderPuljetrekningUI() {
  const container = document.getElementById('proven-oppsett-innhold');
  const puljeHtml = _puljeUtkast.map(p => `
    <div class="kort" style="margin-bottom:12px">
      <div class="kort-innhold">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="pv-pulje-merke pv-pulje-${p.navn}">${p.navn}</span>
          <span style="font-weight:600">Pulje ${p.navn}</span>
          <span style="color:var(--muted2);font-size:13px;margin-left:auto">${p.spillereIds.length} / 4</span>
        </div>
        ${p.spillereIds.map(id => `
          <div class="sl-spillervelger-rad" style="cursor:default">
            <span>${escHtml(_navnPaSpillerId[id] ?? '?')}</span>
            <select onchange="window.flyttProvenSpiller?.('${id}', this.value)">
              ${_puljeUtkast.map(p2 => `<option value="${p2.navn}" ${p2.navn === p.navn ? 'selected' : ''}>Pulje ${p2.navn}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="padding:16px 0">
      <div class="sl-regel-boks">Puljene er trukket tilfeldig. Bytt spillere mellom puljene under om nødvendig, før du starter puljespillet.</div>
      ${puljeHtml}
      <button class="knapp knapp-omriss" style="width:100%;margin-top:8px" onclick="window.trekkProvenPuljerPaNytt?.()">🎲 Trekk på nytt</button>
      <button class="knapp knapp-primaer" style="width:100%;margin-top:8px" onclick="window.startProvenPuljespill?.()">Start puljespill</button>
    </div>
  `;
}

window.flyttProvenSpiller = function (spillerId, nyPuljeNavn) {
  _puljeUtkast.forEach(p => { p.spillereIds = p.spillereIds.filter(id => id !== spillerId); });
  const mal = _puljeUtkast.find(p => p.navn === nyPuljeNavn);
  if (mal) mal.spillereIds.push(spillerId);
  renderPuljetrekningUI();
};

window.trekkProvenPuljerPaNytt = async function () {
  try {
    _puljeUtkast = await trekkPuljerForEvent(_aktivEventId);
    renderPuljetrekningUI();
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

window.startProvenPuljespill = function () {
  const ubalansert = _puljeUtkast.some(p => p.spillereIds.length !== 4);
  if (ubalansert) { visMelding('Hver pulje må ha nøyaktig 4 spillere før du kan starte.', 'advarsel'); return; }
  _krevAdmin('Start puljespill', `Genererer kampoppsett for alle ${_puljeUtkast.length} puljer og starter kvelden. Lag/puljer låses etter dette.`, () => {
    (async () => {
      try {
        await lagrePuljejustering(_aktivEventId, _puljeUtkast);
        await startPuljespill(_aktivEventId);
        window.visProvenPuljespill?.(_aktivEventId);
      } catch (e) {
        visMelding(e.message, 'feil');
      }
    })();
  });
};

window.tilbakeFraProvenOppsett = function () {
  window.visProvenOversikt?.();
};

// ════════════════════════════════════════════════════════
// STORSKJERM (generell, klubb-nivå) — samme lenke/QR-modal som
// puljespill-/sluttspill-skjermen bruker, men uten ?event=...
// i lenken. mesteren-viewer.html følger da automatisk siste
// aktive event for klubben — praktisk for å sette opp TV-en
// FØR kvelden starter, uten å måtte vite hvilket event det blir.
// ════════════════════════════════════════════════════════
window.visMesterenStorskjermModalGenerell = function () {
  const klubbId = _getAktivKlubbId();
  if (!klubbId) { visMelding('Velg klubb først.', 'advarsel'); return; }

  const url = new URL('mesteren-viewer.html', location.href);
  url.searchParams.set('klubb', klubbId);
  const lenke = url.toString();

  const modal       = document.getElementById('modal-mesteren-storskjerm');
  const qrContainer = document.getElementById('mesteren-storskjerm-qr');
  const lenkeTekst  = document.getElementById('mesteren-storskjerm-lenke-tekst');
  const apneLenke   = document.getElementById('mesteren-storskjerm-apne-lenke');
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
      console.warn('[Mesteren storskjerm] Kunne ikke generere QR-kode:', e?.message);
    }
  }

  modal.style.display = 'flex';
};

// ════════════════════════════════════════════════════════
// STORSKJERM (event-spesifikk) — brukes fra selve puljespill-/
// sluttspill-skjermen (der resultater registreres). Peker til
// nøyaktig det aktive eventet via ?event=..., slik at storskjermen
// ikke er avhengig av "finn siste aktive event"-logikken i
// mesteren-viewer.html.
// ════════════════════════════════════════════════════════
window.visMesterenStorskjermModal = function () {
  if (!_aktivEventId) { visMelding('Fant ikke aktivt event.', 'advarsel'); return; }
  const klubbId = _getAktivKlubbId();
  if (!klubbId) { visMelding('Velg klubb først.', 'advarsel'); return; }

  const url = new URL('mesteren-viewer.html', location.href);
  url.searchParams.set('klubb', klubbId);
  url.searchParams.set('event', _aktivEventId);
  const lenke = url.toString();

  const modal       = document.getElementById('modal-mesteren-storskjerm');
  const qrContainer = document.getElementById('mesteren-storskjerm-qr');
  const lenkeTekst  = document.getElementById('mesteren-storskjerm-lenke-tekst');
  const apneLenke   = document.getElementById('mesteren-storskjerm-apne-lenke');
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
      console.warn('[Mesteren storskjerm] Kunne ikke generere QR-kode:', e?.message);
    }
  }

  modal.style.display = 'flex';
};

window.kopierMesterenStorskjermLenke = async function () {
  const modal = document.getElementById('modal-mesteren-storskjerm');
  const lenke = modal?.dataset?.lenke;
  if (!lenke) return;
  try {
    await navigator.clipboard.writeText(lenke);
    visMelding('Lenke kopiert!');
  } catch (e) {
    prompt('Kopier lenken manuelt:', lenke);
  }
};

window.lukkMesterenStorskjermModal = function () {
  const modal = document.getElementById('modal-mesteren-storskjerm');
  if (modal) modal.style.display = 'none';
};
