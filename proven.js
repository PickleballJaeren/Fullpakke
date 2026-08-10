// ════════════════════════════════════════════════════════
// proven.js — Firestore-operasjoner for Prøven
// All beregningslogikk ligger i proven-logikk.js.
//
// KOSTNADSPRINSIPP (Firestore-kvote):
//  - Puljespill: 4 dokumenter totalt for hele kvelden (ett per pulje,
//    alle 6 kamper som nestede map-felt) — ikke 24 enkeltdokumenter.
//  - Sluttspill: 1 dokument totalt for hele bracketet (QF+SF+Finale).
//  - Hver resultatregistrering er nøyaktig 1 lesning + 1 skriving,
//    og oppdaterer cachet tabell/status i samme skriving.
//  - Livstidsstatistikk oppdateres med increment() ved avslutning —
//    0 lesninger, kun 16 skrivinger, én gang per event.
//  - Ingen onSnapshot noe sted — alt hentes on-demand (samme mønster
//    som stafettliga.js), ingen løpende lyttekostnad.
//  - Ingen nye composite-indekser kreves: alle spørringer bruker kun
//    likhetsfilter på ett felt, sortering gjøres i JS.
// ════════════════════════════════════════════════════════

import {
  db, SAM,
  collection, doc, addDoc, updateDoc, setDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, writeBatch,
  increment, documentId,
} from './firebase.js';
import { visMelding } from './ui.js';
import {
  trekkPuljer, genererProvenPuljeoppsett,
  beregnPuljetabell, genererSluttspillSeeding, genererSluttspillSeeding12, tomSerie,
  beregnSerieStatus, utledVinnerIdForSerie, utledNesteSerie,
  validerKampResultat, trengerTredjeDelkamp, beregnLivstidsdeltaer,
  erGyldigKilde, KILDER, DISIPLINER, FINALE_DISIPLIN_REKKEFOLGE,
  SF_KRYSSPAR, FINALE_KRYSSPAR,
} from './proven-logikk.js';

// Re-eksporter logikk slik at proven-ui.js og proven-spill-ui.js kun
// trenger å importere fra denne filen (samme mønster som stafettliga.js).
export {
  validerKampResultat, trengerTredjeDelkamp, erGyldigKilde,
  KILDER, DISIPLINER, FINALE_DISIPLIN_REKKEFOLGE, beregnSerieStatus,
};

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger         = () => {};
let _krevAdmin        = () => {};
let _getAktivKlubbId = () => null;

export function provenInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}

// ════════════════════════════════════════════════════════
// SPILLERE — samme players-samling som Stafettligaen bruker.
// Bevisst duplisert her (ikke importert fra stafettliga.js) for å
// holde de to modusene fullstendig uavhengige av hverandre — samme
// isolasjonsprinsipp som proven-logikk.js følger for ren logikk.
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
    console.warn('[Prøven] hentSpillere:', e?.message);
    return [];
  }
}

export async function opprettSpiller(navn) {
  const klubbId  = _getAktivKlubbId();
  const navnTrim = (navn ?? '').trim();
  if (!klubbId) throw new Error('Ingen klubb valgt.');
  if (!db) throw new Error('Ingen databasetilkobling.');
  if (!navnTrim) throw new Error('Skriv inn et navn.');

  const ref = await addDoc(collection(db, SAM.SPILLERE), {
    klubbId, navn: navnTrim, opprettet: serverTimestamp(),
  });
  return { id: ref.id, navn: navnTrim };
}

// ════════════════════════════════════════════════════════
// OPPRETTING — event + puljetrekning i to steg, slik at admin kan
// justere puljesammensetningen manuelt før puljespillet startes.
// ════════════════════════════════════════════════════════

/**
 * @param {object} konfig
 * @param {string} konfig.navn
 * @param {12|16} konfig.format — avgjør puljestruktur (3 puljer à 4, eller 4 puljer à 4)
 * @param {Array<{id, navn, kilde, wildcardBegrunnelse?}>} konfig.spillere — like mange som format
 */
