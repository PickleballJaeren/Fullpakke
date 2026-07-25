// ════════════════════════════════════════════════════════
// stafettliga-logikk.js — Ren stafettliga-logikk
// Ingen Firebase-avhengigheter, ingen DOM, ingen async/await,
// og ingen avhengighet til andre moduler i appen — helt selvstendig.
//
// Importeres av stafettliga.js og stafettliga-ui.js.
// ════════════════════════════════════════════════════════

/** Fisher-Yates-stokking — brukt til lagtrekning/seeding. */
export function blandArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Round robin-kampoppsett (Berger-tabell) — alle lag møter hverandre én gang.
 * @param {string[]} lagIds
 */
export function genererRoundRobin(lagIds) {
  const n      = lagIds.length;
  const kamper = [];
  let kampNr   = 1;

  if (n < 2) return kamper;

  const liste = [...lagIds];
  if (n % 2 !== 0) liste.push('BYE');
  const m = liste.length;

  for (let runde = 0; runde < m - 1; runde++) {
    for (let i = 0; i < m / 2; i++) {
      const h = liste[i];
      const b = liste[m - 1 - i];
      if (h !== 'BYE' && b !== 'BYE') {
        kamper.push({
          id:        `rr_${kampNr}`,
          kampNr:    kampNr++,
          runde:     runde + 1,
          lag1Id:    h,
          lag2Id:    b,
          lag1Poeng: null,
          lag2Poeng: null,
          ferdig:    false,
        });
      }
    }
    const siste = liste.pop();
    liste.splice(1, 0, siste);
  }

  return kamper;
}

// ════════════════════════════════════════════════════════
// LAGSTØRRELSE OG REGEL (§2 og §6 i reglementet)
// ════════════════════════════════════════════════════════

const LAGSTORRELSE_4 = {
  16: { lagStorrelser: [4, 4, 4, 4],       regel: 'A' },
  17: { lagStorrelser: [5, 4, 4, 4],       regel: 'B' },
  18: { lagStorrelser: [5, 5, 4, 4],       regel: 'C' },
  19: { lagStorrelser: [5, 5, 5, 4],       regel: 'D' },
  20: { lagStorrelser: [5, 5, 5, 5],       regel: 'E' },
  21: { lagStorrelser: [6, 5, 5, 5],       regel: 'F' },
  22: { lagStorrelser: [6, 6, 5, 5],       regel: 'G' },
  23: { lagStorrelser: [6, 6, 6, 5],       regel: 'H' },
};

const LAGSTORRELSE_6 = {
  24: { lagStorrelser: [4, 4, 4, 4, 4, 4], regel: 'A' },
  25: { lagStorrelser: [5, 4, 4, 4, 4, 4], regel: 'B' },
  26: { lagStorrelser: [5, 5, 4, 4, 4, 4], regel: 'C' },
  27: { lagStorrelser: [5, 5, 5, 4, 4, 4], regel: 'D' },
  28: { lagStorrelser: [5, 5, 5, 5, 4, 4], regel: 'E' },
};

/**
 * Beregner antall lag, lagstørrelser og regelbokstav ut fra antall deltakere.
 * @param {number} antallDeltakere — 16–28
 * @returns {{ antallLag: 4|6, lagStorrelser: number[], regel: string }}
 */
export function beregnLagoppsett(antallDeltakere) {
  if (antallDeltakere >= 16 && antallDeltakere <= 23) {
    const info = LAGSTORRELSE_4[antallDeltakere];
    return { antallLag: 4, ...info };
  }
  if (antallDeltakere >= 24 && antallDeltakere <= 28) {
    const info = LAGSTORRELSE_6[antallDeltakere];
    return { antallLag: 6, ...info };
  }
  throw new Error(`Stafettligaen støtter 16–28 deltakere (fikk ${antallDeltakere}).`);
}

/**
 * Foreslår nivå1/nivå2-fordeling for en gitt lagstørrelse.
 * Ved oddetall (5 spillere) er 3+2 vs 2+3 et bevisst valg admin gjør ut fra
 * spillernes faktiske nivå — denne funksjonen gir kun et nøytralt forslag
 * (flest på nivå1) som utgangspunkt for UI-et.
 * @param {number} lagStorrelse
 */
