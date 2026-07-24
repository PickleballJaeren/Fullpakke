// ════════════════════════════════════════════════════════
// stafettliga-spill-ui.js — Live kampregistrering
// Faner for Nivå / Mix / Stafett, delkamp-kort med
// poenginntasting og bekreftelsesflyt, samt bonuskamp-kort.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding } from './ui.js';
import { renderTomTilstand } from './render-helpers.js';
import {
  hentSesong, hentLagkamp, hentLagkamperForSesong, hentBonuskamperForRunde,
  registrerDelkampResultat, korrigerDelkampResultat, registrerBonuskampResultat,
  genererLagkampSpilleroppsett,
  hentGodkjenningsstatusForRunde, godkjennRunde,
} from './stafettliga.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger   = () => {};
let _krevAdmin = () => {};

export function stafettligaSpillUIInit(deps) {
  _naviger   = deps.naviger;
  _krevAdmin = deps.krevAdmin;
}

let _sesong        = null;
let _lagkamp       = null;
let _oppsett       = null; // { fase1: {niva1,niva2}, fase2: {mix1,mix2} }
let _bonuskamper   = [];   // bonuskamper for gjeldende runde
let _aktivFane     = 'fase1';

const NAVN_FOR_DELKAMP = {
  niva1: 'Nivå 1', niva2: 'Nivå 2',
  mix1:  'Mix 1',  mix2:  'Mix 2',
  stafettA: 'Stafett A', stafettB: 'Stafett B',
};

// ════════════════════════════════════════════════════════
// LISTE OVER LAGKAMPER FOR SESONGEN
// ════════════════════════════════════════════════════════
export async function visStafettligaLagkamper(sesongId) {
  const container = document.getElementById('stafettliga-tabell-innhold');
  if (!container) return;
  container.innerHTML = '<div class="tom-tilstand-liten">Laster …</div>';

  const [sesong, lagkamper] = await Promise.all([hentSesong(sesongId), hentLagkamperForSesong(sesongId)]);
  const lagNavn = id => sesong.lag.find(l => l.id === id)?.navn ?? '?';

  const STATUS_KLASSE = { ikke_startet: 'ts-setup', pagar: 'ts-aktiv', venter_godkjenning: 'ts-seeding', godkjent: 'ts-ferdig' };
  const STATUS_TEKST  = { ikke_startet: 'Ikke startet', pagar: 'Pågår', venter_godkjenning: 'Venter godkjenning', godkjent: 'Godkjent' };

  container.innerHTML = (lagkamper.length ? lagkamper.map(k => `
    <div class="t-lag-element" style="cursor:pointer;margin-bottom:8px" onclick="window.apneStafettligaLagkamp?.('${k.id}')">
      <div style="flex:1">
        <div style="font-size:16px;font-weight:600">${escHtml(lagNavn(k.lag1Id))} – ${escHtml(lagNavn(k.lag2Id))}</div>
        <div style="font-size:13px;color:var(--muted2)">${k.erPlasseringskamp ? escHtml(k.navn ?? '') : 'Runde ' + k.rundeNr}</div>
      </div>
      <span class="t-status-merke ${STATUS_KLASSE[k.status] ?? 'ts-setup'}">
        ${k.lagpoeng ? `${k.lagpoeng.lag1}–${k.lagpoeng.lag2}` : escHtml(STATUS_TEKST[k.status] ?? k.status)}
      </span>
    </div>
  `).join('') : renderTomTilstand('Ingen lagkamper generert ennå.'));
}
window.visStafettligaLagkamper = visStafettligaLagkamper;

