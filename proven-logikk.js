// ════════════════════════════════════════════════════════
// proven-logikk.js — Ren Prøven-logikk
// Ingen Firebase-avhengigheter, ingen DOM, ingen async/await,
// og ingen avhengighet til andre moduler i appen — helt selvstendig
// (samme prinsipp som stafettliga-logikk.js).
//
// Datastrukturene under er bevisst designet for å være billige
// å lagre/oppdatere i Firestore: kamper ligger som MAP-felt
// (kamp1/kamp2, d1/d2/d3), ikke arrays — det gjør at en enkelt
// kampregistrering kan skrives som en dot-path partial update
// (f.eks. "runder.runde2.kamper.kamp1.poeng1") uten å lese eller
// skrive hele dokumentet på nytt.
//
// Importeres av proven.js og proven-ui.js.
// ════════════════════════════════════════════════════════

/** Fisher-Yates-stokking — brukt til puljetrekning. */
export function blandArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ════════════════════════════════════════════════════════
// KILDER — hvordan en spiller kvalifiserte seg til Prøven
// ════════════════════════════════════════════════════════
export const KILDER = ['8eren', 'naloyet', 'wildcard', 'admin_invite'];

export function erGyldigKilde(kilde) {
  return KILDER.includes(kilde);
}

// ════════════════════════════════════════════════════════
// DISIPLINER
// ════════════════════════════════════════════════════════
export const DISIPLINER = ['pickleball', 'skyball', 'speedminton'];

/** Finalen spiller disiplinene i denne faste rekkefølgen, i motsetning til
 *  puljespillets rotasjonsplan — kun så mange som trengs for 2 seire. */
export const FINALE_DISIPLIN_REKKEFOLGE = ['pickleball', 'skyball', 'speedminton'];

// ════════════════════════════════════════════════════════
// PULJETREKNING — 16 spillere → 4 puljer à 4, tilfeldig.
// Admin kan justere manuelt i UI-et etterpå (bytter spillere
// mellom puljene før sesongen/eventet startes — ren UI-state,
// ingen egen logikkfunksjon nødvendig for det).
// ════════════════════════════════════════════════════════
const PULJENAVN = ['A', 'B', 'C', 'D'];

/**
 * @param {Array<{id, navn, kilde, wildcardBegrunnelse?}>} spillere16 — nøyaktig 16 spillere
 * @returns {Array<{navn: string, spillere: Array}>} 4 puljer à 4 spillere
 */
export function trekkPuljer(spillere16) {
  if (spillere16.length !== 16) {
    throw new Error(`Prøven krever nøyaktig 16 spillere (fikk ${spillere16.length}).`);
  }
  const stokket = blandArray(spillere16);
  return PULJENAVN.map((navn, i) => ({
    navn,
    spillere: stokket.slice(i * 4, i * 4 + 4),
  }));
}

// ════════════════════════════════════════════════════════
// PULJE-DISIPLINPLAN (§ hvilken disiplin hver pulje spiller i
// hver av de 4 rundene i kvelden) — fast oppslagstabell, samme
// stil som ROTASJONSSYKLUS i stafettliga-logikk.js.
//
// Konstruert slik at:
//  - hver pulje spiller hver av de 3 disiplinene nøyaktig én gang
//    (over sine 3 aktive runder)
//  - hver runde har de 3 aktive puljene i 3 FORSKJELLIGE disipliner
//    (kritisk — kun 2 baner per disiplin, så to puljer kan aldri
//    dele disiplin i samme runde)
//  - hver pulje hviler i nøyaktig én runde
//
// Indeks 0-3 = pulje A-D.
// ════════════════════════════════════════════════════════
const PULJEPLAN = [
  /* A */ { runde1: null,            runde2: 'skyball',    runde3: 'pickleball',  runde4: 'speedminton' },
  /* B */ { runde1: 'pickleball',    runde2: null,          runde3: 'speedminton', runde4: 'skyball' },
  /* C */ { runde1: 'skyball',       runde2: 'speedminton', runde3: null,          runde4: 'pickleball' },
  /* D */ { runde1: 'speedminton',   runde2: 'pickleball',  runde3: 'skyball',     runde4: null },
];

