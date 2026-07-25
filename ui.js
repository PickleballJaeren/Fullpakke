// ════════════════════════════════════════════════════════
// ui.js — Generelle UI-hjelpere
// Toast-meldinger, Firebase-feilbanner, XSS-escaping og navigasjon.
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// TOAST + FIREBASE-FEILBANNER
// ════════════════════════════════════════════════════════
let toastTimer = null;

export function visMelding(tekst, type = 'ok', varighet = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = tekst;
  t.className   = 'toast' + (type === 'feil' ? ' feil' : type === 'advarsel' ? ' advarsel' : '');
  t.classList.add('vis');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('vis'), varighet);
}

export function visFBFeil(tekst) {
  const banner = document.getElementById('firebase-feil-banner');
  const span   = document.getElementById('firebase-feil-tekst');
  if (banner && span) { span.textContent = tekst; banner.classList.add('vis'); }
  console.error('[Firebase]', tekst);
}

// ════════════════════════════════════════════════════════
// XSS-BESKYTTELSE
// ════════════════════════════════════════════════════════
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════════════════
// NAVIGASJON
// Enkel skjermbytter — skjuler alle .screen, viser skjerm-<navn>.
// ════════════════════════════════════════════════════════
export function naviger(skjerm) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('skjerm-' + skjerm);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('sl-naviger', { detail: { skjerm } }));
}
window.naviger = naviger;

// ════════════════════════════════════════════════════════
// BEFOREUNLOAD — advar ved utilsiktet lukking mens man står
// midt i poengregistrering (valgfritt, kalles fra app.js).
// ════════════════════════════════════════════════════════
export function registrerBeforeunload(harUlagredeEndringer) {
  window.addEventListener('beforeunload', e => {
    if (harUlagredeEndringer()) { e.preventDefault(); e.returnValue = ''; }
  });
}