// ════════════════════════════════════════════════════════
// ÅPNE ÉN LAGKAMP
// ════════════════════════════════════════════════════════
export async function apneStafettligaLagkamp(lagkampId) {
  _lagkamp = await hentLagkamp(lagkampId);
  _sesong  = await hentSesong(_lagkamp.sesongId);

  const lag1 = _sesong.lag.find(l => l.id === _lagkamp.lag1Id);
  const lag2 = _sesong.lag.find(l => l.id === _lagkamp.lag2Id);
  const lagkampNrForRotasjon = _lagkamp.erPlasseringskamp ? 1 : _lagkamp.rundeNr;

  _oppsett = genererLagkampSpilleroppsett(
    lag1, lag2, lagkampNrForRotasjon,
    _sesong.bonustypeNiva1, _sesong.bonustypeNiva2,
  );
  _bonuskamper = _lagkamp.erPlasseringskamp ? [] : await hentBonuskamperForRunde(_sesong.id, _lagkamp.rundeNr);

  document.getElementById('stafettliga-lagkamp-tittel').textContent = `${lag1.navn} – ${lag2.navn}`;
  _naviger('stafettliga-lagkamp');
  byttStafettligaFane('fase1');
}
window.apneStafettligaLagkamp = apneStafettligaLagkamp;

export function byttStafettligaFane(fase) {
  _aktivFane = fase;
  document.querySelectorAll('#stafettliga-fase-faner .sl-fase-fane').forEach(el => {
    el.classList.toggle('aktiv', el.dataset.fase === fase);
  });
  renderAktivFane();
}
window.byttStafettligaFane = byttStafettligaFane;

// Tilbake-knappen på lagkamp-skjermen skal gå rett til lagkampoversikten
// (listen kampen ble åpnet fra), ikke til poengtabellen.
window.tilbakeTilStafettligaLagkamper = function () {
  if (_sesong?.id) visStafettligaLagkamper(_sesong.id);
};

async function renderAktivFane() {
  const container = document.getElementById('stafettliga-lagkamp-innhold');
  if (!container || !_lagkamp) return;

  // Hent ferskeste lagkamp-data (andre lag kan ha registrert i mellomtiden)
  _lagkamp = await hentLagkamp(_lagkamp.id);

  const lag1 = _sesong.lag.find(l => l.id === _lagkamp.lag1Id);
  const lag2 = _sesong.lag.find(l => l.id === _lagkamp.lag2Id);

  let html = '';

  if (_aktivFane === 'fase1') {
    html += renderNivaDelkamp('niva1', 'Nivå 1', _oppsett.fase1.niva1, lag1, lag2);
    html += renderNivaDelkamp('niva2', 'Nivå 2', _oppsett.fase1.niva2, lag1, lag2);
    html += renderBonuskamperForNiva('niva1');
  } else if (_aktivFane === 'fase2') {
    html += renderMixDelkamp('mix1', 'Mix 1', _oppsett.fase2.mix1);
    html += renderMixDelkamp('mix2', 'Mix 2', _oppsett.fase2.mix2);
    html += renderBonuskamperForNiva('niva2');
  } else if (_aktivFane === 'fase3') {
    html += renderStafettDelkamp('stafettA', 'Stafett A', lag1, lag2);
    html += renderStafettDelkamp('stafettB', 'Stafett B', lag1, lag2);
    html += await renderGodkjennRundePanel();
  }

  container.innerHTML = html;
}