export function foreslaNivaFordeling(lagStorrelse) {
  const niva1 = Math.ceil(lagStorrelse / 2);
  return { niva1, niva2: lagStorrelse - niva1 };
}

// ════════════════════════════════════════════════════════
// ROTASJONSSYKLUS (§7) — kjernen i all halvtidsrotasjon for
// nivåer med 3 spillere. Én sammenhengende syklus av 3
// tilstander som gjelder gjennom HELE kvelden (ikke per fase
// eller per lagkamp): hver halvdel av spill — nivådobbel
// 1./2. halvdel, deretter mixdobbel 1./2. halvdel — rykker
// syklusen ett steg videre. Regelen er alltid den samme:
// hvileren kommer inn på slot1, forrige slot1 flytter til
// slot2, forrige slot2 blir ny hviler.
//
// Indeksene 0/1/2 refererer til spillerens faste posisjon i
// lagets nivå-gruppe (satt ved lagtrekning), ikke spiller-ID.
// ════════════════════════════════════════════════════════
const ROTASJONSSYKLUS = [
  { hviler: 2, slot1: 0, slot2: 1 },
  { hviler: 1, slot1: 2, slot2: 0 },
  { hviler: 0, slot1: 1, slot2: 2 },
];

function rotasjonstilstand(steg) {
  return ROTASJONSSYKLUS[((steg % 3) + 3) % 3];
}

/**
 * Hver lagkamp består av 4 halvdeler i fast rekkefølge (nivådobbel
 * 1./2. halvdel, mixdobbel 1./2. halvdel). Siden 4 halvdeler ≡ 1 steg
 * (mod 3), gir dette akkurat ett steg videre i syklusen fra én lagkamp
 * til neste — og alt henger sammen kontinuerlig gjennom hele kvelden.
 * @param {number} lagkampNr — 1-indeksert
 */
function forsteStegForLagkamp(lagkampNr) {
  return (lagkampNr - 1) % 3;
}

/** @param {number} lagkampNr — 1-indeksert */
export function hentHalvtidsrotasjon(lagkampNr) {
  const steg  = forsteStegForLagkamp(lagkampNr);
  const forst = rotasjonstilstand(steg);
  const andre = rotasjonstilstand(steg + 1);
  return {
    startpar:          [forst.slot1, forst.slot2],
    hvilerForst:       forst.hviler,
    parEtterSidebytte: [andre.slot1, andre.slot2],
    hvilerAndre:       andre.hviler,
  };
}

/**
 * Halvtidsrotasjon for MIXDOBBELEN (fase 2) — fortsetter den samme
 * sammenhengende syklusen videre fra nivådobbelen (steg 2 og 3 av
 * lagkampens 4 halvdeler). Brukes kun når nivået har 3 spillere OG
 * er i halvtidsrotasjon-modus (ikke bonusmodus — se §8/§9 under).
 * @param {number} lagkampNr — 1-indeksert
 */
export function hentMixHalvtidsrotasjon(lagkampNr) {
  const steg  = forsteStegForLagkamp(lagkampNr);
  const forst = rotasjonstilstand(steg + 2);
  const andre = rotasjonstilstand(steg + 3);
  return {
    mix1Forst: forst.slot1, mix2Forst: forst.slot2, hvilerForst: forst.hviler,
    mix1Andre: andre.slot1, mix2Andre: andre.slot2, hvilerAndre: andre.hviler,
  };
}

// ════════════════════════════════════════════════════════
// BONUSROTASJON (§8) — når et nivå har 3 spillere og
// bonuskamp KAN arrangeres. Én spiller tildeles bonuskampen
// for hele lagkampen, de to andre spiller ordinær dobbel.
// ════════════════════════════════════════════════════════
const BONUSROTASJON = [
  { ordinaerPar: [0, 1], bonusSpiller: 2 },
  { ordinaerPar: [1, 2], bonusSpiller: 0 },
  { ordinaerPar: [2, 0], bonusSpiller: 1 },
];

export function hentBonusrotasjon(lagkampNr) {
  return BONUSROTASJON[(lagkampNr - 1) % 3];
}

/**
 * Beregner spilleroppsettet for ett nivå med 3 spillere, i én lagkamp.
 * Velger automatisk mellom bonusrotasjon (§8) og halvtidsrotasjon (§7)
 * ut fra om bonuskamp faktisk kan arrangeres denne sesongen for dette nivået.
 *
 * @param {Array} spillere3   — de tre spillerne på nivået, i lagets faste rekkefølge
 * @param {number} lagkampNr
 * @param {boolean} bonusMulig — true hvis ≥2 lag har 3 spillere på samme nivå denne sesongen
 * @returns {object} spilleroppsett for nivået
 */
