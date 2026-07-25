// ════════════════════════════════════════════════════════
// stafettliga.js — Firestore-operasjoner for Stafettligaen
// All beregningslogikk ligger i stafettliga-logikk.js.
// ════════════════════════════════════════════════════════

import {
  db, SAM,
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp,
} from './firebase.js';
import { visMelding, visFBFeil } from './ui.js';
import { lagBatchHjelper } from './batch-helpers.js';
import {
  beregnLagoppsett,
  genererSerieoppsett,
  genererPlasseringskamper,
  genererLagkampSpilleroppsett,
  bestemBonustype,
  erFaktiskBonuskamp,
  hentBonusrotasjon,
  hentBonusrotasjonFase2,
  beregn3SpillerBonusNedbrytning,
  validerDobbelResultat,
  validerStafettResultat,
  valider3SpillerBonusPoeng,
  beregnLagpoeng,
  beregnTabell,
} from './stafettliga-logikk.js';

// Re-eksporter logikk-funksjoner slik at stafettliga-ui.js og
// stafettliga-spill-ui.js kun trenger å importere fra denne filen.
export {
  beregnLagoppsett,
  genererLagkampSpilleroppsett,
  bestemBonustype,
  erFaktiskBonuskamp,
  validerDobbelResultat,
  validerStafettResultat,
  valider3SpillerBonusPoeng,
};

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger         = () => {};
let _krevAdmin       = () => {};
let _getAktivKlubbId = () => null;

export function stafettligaInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}

function tomDelkamp() {
  return { poeng1: null, poeng2: null, ferdig: false };
}

function tomLagkampFaser(antallStafetter = 2) {
  const fase3 = { stafettA: tomDelkamp() };
  if (antallStafetter === 2) fase3.stafettB = tomDelkamp();
  return {
    fase1: { niva1: tomDelkamp(), niva2: tomDelkamp() },
    fase2: { mix1: tomDelkamp(), mix2: tomDelkamp() },
    fase3,
  };
}

/** Henter de ordinære delkampene fra et lagkamp-dokument, respekterer antallStafetter (default 2 for eldre sesonger uten feltet). */
function hentDelkamperForLagkamp(k) {
  const delkamper = [k.fase1.niva1, k.fase1.niva2, k.fase2.mix1, k.fase2.mix2, k.fase3.stafettA];
  if ((k.antallStafetter ?? 2) === 2) delkamper.push(k.fase3.stafettB);
  return delkamper;
}

// ════════════════════════════════════════════════════════
// SPILLERE — leser players-samlingen for spillervelgeren i
// oppsettet. Kun id+navn brukes; rating/historikk røres aldri.
// ════════════════════════════════════════════════════════
export async function hentSpillere() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(
      collection(db, SAM.SPILLERE),
      where('klubbId', '==', klubbId),
      orderBy('navn'),
    ));
    return snap.docs.map(d => ({ id: d.id, navn: d.data().navn ?? '?' }));
  } catch (e) {
    console.warn('[Stafettliga] hentSpillere:', e?.message);
    return [];
  }
}

/**
 * Oppretter en ny spiller i players-samlingen for aktiv klubb.
 * Kun til bruk fra spillervelgeren i Stafettliga-oppsettet — skriver
 * kun id/navn/klubbId, rører aldri rating/historikk-felt hovedappen eier.
 * @param {string} navn
 * @returns {Promise<{id: string, navn: string}>}
 */
export async function opprettSpiller(navn) {
  const klubbId  = _getAktivKlubbId();
  const navnTrim = (navn ?? '').trim();
  if (!klubbId) throw new Error('Ingen klubb valgt.');
  if (!db) throw new Error('Ingen databasetilkobling.');
  if (!navnTrim) throw new Error('Skriv inn et navn.');

  const ref = await addDoc(collection(db, SAM.SPILLERE), {
    klubbId,
    navn: navnTrim,
    opprettet: serverTimestamp(),
  });
  return { id: ref.id, navn: navnTrim };
}