export async function opprettProvenEvent(konfig) {
  const klubbId = _getAktivKlubbId();
  if (!klubbId) throw new Error('Ingen aktiv klubb.');

  const { navn, spillere, format } = konfig;
  if (format !== 12 && format !== 16) {
    throw new Error(`Ugyldig format: ${format}. Prøven støtter 12 eller 16 spillere.`);
  }
  if (!spillere || spillere.length !== format) {
    throw new Error(`Dette formatet krever nøyaktig ${format} spillere (fikk ${spillere?.length ?? 0}).`);
  }
  for (const s of spillere) {
    if (!erGyldigKilde(s.kilde)) throw new Error(`Ugyldig kilde for ${s.navn}: «${s.kilde}».`);
  }

  const eventNr = await _nesteEventNr(klubbId);

  const ref = await addDoc(collection(db, SAM.PROVEN_EVENTER), {
    klubbId, eventNr, format,
    navn: navn || `Prøven #${eventNr}`,
    opprettet: serverTimestamp(),
    status: 'oppsett',
    spillere,        // [{id, navn, kilde, wildcardBegrunnelse?}] — snapshot, rører aldri players-samlingen
    puljer: null,     // fylles av trekkPuljerForEvent()
    sluttspillId: null,
    vinnerId: null,
  });
  visMelding('Prøven opprettet!');
  return ref.id;
}

/** Enkel telling — antall Prøven-eventer er lavt (sjeldent arrangement), så dette er billig selv uten cache. */
async function _nesteEventNr(klubbId) {
  const snap = await getDocs(query(collection(db, SAM.PROVEN_EVENTER), where('klubbId', '==', klubbId)));
  const gyldige = snap.docs.map(d => d.data()).filter(e => e.status !== 'slettet');
  return gyldige.length + 1;
}

/** Trekker puljer tilfeldig og lagrer som utkast på eventet — admin kan justere før puljespillet startes. */
export async function trekkPuljerForEvent(eventId) {
  const event = await hentProvenEvent(eventId);
  if (event.status !== 'oppsett') throw new Error('Puljer kan kun trekkes mens eventet er i oppsett.');
  const puljer = trekkPuljer(event.spillere).map(p => ({
    navn: p.navn,
    spillereIds: p.spillere.map(s => s.id),
  }));
  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), { puljer });
  return puljer;
}

/** Lagrer admins manuelle justering av puljesammensetningen (bytte spillere mellom puljer) før start. */
export async function lagrePuljejustering(eventId, puljer) {
  const event = await hentProvenEvent(eventId);
  if (event.status !== 'oppsett') throw new Error('Puljer kan kun justeres mens eventet er i oppsett.');
  const forventetAntallPuljer = event.format / 4; // 3 eller 4
  const alleIder = puljer.flatMap(p => p.spillereIds);
  if (puljer.length !== forventetAntallPuljer || alleIder.length !== event.format || new Set(alleIder).size !== event.format) {
    throw new Error(`Puljene må til sammen inneholde nøyaktig ${event.format} unike spillere, fordelt med 4 i hver av ${forventetAntallPuljer} puljer.`);
  }
  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), { puljer });
  visMelding('Puljeinndeling lagret.');
}

/** Genererer puljedokumentene (full puljeplan m/ disiplin- og motstanderoppsett) og starter puljespillet. */
export async function startPuljespill(eventId) {
  const event = await hentProvenEvent(eventId);
  if (event.status !== 'oppsett') throw new Error('Eventet er allerede startet.');
  const forventetAntallPuljer = event.format / 4;
  if (!event.puljer || event.puljer.length !== forventetAntallPuljer) {
    throw new Error('Puljer må trekkes før puljespillet kan starte.');
  }

  const puljerMedSpillerobjekter = event.puljer.map(p => ({
    navn: p.navn,
    spillere: p.spillereIds.map(id => event.spillere.find(s => s.id === id)),
  }));
  const puljeplaner = genererProvenPuljeoppsett(puljerMedSpillerobjekter);

  const batch = writeBatch(db);
  for (const plan of puljeplaner) {
    const ref = doc(collection(db, SAM.PROVEN_PULJER));
    batch.set(ref, { eventId, manuellRekkefolge: null, ...plan });
  }
  await batch.commit();

  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), { status: 'puljespill' });
  visMelding('Puljespillet er i gang!');
}

// ════════════════════════════════════════════════════════
// HENT
// ════════════════════════════════════════════════════════
export async function hentProvenEvent(eventId) {
  const snap = await getDoc(doc(db, SAM.PROVEN_EVENTER, eventId));
  if (!snap.exists()) throw new Error('Prøven-event ikke funnet.');
  return { id: snap.id, ...snap.data() };
}

/** Ett likhetsfilter, ingen orderBy — sortering skjer i JS for å unngå å kreve en ny composite-indeks. */
export async function hentAktiveProvenEventer() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(collection(db, SAM.PROVEN_EVENTER), where('klubbId', '==', klubbId)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status !== 'ferdig' && e.status !== 'slettet')
      .sort((a, b) => (b.opprettet?.seconds ?? 0) - (a.opprettet?.seconds ?? 0));
  } catch (e) {
    console.warn('[Prøven] hentAktiveProvenEventer:', e?.message);
    return [];
  }
}

