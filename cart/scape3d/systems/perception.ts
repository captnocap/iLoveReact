// The delusional distortion model — what the manic brain SHOWS you, not the true
// odds. It warps the DISPLAYED hit-% in the action menu; the ground-truth chance
// from systems/chance.ts is never touched, so a player baited by a comforting fake
// number whiffs the real (low) roll and eats the consequence. This is the
// most-Spun mechanic: the UI lies, the simulation doesn't.
//
//   P_perceived = clamp( P_true·(1 − h/150) + δ(h) + sin(ω·t)·(h/100), 0, 1 )
//
//   δ(h) = 0                         for h < 60        (sober/comeup: honest-ish)
//        = 0.5·((h−60)/40)²          for h ≥ 60        (tweaking: manic optimism)
//
// h is the high intensity on a 0..100 scale; t is system-time in seconds; ω is a
// high-frequency that makes the percentage flicker frantically on screen. At h≥90 a
// terrible shot (P_true=0.15) reads as a jittering ~0.65 — catastrophic confidence.

export const FLICKER_OMEGA = 16; // rad/s — the frantic UI jitter under high

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Stimulant-induced delusional optimism bias, exponential past the tweaking line. */
export function optimismBias(h: number): number {
  if (h < 60) return 0;
  const x = (h - 60) / 40;
  return 0.5 * x * x;
}

/**
 * The shown probability. `pTrue` 0..1, `h` 0..100, `tMs` system-time in ms. Sober
 * (h≈0) returns the truth unchanged; the lie ramps with the high.
 */
export function perceivedChance(pTrue: number, h: number, tMs: number, omega: number = FLICKER_OMEGA): number {
  if (h <= 0.5) return pTrue; // sober: the UI tells the truth
  const t = tMs / 1000;
  const dampened = pTrue * (1 - h / 150);
  const jitter = Math.sin(omega * t) * (h / 100);
  return clamp(dampened + optimismBias(h) + jitter, 0, 1);
}