// ════════════════════════════════════════════════════════
// OPPRETTING
// ════════════════════════════════════════════════════════

/**
 * @param {object} konfig
 * @param {string} konfig.navn
 * @param {number} konfig.antallDeltakere
 * @param {Array<{navn, spillere:{niva1:string[], niva2:string[]}}>} konfig.lag
 * @param {1|2} [konfig.antallStafetter=2] — antall lagstafetter i fase 3, fast for hele sesongen
 */
export async function opprettSesong(konfig) {
  const klubbId = _getAktivKlubbId();
  if (!klubbId) throw new Error('Ingen aktiv klubb.');

  const { navn, antallDeltakere, lag, antallStafetter = 2 } = konfig;
  if (antallStafetter !== 1 && antallStafetter !== 2) {
    throw new Error('Antall stafetter må være 1 eller 2.');
  }
  const { antallLag, lagStorrelser, regel } = beregnLagoppsett(antallDeltakere);
  if (lag.length !== antallLag) {
    throw new Error(`Forventet ${antallLag} lag for ${antallDeltakere} deltakere, fikk ${lag.length}.`);
  }

  const lagMedId = lag.map((l, i) => ({ id: `lag_${i + 1}`, navn: l.navn, spillere: l.spillere }));

  const doc_ = await addDoc(collection(db, SAM.STAFETTLIGA_SESONGER), {
    klubbId,
    navn:      navn || 'Stafettligaen',
    opprettet: serverTimestamp(),
    status:    'oppsett',
    antallDeltakere, antallLag, regel, lagStorrelser,
    antallStafetter,
    lag:       lagMedId,
    tabell:    [],
  });

  visMelding('Sesong opprettet!');
  return doc_.id;
}

// ════════════════════════════════════════════════════════
// REDIGERING AV LAG — kun tillatt før noe resultat er registrert
// (verken delkamper eller bonuskamper). Så snart første resultat
// er lagret, låses lag/spillere for sesongen.
// ════════════════════════════════════════════════════════

/** @returns {Promise<boolean>} true hvis ingen lagkamper/bonuskamper i sesongen har registrerte resultater ennå. */
export async function sesongKanRedigeres(sesongId) {
  const lagkamper = await hentLagkamperForSesong(sesongId);
  const alleIkkeStartet = lagkamper.every(k => k.status === 'ikke_startet');
  if (!alleIkkeStartet) return false;

  const bonusSnap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_BONUSKAMPER),
    where('sesongId', '==', sesongId),
    where('ferdig', '==', true),
  ));
  return bonusSnap.empty;
}

/**
 * Oppdaterer lagnavn/spillersammensetning for en sesong som ikke er i gang ennå.
 * Rekalkulerer bonustype (siden nivå1/nivå2-fordelingen kan ha endret seg) og
 * genererer bonuskampene for alle 3 runder på nytt — nivå/mix-oppsettet i selve
 * lagkampene trenger IKKE regenereres, siden det alltid beregnes live fra
 * sesong.lag når en lagkamp åpnes (se stafettliga-spill-ui.js).
 *
 * @param {string} sesongId
 * @param {Array<{navn, spillere:{niva1, niva2}}>} nyeLag — samme rekkefølge/antall som sesong.lag
 */