/** Brukes av arkiv-/Hall of Fame-visningen. */
export async function hentAvsluttedeProvenEventer() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(collection(db, SAM.PROVEN_EVENTER), where('klubbId', '==', klubbId)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status === 'ferdig')
      .sort((a, b) => (b.eventNr ?? 0) - (a.eventNr ?? 0));
  } catch (e) {
    console.warn('[Prøven] hentAvsluttedeProvenEventer:', e?.message);
    return [];
  }
}

/** 4 dokumenter for hele puljespillet — likhetsfilter uten orderBy, sortert i JS. */
export async function hentPuljerForEvent(eventId) {
  const snap = await getDocs(query(collection(db, SAM.PROVEN_PULJER), where('eventId', '==', eventId)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.navn.localeCompare(b.navn, 'no'));
}

export async function hentPulje(puljeId) {
  const snap = await getDoc(doc(db, SAM.PROVEN_PULJER, puljeId));
  if (!snap.exists()) throw new Error('Pulje ikke funnet.');
  return { id: snap.id, ...snap.data() };
}

/** 1 dokument for hele sluttspillbracketet. */
export async function hentSluttspillForEvent(eventId) {
  const event = await hentProvenEvent(eventId);
  if (!event.sluttspillId) return null;
  const snap = await getDoc(doc(db, SAM.PROVEN_SLUTTSPILL, event.sluttspillId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ════════════════════════════════════════════════════════
// PULJESPILL — resultatregistrering (1 lesning + 1 skriving per kamp,
// tabellen reberegnes og caches i samme skriving).
// ════════════════════════════════════════════════════════
export async function registrerPuljeKampResultat(puljeId, runde, kampKey, poeng1, poeng2) {
  const v = validerKampResultat(poeng1, poeng2);
  if (!v.ok) throw new Error(v.feil);

  const pulje = await hentPulje(puljeId);
  const rundeKey = `runde${runde}`;
  const rundeData = pulje.runder[rundeKey];
  if (!rundeData || rundeData.hviler) throw new Error('Ugyldig runde for denne puljen — puljen hviler denne runden.');
  if (!rundeData.kamper[kampKey]) throw new Error('Ugyldig kamp.');

  // Oppdater lokalt (i minnet) for å kunne reberegne tabellen uten en ekstra lesning.
  rundeData.kamper[kampKey] = { ...rundeData.kamper[kampKey], poeng1, poeng2, ferdig: true };
  const alleKamper = Object.values(pulje.runder).flatMap(r => Object.values(r.kamper));
  const tabell = beregnPuljetabell(pulje.spillereIds, alleKamper, pulje.manuellRekkefolge ?? null);

  const prefiks = `runder.${rundeKey}.kamper.${kampKey}`;
  await updateDoc(doc(db, SAM.PROVEN_PULJER, puljeId), {
    [`${prefiks}.poeng1`]: poeng1,
    [`${prefiks}.poeng2`]: poeng2,
    [`${prefiks}.ferdig`]: true,
    tabell,
  });
  visMelding('Resultat registrert!');
}

/** Admin kan overstyre hele puljerangeringen manuelt (§ når alt annet står helt likt). */
export async function overstyrPuljerangering(puljeId, sortertSpillerIdListe) {
  const pulje = await hentPulje(puljeId);
  if (sortertSpillerIdListe) {
    const gyldig = sortertSpillerIdListe.length === 4
      && new Set(sortertSpillerIdListe).size === 4
      && sortertSpillerIdListe.every(id => pulje.spillereIds.includes(id));
    if (!gyldig) throw new Error('Overstyrt rangering må inneholde nøyaktig de 4 spillerne i puljen.');
  }
  const alleKamper = Object.values(pulje.runder).flatMap(r => Object.values(r.kamper));
  const tabell = beregnPuljetabell(pulje.spillereIds, alleKamper, sortertSpillerIdListe ?? null);
  await updateDoc(doc(db, SAM.PROVEN_PULJER, puljeId), {
    manuellRekkefolge: sortertSpillerIdListe ?? null,
    tabell,
  });
  visMelding(sortertSpillerIdListe ? 'Rangering overstyrt.' : 'Overstyring fjernet — automatisk rangering brukes igjen.');
}

export async function erPuljespillFerdig(eventId) {
  const puljer = await hentPuljerForEvent(eventId);
  if (puljer.length !== 3 && puljer.length !== 4) return false;
  return puljer.every(p =>
    Object.values(p.runder).every(r => r.hviler || Object.values(r.kamper).every(k => k.ferdig)));
}

// ════════════════════════════════════════════════════════
// SLUTTSPILL — genereres som ÉTT dokument, seedet fra puljetabellene.
// ════════════════════════════════════════════════════════
export async function startSluttspill(eventId) {
  const event = await hentProvenEvent(eventId);
  if (event.status !== 'puljespill') throw new Error('Sluttspill kan kun startes fra aktivt puljespill.');
  if (!(await erPuljespillFerdig(eventId))) throw new Error('Ikke alle puljekamper er registrert ennå.');

  const puljer = await hentPuljerForEvent(eventId);
  const puljetabeller = {};
  puljer.forEach(p => { puljetabeller[p.navn] = p.tabell; });

  // 12-spillerformat (3 puljer) trenger 3.-plassen i tabellen også (til beste-3'er-uttaket), 16-format trenger bare topp 2.
  const minstAntallPlasser = puljer.length === 3 ? 3 : 2;
  for (const navn of puljer.map(p => p.navn)) {
    if (!puljetabeller[navn] || puljetabeller[navn].length < minstAntallPlasser) {
      throw new Error(`Mangler komplett tabell for pulje ${navn}.`);
    }
  }

  const seeding = puljer.length === 3
    ? genererSluttspillSeeding12(puljetabeller)
    : genererSluttspillSeeding(puljetabeller);
  const sluttspill = {
    eventId,
    qf1: tomSerie(seeding.qf1.spiller1, seeding.qf1.spiller2),
    qf2: tomSerie(seeding.qf2.spiller1, seeding.qf2.spiller2),
    qf3: tomSerie(seeding.qf3.spiller1, seeding.qf3.spiller2),
    qf4: tomSerie(seeding.qf4.spiller1, seeding.qf4.spiller2),
    sf1: tomSerie(null, null),
    sf2: tomSerie(null, null),
    finale: tomSerie(null, null),
  };

  const ref = doc(collection(db, SAM.PROVEN_SLUTTSPILL));
  await setDoc(ref, sluttspill);
  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), { status: 'sluttspill', sluttspillId: ref.id });
  visMelding('Sluttspillet er satt opp!');
  return ref.id;
}

/** Hvilke to serier som sammen avgjør deltakerne i neste serie. */
const NESTE_SERIE_FORELDRE = {
  sf1:    SF_KRYSSPAR.sf1,     // ['qf1','qf4']
  sf2:    SF_KRYSSPAR.sf2,     // ['qf2','qf3']
  finale: FINALE_KRYSSPAR,     // ['sf1','sf2']
};

/**
 * Registrerer én delkamp i én serie (kvartfinale/semifinale/finale). Hvis serien
 * dermed blir avgjort, avanseres vinneren automatisk til neste serie i SAMME
 * skriving — ingen ekstra lesning/skriving-runde trengs.
 * @param {string} sluttspillId
 * @param {'qf1'|'qf2'|'qf3'|'qf4'|'sf1'|'sf2'|'finale'} seriePosisjon
 * @param {'d1'|'d2'|'d3'} delkampKey
 */
export async function registrerSluttspillDelkamp(sluttspillId, seriePosisjon, delkampKey, poeng1, poeng2) {
  const v = validerKampResultat(poeng1, poeng2);
  if (!v.ok) throw new Error(v.feil);

  const snap = await getDoc(doc(db, SAM.PROVEN_SLUTTSPILL, sluttspillId));
  if (!snap.exists()) throw new Error('Sluttspill ikke funnet.');
  const data = snap.data();

  const serie = data[seriePosisjon];
  if (!serie) throw new Error('Ugyldig seriepositsjon.');
  if (!serie.spiller1 || !serie.spiller2) throw new Error('Denne serien har ikke begge spillere klare ennå.');
  if (serie.avgjort) throw new Error('Serien er allerede avgjort.');

  serie.delkamper = { ...serie.delkamper, [delkampKey]: { poeng1, poeng2, ferdig: true } };
  const status = beregnSerieStatus(serie.delkamper);
  serie.avgjort  = status.avgjort;
  serie.vinnerId = status.avgjort ? utledVinnerIdForSerie(serie) : null;

  const oppdatering = {
    [`${seriePosisjon}.delkamper.${delkampKey}.poeng1`]: poeng1,
    [`${seriePosisjon}.delkamper.${delkampKey}.poeng2`]: poeng2,
    [`${seriePosisjon}.delkamper.${delkampKey}.ferdig`]: true,
    [`${seriePosisjon}.avgjort`]: serie.avgjort,
    [`${seriePosisjon}.vinnerId`]: serie.vinnerId,
  };

  // Avanser automatisk til nedstrøms serie hvis begge foreldreserier nå er avgjort.
  if (serie.avgjort) {
    for (const [barn, [forelderA, forelderB]] of Object.entries(NESTE_SERIE_FORELDRE)) {
      if (seriePosisjon !== forelderA && seriePosisjon !== forelderB) continue;
      const serieA = seriePosisjon === forelderA ? serie : data[forelderA];
      const serieB = seriePosisjon === forelderB ? serie : data[forelderB];
      const nesteSerie = utledNesteSerie(serieA, serieB);
      if (nesteSerie) {
        oppdatering[`${barn}.spiller1`] = nesteSerie.spiller1;
        oppdatering[`${barn}.spiller2`] = nesteSerie.spiller2;
      }
    }
  }

  await updateDoc(doc(db, SAM.PROVEN_SLUTTSPILL, sluttspillId), oppdatering);
  visMelding('Resultat registrert!');
}

// ════════════════════════════════════════════════════════
// AVSLUTNING — Hall of Fame + livstidsstatistikk.
// increment() krever INGEN lesning av eksisterende verdier —
// kun 16 skrivinger, én gang per event.
// ════════════════════════════════════════════════════════
export async function avsluttProvenEvent(eventId) {
  const event      = await hentProvenEvent(eventId);
  const sluttspill = await hentSluttspillForEvent(eventId);
  if (!sluttspill?.finale?.avgjort) throw new Error('Finalen er ikke avgjort ennå.');

  const vinnerId = sluttspill.finale.vinnerId;
  const puljer   = await hentPuljerForEvent(eventId);
  const allePuljeKamper = puljer.flatMap(p => Object.values(p.runder).flatMap(r => Object.values(r.kamper)));
  const spillereIds = event.spillere.map(s => s.id);

  const deltaer = beregnLivstidsdeltaer(spillereIds, allePuljeKamper, sluttspill, vinnerId);

  const batch = writeBatch(db);
  for (const [spillerId, delta] of Object.entries(deltaer)) {
    const ref = doc(db, SAM.PROVEN_LIVSTID, spillerId);
    batch.set(ref, {
      klubbId: event.klubbId, // gjør det mulig å avgrense Hall of Fame per klubb (delt Firestore-prosjekt)
      antallEventer: increment(delta.antallEventer),
      kampseire:     increment(delta.kampseire),
      finaler:       increment(delta.finaler),
      eventseire:    increment(delta.eventseire),
    }, { merge: true });
  }
  await batch.commit();

  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), {
    status: 'ferdig', avsluttet: serverTimestamp(), vinnerId,
  });
  visMelding('Prøven er avsluttet — Hall of Fame og livstidsstatistikk er oppdatert!');
}