// ════════════════════════════════════════════════════════
// RENDER — Nivå-delkamp (fase1)
// ════════════════════════════════════════════════════════
function renderNivaDelkamp(delkampKey, tittel, nivaOppsett, lag1, lag2) {
  const par1 = nivaOppsett.lag1.modus === 'ordinaer' ? nivaOppsett.lag1.par : nivaOppsett.lag1.ordinaerPar;
  const par2 = nivaOppsett.lag2.modus === 'ordinaer' ? nivaOppsett.lag2.par : nivaOppsett.lag2.ordinaerPar;
  const navn1 = par1 ? par1.map(s => s.navn).join(' / ') : '?';
  const navn2 = par2 ? par2.map(s => s.navn).join(' / ') : '?';

  let rotasjonsNotis = '';
  if (nivaOppsett.lag1.modus === 'halvtidsrotasjon' || nivaOppsett.lag2.modus === 'halvtidsrotasjon') {
    const rot = nivaOppsett.lag1.modus === 'halvtidsrotasjon' ? nivaOppsett.lag1 : nivaOppsett.lag2;
    rotasjonsNotis = `<div style="font-size:12px;color:var(--muted2);margin-top:4px">
      ↻ Halvtidsrotasjon: ${escHtml(rot.hvilerForst.navn)} hviler 1. halvdel, ${escHtml(rot.hvilerAndre.navn)} hviler 2. halvdel
    </div>`;
  }
  if (nivaOppsett.lag1.modus === 'bonus' || nivaOppsett.lag2.modus === 'bonus') {
    const bonusNavn = [nivaOppsett.lag1, nivaOppsett.lag2].find(o => o.modus === 'bonus')?.bonusSpiller?.navn;
    rotasjonsNotis = `<div style="font-size:12px;color:var(--yellow);margin-top:4px">🎁 ${escHtml(bonusNavn)} spiller bonuskamp denne lagkampen</div>`;
  }

  const data = _lagkamp.fase1[delkampKey];
  return renderDelkampKort('fase1', delkampKey, tittel, navn1, navn2, data, rotasjonsNotis);
}

// ════════════════════════════════════════════════════════
// RENDER — Mix-delkamp (fase2)
// ════════════════════════════════════════════════════════
function renderMixDelkamp(delkampKey, tittel, mixOppsett) {
  const navn1 = mixOppsett.lag1Par ? `${mixOppsett.lag1Par.niva1.navn} / ${mixOppsett.lag1Par.niva2.navn}` : '?';
  const navn2 = mixOppsett.lag2Par ? `${mixOppsett.lag2Par.niva1.navn} / ${mixOppsett.lag2Par.niva2.navn}` : '?';
  const data = _lagkamp.fase2[delkampKey];
  return renderDelkampKort('fase2', delkampKey, tittel, navn1, navn2, data, '');
}

// ════════════════════════════════════════════════════════
// RENDER — Stafett-delkamp (fase3)
// ════════════════════════════════════════════════════════
function renderStafettDelkamp(delkampKey, tittel, lag1, lag2) {
  const data = _lagkamp.fase3[delkampKey];
  return renderDelkampKort('fase3', delkampKey, tittel, `${lag1.navn} (hele laget)`, `${lag2.navn} (hele laget)`, data,
    '<div style="font-size:12px;color:var(--muted2);margin-top:4px">Rally til 16 · vinnerpoeng må tas på egen serve</div>');
}