export function beregnNivaOppsett(spillere3, lagkampNr, bonusMulig) {
  if (spillere3.length !== 3) {
    throw new Error('beregnNivaOppsett krever nøyaktig 3 spillere.');
  }

  if (bonusMulig) {
    const { ordinaerPar, bonusSpiller } = hentBonusrotasjon(lagkampNr);
    return {
      modus:        'bonus',
      ordinaerPar:  ordinaerPar.map(i => spillere3[i]),
      bonusSpiller: spillere3[bonusSpiller],
    };
  }

  const rot = hentHalvtidsrotasjon(lagkampNr);
  return {
    modus:              'halvtidsrotasjon',
    startpar:           rot.startpar.map(i => spillere3[i]),
    hvilerForst:        spillere3[rot.hvilerForst],
    parEtterSidebytte:  rot.parEtterSidebytte.map(i => spillere3[i]),
    hvilerAndre:        spillere3[rot.hvilerAndre],
  };
}

// ════════════════════════════════════════════════════════
// BONUSTYPE — hvor mange lag med 3 spillere på samme nivå
// avgjør hvilken bonuskamp som spilles (§9).
// ════════════════════════════════════════════════════════
const BONUSTYPE_FOR_ANTALL = {
  0: null,                 // ingen lag har 3 spillere her — vanlig kamp
  1: 'halvtidsrotasjon',   // kun 1 lag har 3 spillere — kan ikke bonuse alene, fallback til §7
  2: 'bonussingle',
  3: '3spillerbonus',
  4: 'bonusdobbel',
};

/**
 * @param {number} antallLagMed3Spillere — antall lag som har 3 spillere på dette nivået
 * @returns {string|null} bonustype, eller null om nivået ikke har noen lag med 3 spillere
 */
export function bestemBonustype(antallLagMed3Spillere) {
  if (antallLagMed3Spillere > 4) {
    throw new Error('Mer enn 4 lag med 3 spillere på samme nivå støttes ikke (maks 6 lag i ligaen).');
  }
  return BONUSTYPE_FOR_ANTALL[antallLagMed3Spillere] ?? null;
}

/** @returns {boolean} om bonustypen faktisk gir en bonuskamp (i motsetning til halvtidsrotasjon-fallback) */
export function erFaktiskBonuskamp(bonustype) {
  return bonustype === 'bonussingle' || bonustype === '3spillerbonus' || bonustype === 'bonusdobbel';
}

// ════════════════════════════════════════════════════════
// MIX-PARRING (Fase 2) — nivå1- og nivå2-spillere krysses.
// Sirkelmetode: nivå1 ligger fast, nivå2 roteres med offset
// avhengig av lagkampnummer. Gir maksimal variasjon av par
// uten hardkodede tabeller per lagstørrelse.
// ════════════════════════════════════════════════════════

/**
 * @param {Array} niva1Spillere
 * @param {Array} niva2Spillere — må ha samme lengde som niva1Spillere
 * @param {number} lagkampNr
 * @returns {Array<{niva1, niva2}>} alle mulige mixpar for denne lagkampen
 */
export function beregnMixPar(niva1Spillere, niva2Spillere, lagkampNr) {
  const n = niva1Spillere.length;
  if (niva2Spillere.length !== n) {
    throw new Error('Ulikt antall spillere på nivå1 og nivå2 støttes ikke i mix-rotasjonen.');
  }
  const offset = (lagkampNr - 1) % n;
  return niva1Spillere.map((s1, i) => ({
    niva1: s1,
    niva2: niva2Spillere[(i + offset) % n],
  }));
}

// ════════════════════════════════════════════════════════
// KOMPLETT LAGKAMP-OPPSETT — kombinerer nivå-rotasjon (§7/§8)
// og mix-parring til ett kall. Fase 3 (stafett) trenger ikke
// eget oppsett — alle lagets spillere deltar automatisk.
// ════════════════════════════════════════════════════════