export async function slettProvenEvent(eventId) {
  await updateDoc(doc(db, SAM.PROVEN_EVENTER, eventId), { status: 'slettet', slettet: serverTimestamp() });
}

// ════════════════════════════════════════════════════════
// LIVSTIDSSTATISTIKK / HALL OF FAME — lesing.
// ════════════════════════════════════════════════════════

/** Henter livstidsstatistikk for en gruppe spillere (f.eks. de 16 i ett event) i én spørring. */
export async function hentLivstidForSpillere(spillerIds) {
  if (!spillerIds?.length) return {};
  const resultat = {};
  // 'in' støtter maks 30 verdier — chunk for sikkerhets skyld selv om Prøven alltid har 16.
  for (let i = 0; i < spillerIds.length; i += 30) {
    const gruppe = spillerIds.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, SAM.PROVEN_LIVSTID), where(documentId(), 'in', gruppe)));
    snap.docs.forEach(d => { resultat[d.id] = d.data(); });
  }
  return resultat;
}

/** Topp N på antall event-seire — enkelt likhets-/sorteringsfelt, ingen composite-indeks nødvendig. */
/** Topp N på antall event-seire, avgrenset til aktiv klubb. Ett likhetsfilter uten orderBy — sortering skjer i JS for å unngå å kreve en ny composite-indeks (samme prinsipp som resten av filen). */
export async function hentHallOfFameTopp(antall = 10) {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(query(collection(db, SAM.PROVEN_LIVSTID), where('klubbId', '==', klubbId)));
    return snap.docs
      .map(d => ({ spillerId: d.id, ...d.data() }))
      .sort((a, b) => (b.eventseire ?? 0) - (a.eventseire ?? 0))
      .slice(0, antall);
  } catch (e) {
    console.warn('[Prøven] hentHallOfFameTopp:', e?.message);
    return [];
  }
}
