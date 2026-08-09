// ════════════════════════════════════════════════════════
// proven-ui.js — Oversikt, oppsett (spillerplukk + puljetrekning)
// og arkiv/Hall of Fame for Prøven.
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

export function provenUIInit(deps) {
  _naviger   = deps.naviger;
  _krevAdmin = deps.krevAdmin;
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
    container.innerHTML = renderTomTilstand('Ingen aktive Prøven-eventer ennå. Trykk «+ Ny» for å starte.', true);
    return;
  }

  const STATUS_TEKST  = { oppsett: 'Oppsett', puljespill: 'Puljespill', sluttspill: 'Sluttspill' };
  const STATUS_KLASSE = { oppsett: 'ts-setup', puljespill: 'ts-aktiv', sluttspill: 'ts-seeding' };

  container.innerHTML = eventer.map(e => `
    <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneProvenEvent?.('${e.id}')">
      <div style="flex:1">
        <div style="font-size:17px;font-weight:600">${escHtml(e.navn)} <span style="color:var(--muted2);font-weight:400">#${e.eventNr}</span></div>
        <div style="font-size:13px;color:var(--muted2);margin-top:2px">16 spillere</div>
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
  _krevAdmin('Slett Prøve', `Sletter «${navn}» permanent. Dette kan ikke angres.`, () => {
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
  _krevAdmin('Ny Prøve', 'Kun admin kan opprette et nytt Prøven-event.', () => {
    _naviger('proven-oppsett');
    document.getElementById('proven-oppsett-tittel').textContent = 'Ny Prøve';
    renderSpillerplukkSteg1();
  });
}
window.opprettProvenEventUI = opprettProvenEventUI;

let _alleSpillere = [];
let _valgteSpillere = []; // [{id, navn, kilde, wildcardBegrunnelse}]
let _provenNavn = '';

async function renderSpillerplukkSteg1() {
  _valgteSpillere = [];
  _provenNavn = '';
  const container = document.getElementById('proven-oppsett-innhold');
  container.innerHTML = '<div class="tom-tilstand-liten">Laster spillere …</div>';
  _alleSpillere = await hentSpillere();
  renderSpillerplukkUI();
}

function _alleValgteIder() {
  return new Set(_valgteSpillere.map(s => s.id));
}

function renderSpillerplukkUI() {
  const container = document.getElementById('proven-oppsett-innhold');
  const antall = _valgteSpillere.length;

  const listeHtml = _valgteSpillere.map((s, i) => `
    <div class="t-lag-element" style="margin-bottom:8px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escHtml(s.navn)}</div>
        <select style="margin-top:6px;width:auto;display:inline-block" onchange="window.settProvenKilde?.(${i}, this.value)">
          ${KILDER.map(k => `<option value="${k}" ${s.kilde === k ? 'selected' : ''}>${escHtml(KILDE_NAVN[k])}</option>`).join('')}
        </select>
        ${s.kilde === 'wildcard' ? `
          <input type="text" placeholder="Begrunnelse (valgfritt, kun synlig for admin)" value="${escHtml(s.wildcardBegrunnelse ?? '')}"
                 style="margin-top:6px" oninput="window.settWildcardBegrunnelse?.(${i}, this.value)">
        ` : ''}
      </div>
      <button class="knapp knapp-omriss knapp-liten" onclick="window.fjernProvenSpiller?.(${i})">✕</button>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="padding:16px 0">
      <label style="font-size:14px;color:var(--muted2)">Navn på eventet</label>
      <input id="pv-navn" type="text" placeholder="Prøven" value="${escHtml(_provenNavn)}" style="width:100%;margin:6px 0 16px" oninput="window._provenSettNavn?.(this.value)">

      <div class="sl-regel-boks">Velg nøyaktig 16 spillere og angi kilde for hver. <strong>${antall} / 16</strong> valgt.</div>

      ${listeHtml}

      <div style="margin-top:10px">
        <input type="text" placeholder="Søk etter spiller …" oninput="window.sokProvenSpiller?.(this.value)">
        <div class="sl-spillervelger-treff" id="pv-treff" style="display:none"></div>
      </div>

      <button class="knapp knapp-primaer" style="width:100%;margin-top:16px" ${antall === 16 ? '' : 'disabled'}
              onclick="window.gaTilPuljetrekning?.()">
        Neste — trekk puljer
      </button>
    </div>
  `;
}

window._provenSettNavn = function (v) { _provenNavn = v; };

window.sokProvenSpiller = function (sokTekst) {
  const treffContainer = document.getElementById('pv-treff');
  const tekst = sokTekst.trim();
  if (!tekst) { treffContainer.style.display = 'none'; treffContainer.innerHTML = ''; return; }

  const tekstLower = tekst.toLowerCase();
  const valgteIder = _alleValgteIder();
  const treff = _alleSpillere
    .filter(s => !valgteIder.has(s.id) && s.navn.toLowerCase().includes(tekstLower))
    .slice(0, 8);
  const finnesFraFor = _alleSpillere.some(s => s.navn.toLowerCase() === tekstLower);

  let html = treff.length
    ? treff.map(s => `
        <div class="sl-spillervelger-rad" onclick="window.velgProvenSpiller?.('${s.id}', '${escHtml(s.navn)}')">
          <span>${escHtml(s.navn)}</span>
        </div>`).join('')
    : '<div class="sl-spillervelger-rad" style="color:var(--muted2)">Ingen treff</div>';

  if (!finnesFraFor && _valgteSpillere.length < 16) {
    html += `
      <div class="sl-spillervelger-rad" style="color:var(--green,#2ecc71);font-weight:600" data-navn="${escHtml(tekst)}"
           onclick="window.leggTilNyProvenSpiller?.(this)">
        + Opprett ny spiller: «${escHtml(tekst)}»
      </div>`;
  }

  treffContainer.style.display = 'block';
  treffContainer.innerHTML = html;
};

window.velgProvenSpiller = function (id, navn) {
  if (_valgteSpillere.length >= 16) { visMelding('Du har allerede valgt 16 spillere.', 'advarsel'); return; }
  _valgteSpillere.push({ id, navn, kilde: '8eren', wildcardBegrunnelse: '' });
  renderSpillerplukkUI();
};

window.leggTilNyProvenSpiller = async function (el) {
  const navn = el?.dataset?.navn?.trim();
  if (!navn) return;
  el.textContent = 'Oppretter …';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0.6';
  try {
    const ny = await opprettSpiller(navn);
    _alleSpillere.push(ny);
    _alleSpillere.sort((a, b) => a.navn.localeCompare(b.navn, 'no'));
    _valgteSpillere.push({ id: ny.id, navn: ny.navn, kilde: '8eren', wildcardBegrunnelse: '' });
    renderSpillerplukkUI();
    visMelding(`${ny.navn} opprettet og lagt til`);
  } catch (e) {
    visMelding(e.message, 'feil');
    el.textContent = `+ Opprett ny spiller: «${navn}»`;
    el.style.pointerEvents = '';
    el.style.opacity = '';
  }
};

window.fjernProvenSpiller = function (i) {
  _valgteSpillere.splice(i, 1);
  renderSpillerplukkUI();
};

window.settProvenKilde = function (i, kilde) {
  _valgteSpillere[i].kilde = kilde;
  renderSpillerplukkUI();
};

window.settWildcardBegrunnelse = function (i, tekst) {
  if (_valgteSpillere[i]) _valgteSpillere[i].wildcardBegrunnelse = tekst;
};

// ════════════════════════════════════════════════════════
// OPPRETTING — steg 2: puljetrekning + manuell justering
// ════════════════════════════════════════════════════════
window.gaTilPuljetrekning = async function () {
  if (_valgteSpillere.length !== 16) { visMelding('Velg nøyaktig 16 spillere.', 'advarsel'); return; }
  try {
    const eventId = await opprettProvenEvent({ navn: _provenNavn, spillere: _valgteSpillere });
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
  _krevAdmin('Start puljespill', 'Genererer kampoppsett for alle 4 puljer og starter kvelden. Lag/puljer låses etter dette.', () => {
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