export async function oppdaterSesongLag(sesongId, nyeLag) {
  const sesong = await hentSesong(sesongId);
  if (!(await sesongKanRedigeres(sesongId))) {
    throw new Error('Kan ikke redigere lag etter at kamper er startet.');
  }
  if (nyeLag.length !== sesong.lag.length) {
    throw new Error(`Forventet ${sesong.lag.length} lag, fikk ${nyeLag.length}.`);
  }
  nyeLag.forEach((l, i) => {
    const totalt = (l.spillere.niva1?.length ?? 0) + (l.spillere.niva2?.length ?? 0);
    if (totalt !== sesong.lagStorrelser[i]) {
      throw new Error(`Lag ${i + 1} skal ha ${sesong.lagStorrelser[i]} spillere, har ${totalt}.`);
    }
  });

  // Behold opprinnelige lag-id-er (rekkefølgen er fast) — lagkampene refererer til disse.
  const lagMedId = nyeLag.map((l, i) => ({ id: sesong.lag[i].id, navn: l.navn, spillere: l.spillere }));

  const antallLagMed3Niva1 = lagMedId.filter(l => l.spillere.niva1.length === 3).length;
  const antallLagMed3Niva2 = lagMedId.filter(l => l.spillere.niva2.length === 3).length;
  const bonustypeNiva1 = bestemBonustype(antallLagMed3Niva1);
  const bonustypeNiva2 = bestemBonustype(antallLagMed3Niva2);

  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), {
    lag: lagMedId, bonustypeNiva1, bonustypeNiva2,
  });

  // Slett gamle bonuskamper (de har spillerlister snapshotet fra gammel lagsammensetning) og bygg dem på nytt.
  const bh = lagBatchHjelper(db);
  const gamleBonusSnap = await getDocs(query(collection(db, SAM.STAFETTLIGA_BONUSKAMPER), where('sesongId', '==', sesongId)));
  for (const d of gamleBonusSnap.docs) await bh.slett(d.ref);

  const sesongOppdatert = { ...sesong, id: sesongId, lag: lagMedId };
  for (let rundeNr = 1; rundeNr <= 3; rundeNr++) {
    await genererBonuskamperForRunde(bh, sesongOppdatert, rundeNr, 'niva1', bonustypeNiva1, 'fase1');
    await genererBonuskamperForRunde(bh, sesongOppdatert, rundeNr, 'niva1', bonustypeNiva1, 'fase2');
    await genererBonuskamperForRunde(bh, sesongOppdatert, rundeNr, 'niva2', bonustypeNiva2, 'fase1');
    await genererBonuskamperForRunde(bh, sesongOppdatert, rundeNr, 'niva2', bonustypeNiva2, 'fase2');
  }
  await bh.kommit();

  visMelding('Lagene er oppdatert!');
}

// ════════════════════════════════════════════════════════
// HENT
// ════════════════════════════════════════════════════════
export async function hentSesong(sesongId) {
  const snap = await getDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId));
  if (!snap.exists()) throw new Error('Sesong ikke funnet.');
  return { id: snap.id, ...snap.data() };
}

export async function hentAktiveSesonger() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(
      collection(db, SAM.STAFETTLIGA_SESONGER),
      where('klubbId', '==', klubbId),
      where('status', '!=', 'ferdig'),
      orderBy('status'), orderBy('opprettet', 'desc'),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status !== 'slettet');
  } catch (e) {
    console.warn('[Stafettliga] hentAktiveSesonger:', e?.message);
    return [];
  }
}

/** Brukes av arkiv.js — ferdige sesonger vises i det felles arkivet. */
export async function hentAvsluttedeSesonger() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(
      collection(db, SAM.STAFETTLIGA_SESONGER),
      where('klubbId', '==', klubbId),
      where('status', '==', 'ferdig'),
      orderBy('opprettet', 'desc'),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Stafettliga] hentAvsluttedeSesonger:', e?.message);
    return [];
  }
}

export async function hentLagkamp(lagkampId) {
  const snap = await getDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId));
  if (!snap.exists()) throw new Error('Lagkamp ikke funnet.');
  return { id: snap.id, ...snap.data() };
}