/**
 * Velger de aktive nivå-spillerne for MIX-formål i en gitt lagkamp.
 * Ved 2 spillere: begge er alltid aktive. Ved 3 spillere: samme spiller
 * som er "den tredje" i §8-bonusrotasjonen ekskluderes fra mix — uansett
 * om vedkommende faktisk spiller bonuskamp eller havner i halvtidsrotasjon
 * (§7) den lagkampen. Én konsekvent regel: man er enten "på" eller "av"
 * for hele lagkampen, i både fase 1 og fase 2.
 */
/**
 * Velger de aktive nivå-spillerne for MIX-formål i en gitt lagkamp,
 * separat for 1. og 2. halvdel av mixdobbelen.
 * Ved 2 spillere: begge er alltid aktive, hele veien (ingen rotasjon).
 * Ved 3 spillere i BONUSMODUS: samme to spillere («ordinaerPar») hele
 * lagkampen — den tredje spiller bonuskamp i stedet og er borte fra
 * både nivådobbel og mixdobbel denne lagkampen.
 * Ved 3 spillere i HALVTIDSROTASJON-modus: fortsetter den samme
 * sammenhengende rotasjonssyklusen som nivådobbelen — den som hvilte
 * i nivådobbelen roterer inn i mixdobbelen etter halvspilt, akkurat
 * som §7 foreskriver.
 */
function velgAktiveNivaSpillereForMix(spillere, lagkampNr, erBonus) {
  if (spillere.length <= 2) {
    return { forst: spillere, andre: spillere };
  }
  if (erBonus) {
    const { ordinaerPar } = hentBonusrotasjon(lagkampNr);
    const par = ordinaerPar.map(i => spillere[i]);
    return { forst: par, andre: par };
  }
  const rot = hentMixHalvtidsrotasjon(lagkampNr);
  return {
    forst: [spillere[rot.mix1Forst], spillere[rot.mix2Forst]],
    andre: [spillere[rot.mix1Andre], spillere[rot.mix2Andre]],
  };
}

function genererNivaFaseOppsett(lag1Spillere, lag2Spillere, lagkampNr, bonustype) {
  const erBonus = erFaktiskBonuskamp(bonustype);
  const lag1 = lag1Spillere.length === 3
    ? beregnNivaOppsett(lag1Spillere, lagkampNr, erBonus)
    : { modus: 'ordinaer', par: lag1Spillere };
  const lag2 = lag2Spillere.length === 3
    ? beregnNivaOppsett(lag2Spillere, lagkampNr, erBonus)
    : { modus: 'ordinaer', par: lag2Spillere };
  return { lag1, lag2, bonustype };
}

/**
 * Genererer komplett spilleroppsett for fase1 (nivå) og fase2 (mix) i én lagkamp.
 * @param {{id, spillere:{niva1,niva2}}} lag1
 * @param {{id, spillere:{niva1,niva2}}} lag2
 * @param {number} lagkampNr
 * @param {string|null} bonustypeNiva1 — fra bestemBonustype(), fast for sesongen
 * @param {string|null} bonustypeNiva2
 */