// ════════════════════════════════════════════════════════
// RENDER — felles delkamp-kort m/ poenginntasting og bekreftelse
// ════════════════════════════════════════════════════════
function renderDelkampKort(fase, delkampKey, tittel, navn1, navn2, data, notis) {
  const idSuffix = `${fase}_${delkampKey}`;
  const erFerdig  = data?.ferdig;
  const erLast    = _lagkamp.status === 'godkjent';

  const statusBadge = erLast
    ? '<span class="sl-bekreft-status sl-bekreft-ok">🔒 Godkjent</span>'
    : erFerdig ? '<span class="sl-bekreft-status sl-bekreft-ok">✓ Registrert</span>' : '';

  const inputHtml = erFerdig || erLast
    ? `<div class="sl-poeng-rad">
         <input id="sl-p1-${idSuffix}" class="sl-poeng-input" type="number" min="0" value="${data?.poeng1 ?? ''}" ${erLast ? 'disabled' : ''}>
         <div style="color:var(--muted2)">–</div>
         <input id="sl-p2-${idSuffix}" class="sl-poeng-input" type="number" min="0" value="${data?.poeng2 ?? ''}" ${erLast ? 'disabled' : ''}>
       </div>`
    : `<div class="sl-poeng-rad">
         <input id="sl-p1-${idSuffix}" class="sl-poeng-input" type="number" min="0" inputmode="numeric" placeholder="0">
         <div style="color:var(--muted2)">–</div>
         <input id="sl-p2-${idSuffix}" class="sl-poeng-input" type="number" min="0" inputmode="numeric" placeholder="0">
       </div>`;

  const knapper = erLast
    ? `<button class="knapp knapp-omriss" style="width:100%;margin-top:10px"
         onclick="window.krevAdminKorrigerStafettliga?.('${fase}','${delkampKey}')">Admin: korriger resultat</button>`
    : `<button class="knapp knapp-primaer" style="width:100%;margin-top:10px"
         onclick="window.lagreStafettligaDelkamp?.('${fase}','${delkampKey}')">${erFerdig ? 'Oppdater resultat' : 'Lagre resultat'}</button>`;

  return `
    <div class="sl-delkamp-kort">
      <div class="sl-delkamp-tittel"><span>${escHtml(tittel)}</span>${statusBadge}</div>
      <div class="sl-par-rad"><span class="sl-navn">${escHtml(navn1)}</span></div>
      <div class="sl-mot">mot</div>
      <div class="sl-par-rad"><span class="sl-navn">${escHtml(navn2)}</span></div>
      ${notis}
      ${inputHtml}
      ${knapper}
    </div>
  `;
}