export async function hentLagkamperForSesong(sesongId) {
  const snap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_LAGKAMPER),
    where('sesongId', '==', sesongId),
    orderBy('rundeNr'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function hentBonuskamperForRunde(sesongId, rundeNr) {
  const snap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_BONUSKAMPER),
    where('sesongId', '==', sesongId),
    where('rundeNr', '==', rundeNr),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ════════════════════════════════════════════════════════
// START SESONG — genererer serieoppsett + alle lagkamp- og
// bonuskamp-dokumenter for hele kvelden i én batch.
// ════════════════════════════════════════════════════════
export async function startSesong(sesongId) {
  const sesong = await hentSesong(sesongId);
  if (sesong.status !== 'oppsett') throw new Error('Sesongen er allerede startet.');

  const antallStafetter = sesong.antallStafetter ?? 2;
  const lagIds        = sesong.lag.map(l => l.id);
  const serieoppsett   = genererSerieoppsett(lagIds, sesong.antallLag);
  const antallLagMed3Niva1 = sesong.lag.filter(l => l.spillere.niva1.length === 3).length;
  const antallLagMed3Niva2 = sesong.lag.filter(l => l.spillere.niva2.length === 3).length;
  const bonustypeNiva1 = bestemBonustype(antallLagMed3Niva1);
  const bonustypeNiva2 = bestemBonustype(antallLagMed3Niva2);

  const bh = lagBatchHjelper(db);

  for (const k of serieoppsett.lagkamper) {
    const ref = doc(collection(db, SAM.STAFETTLIGA_LAGKAMPER));
    await bh.sett(ref, {
      sesongId, rundeNr: k.runde, lagkampNr: k.kampNr,
      lag1Id: k.lag1Id, lag2Id: k.lag2Id,
      antallStafetter,
      ...tomLagkampFaser(antallStafetter),
      erPlasseringskamp: false,
      status: 'ikke_startet',
    });
  }

  // Bonuskamper genereres for alle 3 ordinære runder med én gang,
  // siden bonustype/deltakende lag er fast for hele sesongen.
  // Ved faktisk bonuskamp (ikke halvtidsrotasjon-fallback) bytter
  // bonusrollen mellom fasene innad i lagkampen (§8/§9-forlengelse) —
  // derfor genereres ÉN bonuskamp for fase1-tidsvinduet og ÉN separat
  // for fase2-tidsvinduet, per runde per nivå.
  for (let rundeNr = 1; rundeNr <= 3; rundeNr++) {
    await genererBonuskamperForRunde(bh, sesong, rundeNr, 'niva1', bonustypeNiva1, 'fase1');
    await genererBonuskamperForRunde(bh, sesong, rundeNr, 'niva1', bonustypeNiva1, 'fase2');
    await genererBonuskamperForRunde(bh, sesong, rundeNr, 'niva2', bonustypeNiva2, 'fase1');
    await genererBonuskamperForRunde(bh, sesong, rundeNr, 'niva2', bonustypeNiva2, 'fase2');
  }

  await bh.kommit();

  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), {
    status: 'aktiv',
    serieoppsettType: serieoppsett.type,
    bonustypeNiva1, bonustypeNiva2,
    gjeldendeRunde: 1,
  });

  visMelding('Stafettligaen er i gang!');
}

async function genererBonuskamperForRunde(bh, sesong, rundeNr, niva, bonustype, fase) {
  if (!erFaktiskBonuskamp(bonustype)) return;

  const bonusSpillerIndeks = fase === 'fase2'
    ? hentBonusrotasjonFase2(rundeNr).bonusSpiller
    : hentBonusrotasjon(rundeNr).bonusSpiller;

  const spillere = sesong.lag
    .filter(l => l.spillere[niva].length === 3)
    .map(l => {
      const spiller = l.spillere[niva][bonusSpillerIndeks]; // {id, navn}
      return { lagId: l.id, lagNavn: l.navn, spillerId: spiller.id, spillerNavn: spiller.navn };
    });

  if (bonustype === 'bonussingle' && spillere.length !== 2) return;
  if (bonustype === '3spillerbonus' && spillere.length !== 3) return;
  if (bonustype === 'bonusdobbel' && spillere.length !== 4) return;

  const ref = doc(collection(db, SAM.STAFETTLIGA_BONUSKAMPER));
  await bh.sett(ref, {
    sesongId: sesong.id, rundeNr, fase, type: bonustype, niva,
    spillere, resultat: null, parvisNedbrytning: null, ferdig: false,
  });
}