export function genererLagkampSpilleroppsett(lag1, lag2, lagkampNr, bonustypeNiva1, bonustypeNiva2) {
  const fase1 = {
    niva1: genererNivaFaseOppsett(lag1.spillere.niva1, lag2.spillere.niva1, lagkampNr, bonustypeNiva1),
    niva2: genererNivaFaseOppsett(lag1.spillere.niva2, lag2.spillere.niva2, lagkampNr, bonustypeNiva2),
  };

  const erBonusNiva1 = erFaktiskBonuskamp(bonustypeNiva1);
  const erBonusNiva2 = erFaktiskBonuskamp(bonustypeNiva2);

  // Reduser hvert nivå til maks 2 aktive spillere FØR kryssing — løser
  // asymmetriske lagstørrelser (f.eks. 3 nivå1 + 2 nivå2) korrekt.
  // Gjøres separat for 1. og 2. halvdel slik at en eventuell tredje
  // spiller kan rotere inn i mixdobbelen etter halvspilt (§7).
  const aktivLag1Niva1 = velgAktiveNivaSpillereForMix(lag1.spillere.niva1, lagkampNr, erBonusNiva1);
  const aktivLag1Niva2 = velgAktiveNivaSpillereForMix(lag1.spillere.niva2, lagkampNr, erBonusNiva2);
  const aktivLag2Niva1 = velgAktiveNivaSpillereForMix(lag2.spillere.niva1, lagkampNr, erBonusNiva1);
  const aktivLag2Niva2 = velgAktiveNivaSpillereForMix(lag2.spillere.niva2, lagkampNr, erBonusNiva2);

  const mixPar1Forst = beregnMixPar(aktivLag1Niva1.forst, aktivLag1Niva2.forst, lagkampNr);
  const mixPar1Andre = beregnMixPar(aktivLag1Niva1.andre, aktivLag1Niva2.andre, lagkampNr);
  const mixPar2Forst = beregnMixPar(aktivLag2Niva1.forst, aktivLag2Niva2.forst, lagkampNr);
  const mixPar2Andre = beregnMixPar(aktivLag2Niva1.andre, aktivLag2Niva2.andre, lagkampNr);

  const fase2 = {
    mix1: {
      lag1Par: { forst: mixPar1Forst[0] ?? null, andre: mixPar1Andre[0] ?? null },
      lag2Par: { forst: mixPar2Forst[0] ?? null, andre: mixPar2Andre[0] ?? null },
    },
    mix2: {
      lag1Par: { forst: mixPar1Forst[1] ?? null, andre: mixPar1Andre[1] ?? null },
      lag2Par: { forst: mixPar2Forst[1] ?? null, andre: mixPar2Andre[1] ?? null },
    },
  };

  return { fase1, fase2 };
}

// ════════════════════════════════════════════════════════
// SERIEOPPSETT — 4 lag: round robin. 6 lag: trekning (3 runder,
// hver runde = 3 samtidige lagkamper) + sluttspill om plassering.
// ════════════════════════════════════════════════════════

/**
 * @param {string[]} lagIds
 * @param {4|6} antallLag
 */
export function genererSerieoppsett(lagIds, antallLag) {
  if (antallLag === 4) {
    if (lagIds.length !== 4) throw new Error('Forventet 4 lag-IDer.');
    return { type: 'round_robin', lagkamper: genererRoundRobin(lagIds) };
  }
  if (antallLag === 6) {
    if (lagIds.length !== 6) throw new Error('Forventet 6 lag-IDer.');
    return { type: 'trekning_sluttspill', lagkamper: genererTrekningSeksLag(lagIds) };
  }
  throw new Error('Stafettligaen støtter kun 4 eller 6 lag.');
}

/**
 * 6 lag, 3 runder. Hver runde er en perfekt matching (3 samtidige lagkamper),
 * og de 3 rundene er valgt slik at ingen to lag møtes to ganger — hvert lag
 * får dermed 3 ulike motstandere i løpet av kvelden.
 * Bruker samme sirkelmetode som genererRoundRobin(), men stopper etter 3 av
 * de 5 mulige rundene i en full round robin for 6 lag.
 */
export function genererTrekningSeksLag(lagIds) {
  const alle = genererRoundRobin(lagIds); // 5 runder for 6 lag, alle mot alle
  return alle.filter(k => k.runde <= 3);
}

/**
 * Genererer plasseringskamper for 6-lags sluttspill, basert på tabellen
 * etter de 3 ordinære lagkampene (§12-sortert liste av lagId-er, best først).
 * @param {string[]} sortertLagIdListe — 6 lagId-er i rangert rekkefølge
 */
export function genererPlasseringskamper(sortertLagIdListe) {
  if (sortertLagIdListe.length !== 6) throw new Error('Forventet 6 lag i sortert liste.');
  const [l1, l2, l3, l4, l5, l6] = sortertLagIdListe;
  return [
    { id: 'plassering_1_2', navn: 'Kamp om 1.–2. plass', lag1Id: l1, lag2Id: l2 },
    { id: 'plassering_3_4', navn: 'Kamp om 3.–4. plass', lag1Id: l3, lag2Id: l4 },
    { id: 'plassering_5_6', navn: 'Kamp om 5.–6. plass', lag1Id: l5, lag2Id: l6 },
  ];
}

// ════════════════════════════════════════════════════════
// 3-SPILLERBONUS — 1 mot 2, sideout-scoring, individuell
// poengakkumulering (§9).
// ════════════════════════════════════════════════════════