/** @returns {number} hvilken global runde (1-4) puljen med gitt indeks (0-3) hviler i. */
export function hentHvilerundeForPulje(puljeIndeks) {
  const plan = PULJEPLAN[puljeIndeks];
  if (!plan) throw new Error(`Ugyldig puljeindeks: ${puljeIndeks}`);
  for (let runde = 1; runde <= 4; runde++) {
    if (plan[`runde${runde}`] === null) return runde;
  }
  throw new Error('Fant ingen hvilerunde — dette skal aldri skje.');
}

// ════════════════════════════════════════════════════════
// PULJEPARINGER — round robin for nøyaktig 4 spillere,
// gruppert i 3 runder à 2 kamper (sirkelmetode). Dekker alle
// 6 mulige par nøyaktig én gang.
// ════════════════════════════════════════════════════════

/**
 * @param {Array} spillereIds4 — nøyaktig 4 spiller-ID-er
 * @returns {Array<Array<[string,string]>>} 3 interne runder, hver med 2 par
 */
export function genererPuljeParinger(spillereIds4) {
  if (spillereIds4.length !== 4) throw new Error('genererPuljeParinger krever nøyaktig 4 spillere.');
  const [a, b, c, d] = spillereIds4;
  return [
    [[a, d], [b, c]],
    [[a, c], [d, b]],
    [[a, b], [c, d]],
  ];
}

function tomPuljeKamp(par, baneNr) {
  return { par, baneNr, poeng1: null, poeng2: null, ferdig: false };
}

/**
 * Genererer komplett puljeplan for én pulje: 4 runder, der 3 er aktive
 * (med disiplin + 2 kamper hver) og 1 er hvilerunde.
 * @param {{navn: string, spillere: Array<{id, navn}>}} pulje
 * @param {number} puljeIndeks — 0-3, avgjør disiplinplan (PULJEPLAN)
 */
export function genererPuljeplan(pulje, puljeIndeks) {
  const spillereIds = pulje.spillere.map(s => s.id);
  const parRunder = genererPuljeParinger(spillereIds); // 3 interne runder, kronologisk rekkefølge
  const disiplinRad = PULJEPLAN[puljeIndeks];
  if (!disiplinRad) throw new Error(`Ugyldig puljeindeks: ${puljeIndeks}`);

  let internIndeks = 0;
  const runder = {};
  for (let globalRunde = 1; globalRunde <= 4; globalRunde++) {
    const disiplin = disiplinRad[`runde${globalRunde}`];
    if (disiplin === null) {
      runder[`runde${globalRunde}`] = { disiplin: null, hviler: true, kamper: {} };
      continue;
    }
    const [par1, par2] = parRunder[internIndeks];
    internIndeks++;
    runder[`runde${globalRunde}`] = {
      disiplin,
      hviler: false,
      kamper: {
        kamp1: tomPuljeKamp(par1, 1),
        kamp2: tomPuljeKamp(par2, 2),
      },
    };
  }

  return { navn: pulje.navn, spillereIds, runder, tabell: [] };
}

/**
 * @param {Array<{navn, spillere}>} puljer — nøyaktig 4 puljer à 4 spillere (fra trekkPuljer)
 * @returns {Array} 4 komplette puljeplaner, klare til å lagres som ett dokument hver
 */
export function genererProvenPuljeoppsett(puljer) {
  if (puljer.length !== 4) throw new Error('Forventet nøyaktig 4 puljer.');
  return puljer.map((p, i) => genererPuljeplan(p, i));
}

/** Flat liste over alle kamper i en puljeplan (praktisk for tabellberegning/statistikk). */
export function hentAlleKamperFraPuljeplan(puljeplan) {
  return Object.values(puljeplan.runder).flatMap(r => Object.values(r.kamper));
}