// ════════════════════════════════════════════════════════
// RESULTATREGISTRERING — delkamper (nivå/mix/stafett)
// Ingen lås — hvem som helst kan registrere. Admin godkjenner
// hele runden før neste runde åpnes (godkjennRunde()).
// ════════════════════════════════════════════════════════

/**
 * @param {string} lagkampId
 * @param {'fase1'|'fase2'|'fase3'} fase
 * @param {'niva1'|'niva2'|'mix1'|'mix2'|'stafettA'|'stafettB'} delkamp
 */
export async function registrerDelkampResultat(lagkampId, fase, delkamp, poeng1, poeng2) {
  const validering = delkamp.startsWith('stafett') ? validerStafettResultat : validerDobbelResultat;
  const v = validering(poeng1, poeng2);
  if (!v.ok) throw new Error(v.feil);

  const eksisterende = await hentLagkamp(lagkampId);
  if (eksisterende.status === 'godkjent') {
    throw new Error('Runden er allerede godkjent av admin — be en admin korrigere resultatet.');
  }

  const prefiks = `${fase}.${delkamp}`;
  await updateDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId), {
    [`${prefiks}.poeng1`]: poeng1,
    [`${prefiks}.poeng2`]: poeng2,
    [`${prefiks}.ferdig`]: true,
  });
  visMelding('Resultat registrert!');
  await oppdaterLagkampStatusHvisFerdig(lagkampId);
}

/** Admin kan alltid overskrive et resultat, også etter at runden er godkjent — oppdaterer da tabellen på nytt. */
export async function korrigerDelkampResultat(lagkampId, fase, delkamp, poeng1, poeng2) {
  const validering = delkamp.startsWith('stafett') ? validerStafettResultat : validerDobbelResultat;
  const v = validering(poeng1, poeng2);
  if (!v.ok) throw new Error(v.feil);

  const eksisterende = await hentLagkamp(lagkampId);
  const prefiks = `${fase}.${delkamp}`;
  await updateDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId), {
    [`${prefiks}.poeng1`]: poeng1,
    [`${prefiks}.poeng2`]: poeng2,
    [`${prefiks}.ferdig`]: true,
  });
  visMelding('Resultat korrigert.');

  if (eksisterende.status === 'godkjent') {
    // Allerede godkjent — regn lagpoeng på nytt og oppdater tabellen umiddelbart,
    // siden godkjennRunde() ikke kalles på nytt.
    await regnLagpoengPaNyttForGodkjentLagkamp(lagkampId, eksisterende.sesongId);
  } else {
    await oppdaterLagkampStatusHvisFerdig(lagkampId);
  }
}

async function regnLagpoengPaNyttForGodkjentLagkamp(lagkampId, sesongId) {
  const k = await hentLagkamp(lagkampId);
  const resultat = beregnLagpoeng({
    niva1: k.fase1.niva1, niva2: k.fase1.niva2,
    mix1:  k.fase2.mix1,  mix2:  k.fase2.mix2,
    stafettA: k.fase3.stafettA, stafettB: k.fase3.stafettB,
  }, k.antallStafetter ?? 2);
  await updateDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId), {
    lagpoeng:     { lag1: resultat.lagpoeng1, lag2: resultat.lagpoeng2 },
    delkampSeire: { lag1: resultat.delkampSeire1, lag2: resultat.delkampSeire2 },
  });
  await oppdaterTabell(sesongId);
}