/**
 * Bryter ned resultatet av en 3-spillerbonuskamp i tre parvise resultater
 * som hver kan legges inn i poengprosent-regnskapet til de respektive lagene.
 *
 * @param {{lagId, spillerId, poeng}} spillerA
 * @param {{lagId, spillerId, poeng}} spillerB
 * @param {{lagId, spillerId, poeng}} spillerC
 * @returns {Array<{lag1Id, lag2Id, poeng1, poeng2}>} tre parvise resultater: A-B, A-C, B-C
 */
export function beregn3SpillerBonusNedbrytning(spillerA, spillerB, spillerC) {
  return [
    { lag1Id: spillerA.lagId, lag2Id: spillerB.lagId, poeng1: spillerA.poeng, poeng2: spillerB.poeng },
    { lag1Id: spillerA.lagId, lag2Id: spillerC.lagId, poeng1: spillerA.poeng, poeng2: spillerC.poeng },
    { lag1Id: spillerB.lagId, lag2Id: spillerC.lagId, poeng1: spillerB.poeng, poeng2: spillerC.poeng },
  ];
}

/** Enkel sanity-validering — ingen fast sum siden hver spiller akkumulerer uavhengig. */
export function valider3SpillerBonusPoeng(poeng) {
  if (isNaN(poeng) || poeng < 0) return { ok: false, feil: 'Poeng må være et positivt tall.' };
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// VALIDERING — nivå/mix (tidsbasert, sideout) og stafett
// (rally til 16, vinnerpoeng på egen serve).
// ════════════════════════════════════════════════════════

/**
 * Nivå- og mixkamper er tidsbaserte (10 min) uten fast makspoeng,
 * så eneste harde krav er ikke-negative heltall.
 */
export function validerDobbelResultat(poeng1, poeng2) {
  if (!Number.isInteger(poeng1) || !Number.isInteger(poeng2) || poeng1 < 0 || poeng2 < 0) {
    return { ok: false, feil: 'Poeng må være ikke-negative heltall.' };
  }
  return { ok: true };
}

/**
 * Stafett: rally til 16, vinner må ha minst 16 poeng og lede.
 * Merk: at vinnerpoenget faktisk ble tatt på egen serve kan ikke
 * verifiseres fra sluttresultatet alene — det er en kamparrangørregel,
 * ikke noe denne valideringen kan håndheve.
 */
export function validerStafettResultat(poeng1, poeng2) {
  if (!Number.isInteger(poeng1) || !Number.isInteger(poeng2) || poeng1 < 0 || poeng2 < 0) {
    return { ok: false, feil: 'Poeng må være ikke-negative heltall.' };
  }
  const vinner = Math.max(poeng1, poeng2);
  const taper  = Math.min(poeng1, poeng2);
  if (vinner < 16) return { ok: false, feil: 'Vinner må ha minst 16 poeng.' };
  if (vinner === taper) return { ok: false, feil: 'Stafett kan ikke ende uavgjort.' };
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// LAGPOENG (§10)
//
// Laget som har vunnet flest av de 6 ordinære delkampene (nivå1, nivå2,
// mix1, mix2, stafett A, stafett B — IKKE bonuskamper, jf. §10) vinner
// lagkampen. Står det 3–3 i delkampseire blir lagkampen uavgjort.
// ════════════════════════════════════════════════════════

/**
 * @param {object} lagkamp — med resultat for de 6 ordinære delkampene:
 *   { niva1: {poeng1,poeng2}, niva2, mix1, mix2, stafettA, stafettB }
 * @returns {{ lagpoeng1: 0|1|3, lagpoeng2: 0|1|3, delkampSeire1: number, delkampSeire2: number }}
 */
export function beregnLagpoeng(lagkamp) {
  const delkamper = ['niva1', 'niva2', 'mix1', 'mix2', 'stafettA', 'stafettB'];
  let delkampSeire1 = 0, delkampSeire2 = 0;

  for (const key of delkamper) {
    const d = lagkamp[key];
    if (!d || d.poeng1 == null || d.poeng2 == null) continue;
    if (d.poeng1 > d.poeng2)      delkampSeire1++;
    else if (d.poeng2 > d.poeng1) delkampSeire2++;
    // uavgjort delkamp (bør ikke forekomme jf. §4/§5, men telles ikke som seier for noen)
  }

  let lagpoeng1, lagpoeng2;
  if (delkampSeire1 > delkampSeire2)      { lagpoeng1 = 3; lagpoeng2 = 0; }
  else if (delkampSeire2 > delkampSeire1) { lagpoeng1 = 0; lagpoeng2 = 3; }
  else                                     { lagpoeng1 = 1; lagpoeng2 = 1; }

  return { lagpoeng1, lagpoeng2, delkampSeire1, delkampSeire2 };
}

// ════════════════════════════════════════════════════════
// POENGPROSENT (§11) — alt som spilles teller, inkl. bonuskamper.
// ════════════════════════════════════════════════════════

/**
 * @param {Array<{lag1Id, lag2Id, poeng1, poeng2}>} alleResultaterForSesongen
 *   — flat liste av ALLE delkamp- og bonuskampresultater i sesongen,
 *     normalisert til {lag1Id, lag2Id, poeng1, poeng2}.
 * @param {string} lagId
 * @returns {{ scoret: number, totalt: number, poengprosent: number }}
 */
export function beregnPoengprosent(lagId, alleResultaterForSesongen) {
  let scoret = 0, totalt = 0;
  for (const r of alleResultaterForSesongen) {
    if (r.lag1Id === lagId) { scoret += r.poeng1; totalt += r.poeng1 + r.poeng2; }
    else if (r.lag2Id === lagId) { scoret += r.poeng2; totalt += r.poeng1 + r.poeng2; }
  }
  const poengprosent = totalt > 0 ? (scoret / totalt) * 100 : 0;
  return { scoret, totalt, poengprosent };
}

// ════════════════════════════════════════════════════════
// TABELL (§12) — lagpoeng → poengprosent → vunnet → innbyrdes → loddtrekning
// ════════════════════════════════════════════════════════

/**
 * @param {Array<{id, navn}>} lag
 * @param {Array} ferdigeLagkamper — [{lag1Id, lag2Id, lagpoeng1, lagpoeng2, totalPoeng1, totalPoeng2}]
 * @param {Array<{lag1Id, lag2Id, poeng1, poeng2}>} alleResultaterInklBonus — for poengprosent
 * @returns {Array} sortert tabell, med plass, lagpoeng, poengprosent, vunnetLagkamper
 */
export function beregnTabell(lag, ferdigeLagkamper, alleResultaterInklBonus) {
  const rader = lag.map(l => {
    let lagpoeng = 0, vunnetLagkamper = 0;
    for (const k of ferdigeLagkamper) {
      if (k.lag1Id === l.id) {
        lagpoeng += k.lagpoeng1;
        if (k.lagpoeng1 === 3) vunnetLagkamper++;
      } else if (k.lag2Id === l.id) {
        lagpoeng += k.lagpoeng2;
        if (k.lagpoeng2 === 3) vunnetLagkamper++;
      }
    }
    const { poengprosent } = beregnPoengprosent(l.id, alleResultaterInklBonus);
    return { lagId: l.id, navn: l.navn, lagpoeng, poengprosent, vunnetLagkamper };
  });

  /** Innbyrdes oppgjør mellom nøyaktig to lag som står likt på alt over. */
  function innbyrdesResultat(lagIdA, lagIdB) {
    const oppgjor = ferdigeLagkamper.find(k =>
      (k.lag1Id === lagIdA && k.lag2Id === lagIdB) ||
      (k.lag1Id === lagIdB && k.lag2Id === lagIdA)
    );
    if (!oppgjor) return 0;
    const lagpoengA = oppgjor.lag1Id === lagIdA ? oppgjor.lagpoeng1 : oppgjor.lagpoeng2;
    const lagpoengB = oppgjor.lag1Id === lagIdA ? oppgjor.lagpoeng2 : oppgjor.lagpoeng1;
    return lagpoengA - lagpoengB;
  }

  rader.sort((a, b) => {
    if (b.lagpoeng !== a.lagpoeng) return b.lagpoeng - a.lagpoeng;
    if (b.poengprosent !== a.poengprosent) return b.poengprosent - a.poengprosent;
    if (b.vunnetLagkamper !== a.vunnetLagkamper) return b.vunnetLagkamper - a.vunnetLagkamper;
    const innbyrdes = innbyrdesResultat(a.lagId, b.lagId);
    if (innbyrdes !== 0) return -innbyrdes;
    return 0; // fullstendig likt → loddtrekning håndteres manuelt av admin i UI
  });

  return rader.map((r, i) => ({ ...r, plass: i + 1 }));
}