// ════════════════════════════════════════════════════════
// VALIDERING AV KAMPRESULTAT — ingen uavgjort, ikke-negative heltall.
// ════════════════════════════════════════════════════════
export function validerKampResultat(poeng1, poeng2) {
  if (!Number.isInteger(poeng1) || !Number.isInteger(poeng2) || poeng1 < 0 || poeng2 < 0) {
    return { ok: false, feil: 'Poeng må være ikke-negative heltall.' };
  }
  if (poeng1 === poeng2) {
    return { ok: false, feil: 'Kampen kan ikke ende uavgjort — det må kåres en vinner.' };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// PULJETABELL — poeng (3 for seier) → poengprosent → innbyrdes
// → admin kan overstyre hele rangeringen manuelt hvis nødvendig.
// ════════════════════════════════════════════════════════

/**
 * @param {Array<string>} spillereIds — de 4 spillerne i puljen
 * @param {Array<{par:[string,string], poeng1, poeng2, ferdig}>} alleKamper
 * @param {Array<string>|null} manuellRekkefolge — admin-overstyrt sortert spillerId-liste, hvis satt
 * @returns {Array<{spillerId, poeng, poengprosent, plass}>}
 */
export function beregnPuljetabell(spillereIds, alleKamper, manuellRekkefolge = null) {
  if (manuellRekkefolge) {
    return manuellRekkefolge.map((spillerId, i) => ({ spillerId, plass: i + 1, manuell: true }));
  }

  const rader = spillereIds.map(id => {
    let poeng = 0, scoret = 0, totalt = 0;
    for (const k of alleKamper) {
      if (!k.ferdig) continue;
      const erS1 = k.par[0] === id, erS2 = k.par[1] === id;
      if (!erS1 && !erS2) continue;
      const egen = erS1 ? k.poeng1 : k.poeng2;
      const mot  = erS1 ? k.poeng2 : k.poeng1;
      scoret += egen; totalt += egen + mot;
      if (egen > mot) poeng += 3;
    }
    const poengprosent = totalt > 0 ? (scoret / totalt) * 100 : 0;
    return { spillerId: id, poeng, poengprosent };
  });

  function innbyrdes(idA, idB) {
    const oppgjor = alleKamper.find(k => k.ferdig &&
      ((k.par[0] === idA && k.par[1] === idB) || (k.par[0] === idB && k.par[1] === idA)));
    if (!oppgjor) return 0;
    const aErS1 = oppgjor.par[0] === idA;
    const poengA = aErS1 ? oppgjor.poeng1 : oppgjor.poeng2;
    const poengB = aErS1 ? oppgjor.poeng2 : oppgjor.poeng1;
    return poengA - poengB;
  }

  rader.sort((a, b) => {
    if (b.poeng !== a.poeng) return b.poeng - a.poeng;
    if (b.poengprosent !== a.poengprosent) return b.poengprosent - a.poengprosent;
    const inn = innbyrdes(a.spillerId, b.spillerId);
    if (inn !== 0) return -inn;
    return 0; // helt likt på alt — admin må overstyre manuelt (manuellRekkefolge) i UI-et
  });

  return rader.map((r, i) => ({ ...r, plass: i + 1 }));
}

// ════════════════════════════════════════════════════════
// SLUTTSPILL-SEEDING — fra puljeplassering til kvartfinaler.
// ════════════════════════════════════════════════════════

/**
 * @param {{A: Array, B: Array, C: Array, D: Array}} puljetabeller — sorterte tabeller (fra beregnPuljetabell)
 * @returns {{qf1, qf2, qf3, qf4}} spiller1/spiller2-ID-er for hver kvartfinale
 */
export function genererSluttspillSeeding(puljetabeller) {
  const vinner = t => t[0].spillerId;
  const toer   = t => t[1].spillerId;
  const { A, B, C, D } = puljetabeller;
  return {
    qf1: { spiller1: vinner(A), spiller2: toer(B) },
    qf2: { spiller1: vinner(B), spiller2: toer(A) },
    qf3: { spiller1: vinner(C), spiller2: toer(D) },
    qf4: { spiller1: vinner(D), spiller2: toer(C) },
  };
}

/** Krysspar for semifinalene — bevisst kryss for å unngå gjensyn fra samme opprinnelige pulje. */
export const SF_KRYSSPAR = { sf1: ['qf1', 'qf4'], sf2: ['qf2', 'qf3'] };
export const FINALE_KRYSSPAR = ['sf1', 'sf2'];

// ════════════════════════════════════════════════════════
// SERIER (kvartfinale/semifinale/finale) — best-av-3, avgjøres
// ved 2 seire. Finalen bruker samme struktur, men delkampenes
// disiplin er fast (FINALE_DISIPLIN_REKKEFOLGE) i stedet for fri.
// ════════════════════════════════════════════════════════

function tomSerieDelkamp() {
  return { poeng1: null, poeng2: null, ferdig: false };
}

/**
 * @param {string} spiller1Id
 * @param {string} spiller2Id
 * @returns {object} tom serie, klar til å lagres
 */
export function tomSerie(spiller1Id = null, spiller2Id = null) {
  return {
    spiller1: spiller1Id,
    spiller2: spiller2Id,
    delkamper: { d1: tomSerieDelkamp(), d2: tomSerieDelkamp() }, // d3 legges til kun ved behov
    avgjort: false,
    vinnerId: null,
  };
}

/**
 * @param {{d1,d2,d3?}} delkamperMap
 * @returns {{seire1, seire2, avgjort, vinnerIndeks: 1|2|null}}
 */
export function beregnSerieStatus(delkamperMap) {
  let seire1 = 0, seire2 = 0;
  for (const key of Object.keys(delkamperMap)) {
    const d = delkamperMap[key];
    if (!d || !d.ferdig) continue;
    if (d.poeng1 > d.poeng2) seire1++;
    else if (d.poeng2 > d.poeng1) seire2++;
  }
  const avgjort = seire1 === 2 || seire2 === 2;
  return { seire1, seire2, avgjort, vinnerIndeks: avgjort ? (seire1 === 2 ? 1 : 2) : null };
}

/** @returns {boolean} true hvis serien står 1-1 og trenger en tredje delkamp/disiplin. */
export function trengerTredjeDelkamp(delkamperMap) {
  const { seire1, seire2, avgjort } = beregnSerieStatus(delkamperMap);
  return !avgjort && seire1 === 1 && seire2 === 1;
}

/** @returns {string|null} spillerId for vinneren av serien, eller null hvis ikke avgjort ennå. */
export function utledVinnerIdForSerie(serie) {
  const status = beregnSerieStatus(serie.delkamper);
  if (!status.avgjort) return null;
  return status.vinnerIndeks === 1 ? serie.spiller1 : serie.spiller2;
}

/**
 * Avleder deltakerne til neste runde ut fra to avgjorte serier (f.eks. qf1+qf4 → sf1).
 * @param {object} serieA
 * @param {object} serieB
 * @returns {{spiller1, spiller2}|null} null hvis én eller begge foreldreserier ikke er avgjort ennå
 */
export function utledNesteSerie(serieA, serieB) {
  const vinnerA = utledVinnerIdForSerie(serieA);
  const vinnerB = utledVinnerIdForSerie(serieB);
  if (!vinnerA || !vinnerB) return null;
  return tomSerie(vinnerA, vinnerB);
}

// ════════════════════════════════════════════════════════
// LIVSTIDSSTATISTIKK — beregner deltaer som skal legges til
// hver spillers livstidsdokument når eventet avsluttes.
// Ren funksjon — proven.js gjør selve batch-lesing/skrivingen.
// ════════════════════════════════════════════════════════

/**
 * @param {Array<string>} spillereIds — alle 16 spillerne i eventet
 * @param {Array<{par:[string,string], poeng1, poeng2, ferdig}>} allePuljeKamper
 * @param {{qf1,qf2,qf3,qf4,sf1,sf2,finale}} sluttspill
 * @param {string|null} vinnerId — vinner av hele eventet (finalisten som tok 2 disipliner)
 * @returns {Object<string, {antallEventer, kampseire, finaler, eventseire}>} deltaer, én per spiller
 */
export function beregnLivstidsdeltaer(spillereIds, allePuljeKamper, sluttspill, vinnerId) {
  const deltaer = {};
  spillereIds.forEach(id => { deltaer[id] = { antallEventer: 1, kampseire: 0, finaler: 0, eventseire: 0 }; });

  const tellSeier = (s1Id, s2Id, poeng1, poeng2) => {
    if (poeng1 == null || poeng2 == null) return;
    if (poeng1 > poeng2 && deltaer[s1Id]) deltaer[s1Id].kampseire++;
    else if (poeng2 > poeng1 && deltaer[s2Id]) deltaer[s2Id].kampseire++;
  };

  allePuljeKamper.forEach(k => { if (k.ferdig) tellSeier(k.par[0], k.par[1], k.poeng1, k.poeng2); });

  Object.values(sluttspill || {}).forEach(serie => {
    if (!serie?.spiller1 || !serie?.spiller2) return;
    Object.values(serie.delkamper || {}).forEach(d => {
      if (d?.ferdig) tellSeier(serie.spiller1, serie.spiller2, d.poeng1, d.poeng2);
    });
  });

  const finale = sluttspill?.finale;
  if (finale?.spiller1 && deltaer[finale.spiller1]) deltaer[finale.spiller1].finaler++;
  if (finale?.spiller2 && deltaer[finale.spiller2]) deltaer[finale.spiller2].finaler++;

  if (vinnerId && deltaer[vinnerId]) deltaer[vinnerId].eventseire++;

  return deltaer;
}