/** Beregner (foreløpig) lagpoeng så snart alle 6 delkamper er fylt ut, og markerer lagkampen klar for admin-godkjenning. */
async function oppdaterLagkampStatusHvisFerdig(lagkampId) {
  const snap = await getDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId));
  if (!snap.exists()) return;
  const k = snap.data();
  if (k.status === 'godkjent') return; // ikke overskriv en allerede godkjent lagkamp ved senere korrigering

  const delkamper = hentDelkamperForLagkamp(k);
  const alleFerdig = delkamper.every(d => d?.ferdig);

  if (!alleFerdig) {
    await updateDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId), { status: 'pagar' });
    return;
  }

  const resultat = beregnLagpoeng({
    niva1: k.fase1.niva1, niva2: k.fase1.niva2,
    mix1:  k.fase2.mix1,  mix2:  k.fase2.mix2,
    stafettA: k.fase3.stafettA, stafettB: k.fase3.stafettB,
  }, k.antallStafetter ?? 2);
  await updateDoc(doc(db, SAM.STAFETTLIGA_LAGKAMPER, lagkampId), {
    lagpoeng:     { lag1: resultat.lagpoeng1, lag2: resultat.lagpoeng2 },
    delkampSeire: { lag1: resultat.delkampSeire1, lag2: resultat.delkampSeire2 },
    status:       'venter_godkjenning',
  });
}

// ════════════════════════════════════════════════════════
// RESULTATREGISTRERING — bonuskamper
// ════════════════════════════════════════════════════════

/**
 * @param {string} bonusId
 * @param {object} resultat
 *   bonussingle/bonusdobbel: { poeng1, poeng2 }
 *   3spillerbonus:           { poengA, poengB, poengC }
 */
export async function registrerBonuskampResultat(bonusId, resultat) {
  const snap = await getDoc(doc(db, SAM.STAFETTLIGA_BONUSKAMPER, bonusId));
  if (!snap.exists()) throw new Error('Bonuskamp ikke funnet.');
  const b = snap.data();

  let parvisNedbrytning;

  if (b.type === '3spillerbonus') {
    for (const p of [resultat.poengA, resultat.poengB, resultat.poengC]) {
      const v = valider3SpillerBonusPoeng(p);
      if (!v.ok) throw new Error(v.feil);
    }
    const [a, bb, c] = b.spillere;
    parvisNedbrytning = beregn3SpillerBonusNedbrytning(
      { lagId: a.lagId, poeng: resultat.poengA },
      { lagId: bb.lagId, poeng: resultat.poengB },
      { lagId: c.lagId, poeng: resultat.poengC },
    );
  } else {
    const v = validerDobbelResultat(resultat.poeng1, resultat.poeng2);
    if (!v.ok) throw new Error(v.feil);

    if (b.type === 'bonusdobbel') {
      // spillere[0]+spillere[1] = par1, spillere[2]+spillere[3] = par2.
      // Hvert lag krediteres poengparets resultat én gang.
      const [s0, s1, s2, s3] = b.spillere;
      parvisNedbrytning = [
        { lag1Id: s0.lagId, lag2Id: s2.lagId, poeng1: resultat.poeng1, poeng2: resultat.poeng2 },
        { lag1Id: s1.lagId, lag2Id: s3.lagId, poeng1: resultat.poeng1, poeng2: resultat.poeng2 },
      ];
    } else {
      // bonussingle
      const [s0, s1] = b.spillere;
      parvisNedbrytning = [{ lag1Id: s0.lagId, lag2Id: s1.lagId, poeng1: resultat.poeng1, poeng2: resultat.poeng2 }];
    }
  }

  await updateDoc(doc(db, SAM.STAFETTLIGA_BONUSKAMPER, bonusId), {
    resultat, parvisNedbrytning, ferdig: true, godkjent: false,
  });

  visMelding('Bonuskamp registrert!');
}