window.lagreStafettligaDelkamp = async function (fase, delkampKey) {
  const idSuffix = `${fase}_${delkampKey}`;
  const p1 = parseInt(document.getElementById(`sl-p1-${idSuffix}`)?.value, 10);
  const p2 = parseInt(document.getElementById(`sl-p2-${idSuffix}`)?.value, 10);
  try {
    await registrerDelkampResultat(_lagkamp.id, fase, delkampKey, p1, p2);
    await renderAktivFane();
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};

window.krevAdminKorrigerStafettliga = function (fase, delkampKey) {
  _krevAdmin('Korriger resultat', 'Skriv inn riktig resultat for delkampen.', async () => {
    const p1 = parseInt(prompt('Poeng lag 1:') ?? '', 10);
    const p2 = parseInt(prompt('Poeng lag 2:') ?? '', 10);
    try {
      await korrigerDelkampResultat(_lagkamp.id, fase, delkampKey, p1, p2);
      await renderAktivFane();
    } catch (e) {
      visMelding(e.message, 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// ADMIN — GODKJENN RUNDE
// Vises nederst på fase3-fanen (siste steg i en lagkamp).
// ════════════════════════════════════════════════════════
async function renderGodkjennRundePanel() {
  const { klarTilGodkjenning, alleredeGodkjent } = await hentGodkjenningsstatusForRunde(_sesong.id, _lagkamp.rundeNr);

  if (alleredeGodkjent) {
    return `<div class="sl-regel-boks" style="margin-top:14px">✓ Runde ${_lagkamp.rundeNr} er godkjent av admin.</div>`;
  }
  if (!klarTilGodkjenning) {
    return `<div class="sl-regel-boks" style="margin-top:14px">Venter på at alle resultater i runden (alle lagkamper og bonuskamper) blir registrert før admin kan godkjenne.</div>`;
  }
  return `
    <div class="sl-regel-boks" style="margin-top:14px">
      Alle resultater i runde ${_lagkamp.rundeNr} er registrert.
      <button class="knapp knapp-primaer" style="width:100%;margin-top:10px" onclick="window.godkjennStafettligaRunde?.()">
        Admin: Godkjenn runde ${_lagkamp.rundeNr}
      </button>
    </div>`;
}

window.godkjennStafettligaRunde = function () {
  _krevAdmin('Godkjenn runde', `Godkjenn alle resultater i runde ${_lagkamp.rundeNr} og åpne neste runde.`, async () => {
    try {
      await godkjennRunde(_sesong.id, _lagkamp.rundeNr);
      await renderAktivFane();
    } catch (e) {
      visMelding(e.message, 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// BONUSKAMPER — vises under fase1 (nivå1-bonus) og fase2 (nivå2-bonus)
// ════════════════════════════════════════════════════════
function renderBonuskamperForNiva(niva) {
  const relevante = _bonuskamper.filter(b => b.niva === niva);
  if (!relevante.length) return '';

  return relevante.map(b => {
    const tittelForType = { bonussingle: 'Bonussingle', '3spillerbonus': '3-spillerbonus', bonusdobbel: 'Bonusdobbel' };
    const deltakere = b.spillere.map(s => `${escHtml(s.spillerNavn)} (${escHtml(s.lagNavn)})`).join(' · ');

    if (b.ferdig) {
      const resultatTekst = b.type === '3spillerbonus'
        ? `${b.resultat.poengA}–${b.resultat.poengB}–${b.resultat.poengC}`
        : `${b.resultat.poeng1}–${b.resultat.poeng2}`;
      return `
        <div class="sl-delkamp-kort">
          <div class="sl-delkamp-tittel"><span>🎁 ${tittelForType[b.type]}</span><span class="sl-bekreft-status sl-bekreft-ok">✓ Ferdig</span></div>
          <div style="font-size:14px;color:var(--muted2);margin-bottom:6px">${deltakere}</div>
          <div class="sl-poeng-input" style="text-align:left">${resultatTekst}</div>
        </div>`;
    }

    const inputHtml = b.type === '3spillerbonus'
      ? b.spillere.map((s, i) => `
          <div style="margin-bottom:6px">
            <label style="font-size:13px;color:var(--muted2)">${escHtml(s.spillerNavn)}</label>
            <input id="sl-bonus-${b.id}-${i}" type="number" min="0" style="width:100%">
          </div>`).join('')
      : `<div class="sl-poeng-rad">
           <input id="sl-bonus-${b.id}-0" class="sl-poeng-input" type="number" min="0" placeholder="0">
           <div style="color:var(--muted2)">–</div>
           <input id="sl-bonus-${b.id}-1" class="sl-poeng-input" type="number" min="0" placeholder="0">
         </div>`;

    return `
      <div class="sl-delkamp-kort">
        <div class="sl-delkamp-tittel"><span>🎁 ${tittelForType[b.type]}</span></div>
        <div style="font-size:14px;color:var(--muted2);margin-bottom:6px">${deltakere}</div>
        ${inputHtml}
        <button class="knapp knapp-primaer" style="width:100%;margin-top:10px" onclick="window.lagreStafettligaBonus?.('${b.id}')">Lagre resultat</button>
      </div>`;
  }).join('');
}

window.lagreStafettligaBonus = async function (bonusId) {
  const bonus = _bonuskamper.find(b => b.id === bonusId);
  if (!bonus) return;
  try {
    let resultat;
    if (bonus.type === '3spillerbonus') {
      resultat = {
        poengA: parseInt(document.getElementById(`sl-bonus-${bonusId}-0`)?.value, 10),
        poengB: parseInt(document.getElementById(`sl-bonus-${bonusId}-1`)?.value, 10),
        poengC: parseInt(document.getElementById(`sl-bonus-${bonusId}-2`)?.value, 10),
      };
    } else {
      resultat = {
        poeng1: parseInt(document.getElementById(`sl-bonus-${bonusId}-0`)?.value, 10),
        poeng2: parseInt(document.getElementById(`sl-bonus-${bonusId}-1`)?.value, 10),
      };
    }
    await registrerBonuskampResultat(bonusId, resultat);
    _bonuskamper = await hentBonuskamperForRunde(_sesong.id, _lagkamp.rundeNr);
    await renderAktivFane();
  } catch (e) {
    visMelding(e.message, 'feil');
  }
};