// ════════════════════════════════════════════════════════
// MIDLERTIDIG TABELL — foreløpig stilling til bruk underveis
// i en kveld. I motsetning til oppdaterTabell() (som kun teller
// godkjente lagkamper) tar denne med ALT som er registrert så
// langt, inkl. delvis spilte lagkamper og ikke-godkjente
// bonuskamper. Lagres aldri — regnes ut på forespørsel.
// ════════════════════════════════════════════════════════
export async function hentMidlertidigTabell(sesongId) {
  const sesong     = await hentSesong(sesongId);
  const lagkamper  = await hentLagkamperForSesong(sesongId);

  const beregnedeLagkamper = [];
  const delkampResultater  = [];

  for (const k of lagkamper) {
    const delkamper = hentDelkamperForLagkamp(k);
    delkamper.forEach(d => {
      if (d?.ferdig) {
        delkampResultater.push({ lag1Id: k.lag1Id, lag2Id: k.lag2Id, poeng1: d.poeng1, poeng2: d.poeng2 });
      }
    });

    const harMinstEnDelkamp = delkamper.some(d => d?.ferdig);
    if (!harMinstEnDelkamp) continue; // lagkampen er ikke i gang ennå

    if (k.lagpoeng) {
      // Allerede ferdigspilt (venter_godkjenning eller godkjent) — bruk lagrede lagpoeng.
      beregnedeLagkamper.push({ lag1Id: k.lag1Id, lag2Id: k.lag2Id, lagpoeng1: k.lagpoeng.lag1, lagpoeng2: k.lagpoeng.lag2 });
    } else {
      // Pågår — regn ut foreløpig lagpoeng basert på delkampene som er registrert til nå.
      const forelopig = beregnLagpoeng({
        niva1: k.fase1.niva1, niva2: k.fase1.niva2,
        mix1:  k.fase2.mix1,  mix2:  k.fase2.mix2,
        stafettA: k.fase3.stafettA, stafettB: k.fase3.stafettB,
      }, k.antallStafetter ?? 2);
      beregnedeLagkamper.push({ lag1Id: k.lag1Id, lag2Id: k.lag2Id, lagpoeng1: forelopig.lagpoeng1, lagpoeng2: forelopig.lagpoeng2 });
    }
  }

  const bonusSnap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_BONUSKAMPER),
    where('sesongId', '==', sesongId),
    where('ferdig', '==', true),
  ));
  bonusSnap.docs.forEach(d => {
    const b = d.data();
    (b.parvisNedbrytning || []).forEach(p => delkampResultater.push(p));
  });

  return beregnTabell(sesong.lag, beregnedeLagkamper, delkampResultater);
}

// ════════════════════════════════════════════════════════
// TABELL — reberegnes og caches på sesong-dokumentet.
// Teller KUN godkjente lagkamper/bonuskamper — resultater som
// venter på admin-godkjenning påvirker ikke tabellen ennå.
// ════════════════════════════════════════════════════════
async function oppdaterTabell(sesongId) {
  const sesong = await hentSesong(sesongId);

  const godkjentSnap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_LAGKAMPER),
    where('sesongId', '==', sesongId),
    where('status', '==', 'godkjent'),
  ));
  const godkjenteLagkamper = godkjentSnap.docs.map(d => {
    const k = d.data();
    return { lag1Id: k.lag1Id, lag2Id: k.lag2Id, lagpoeng1: k.lagpoeng.lag1, lagpoeng2: k.lagpoeng.lag2 };
  });

  // Poengprosent regnes kun ut fra delkamper i de samme godkjente lagkampene.
  const delkampResultater = [];
  godkjentSnap.docs.forEach(d => {
    const k = d.data();
    hentDelkamperForLagkamp(k).forEach(delkamp => {
      if (delkamp?.ferdig) {
        delkampResultater.push({ lag1Id: k.lag1Id, lag2Id: k.lag2Id, poeng1: delkamp.poeng1, poeng2: delkamp.poeng2 });
      }
    });
  });

  const bonusSnap = await getDocs(query(
    collection(db, SAM.STAFETTLIGA_BONUSKAMPER),
    where('sesongId', '==', sesongId),
    where('godkjent', '==', true),
  ));
  bonusSnap.docs.forEach(d => {
    const b = d.data();
    (b.parvisNedbrytning || []).forEach(p => delkampResultater.push(p));
  });

  const tabell = beregnTabell(sesong.lag, godkjenteLagkamper, delkampResultater);
  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), { tabell });
  return tabell;
}

// ════════════════════════════════════════════════════════
// ADMIN — GODKJENN RUNDE
// Godkjenner alle lagkamper og bonuskamper i en runde samlet,
// oppdaterer tabellen, og åpner neste runde. Krever PIN
// (håndteres av krevAdmin() i UI-laget før dette kalles).
// ════════════════════════════════════════════════════════
export async function hentGodkjenningsstatusForRunde(sesongId, rundeNr) {
  const [lagkamper, bonuskamper] = await Promise.all([
    hentLagkamperForSesong(sesongId).then(alle => alle.filter(k => k.rundeNr === rundeNr)),
    hentBonuskamperForRunde(sesongId, rundeNr),
  ]);
  const alleLagkamperKlare  = lagkamper.every(k => k.status === 'venter_godkjenning' || k.status === 'godkjent');
  const alleBonuskamperKlare = bonuskamper.every(b => b.ferdig);
  return {
    klarTilGodkjenning: lagkamper.length > 0 && alleLagkamperKlare && alleBonuskamperKlare,
    alleredeGodkjent:   lagkamper.length > 0 && lagkamper.every(k => k.status === 'godkjent'),
    lagkamper, bonuskamper,
  };
}

export async function godkjennRunde(sesongId, rundeNr) {
  const { klarTilGodkjenning, lagkamper, bonuskamper } = await hentGodkjenningsstatusForRunde(sesongId, rundeNr);
  if (!klarTilGodkjenning) throw new Error('Ikke alle resultater i runden er registrert ennå.');

  const bh = lagBatchHjelper(db);
  for (const k of lagkamper) {
    await bh.oppdater(doc(db, SAM.STAFETTLIGA_LAGKAMPER, k.id), { status: 'godkjent' });
  }
  for (const b of bonuskamper) {
    await bh.oppdater(doc(db, SAM.STAFETTLIGA_BONUSKAMPER, b.id), { godkjent: true });
  }
  await bh.kommit();

  await oppdaterTabell(sesongId);
  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), { gjeldendeRunde: rundeNr + 1 });
  visMelding(`Runde ${rundeNr} godkjent!`);
}

// ════════════════════════════════════════════════════════
// 6-LAG — PLASSERINGSKAMPER ETTER DE 3 ORDINÆRE RUNDENE
// ════════════════════════════════════════════════════════
export async function startPlasseringskamper(sesongId) {
  const sesong = await hentSesong(sesongId);
  if (sesong.antallLag !== 6) throw new Error('Plasseringskamper gjelder kun 6-lagsformatet.');

  const sortertLagIds = (sesong.tabell ?? []).map(t => t.lagId);
  if (sortertLagIds.length !== 6) throw new Error('Tabellen er ikke komplett ennå — alle 3 lagkamper må være ferdig bekreftet.');

  const antallStafetter = sesong.antallStafetter ?? 2;
  const kamper = genererPlasseringskamper(sortertLagIds);
  const bh = lagBatchHjelper(db);
  for (const k of kamper) {
    const ref = doc(collection(db, SAM.STAFETTLIGA_LAGKAMPER));
    await bh.sett(ref, {
      sesongId, rundeNr: 4, lagkampNr: k.id, navn: k.navn,
      lag1Id: k.lag1Id, lag2Id: k.lag2Id,
      antallStafetter,
      ...tomLagkampFaser(antallStafetter),
      erPlasseringskamp: true,
      status: 'ikke_startet',
    });
  }
  await bh.kommit();

  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), { status: 'plasseringskamper' });
  visMelding('Plasseringskamper generert!');
}

// ════════════════════════════════════════════════════════
// AVSLUTT — flytter sesongen til arkivet (status: 'ferdig')
// ════════════════════════════════════════════════════════
export async function avsluttSesong(sesongId) {
  await oppdaterTabell(sesongId);
  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), {
    status: 'ferdig',
    avsluttet: serverTimestamp(),
  });
  visMelding('Stafettligaen er avsluttet og lagt i arkivet!');
}

export async function slettSesong(sesongId) {
  await updateDoc(doc(db, SAM.STAFETTLIGA_SESONGER, sesongId), {
    status: 'slettet',
    slettet: serverTimestamp(),
  });
}
