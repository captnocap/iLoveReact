// startupTimer — boot + route-navigation timing for the hmsc-int editor.
//
// "I'm pretty sure I broke startup time." This makes boot measurable, and (req_1637)
// answers the HONEST version: the canvas MOUNTING is not the map being LOADED — the
// chunk bakes, grass population, and the 3D preview keep the main thread busy for a
// beat after mount, so a mount-time "READY" was lying (the user feels ~3s). So the
// final READY is no longer a mount event; it's when the main thread SETTLES — a run
// of calm animation frames means the boot work has drained. That is the number you
// feel.
//
// Same idea for routes (req_1637): clicking a route button → navStart(path); the
// shell's route effect calls navReady(path) on first render; a settle watch then
// reports when that route actually finished loading (not just first-painted).
//
// Everything is console.warn so it lands in the `rjit dev` terminal next to the
// [mapgone] trace (severity-0 console.log never reaches the terminal — see memory
// console_log_severity_terminal). Pure diagnostics, no behavioural effect. grep
// `startupTimer` / `startupMark` / `navStart` to remove.

const g: any = globalThis;

// ONE frozen clock (req_1633): performance.now() may not be installed at the
// earliest module-eval, and re-resolving the source per call mixed epoch-ms (Date.now
// ~1.78e12) with monotonic-ms (performance.now ~thousands) — deltas went hugely
// negative. Pick the source ONCE, here, and stick with it for every mark.
const perfNow = g.performance?.now;
const nowMs: () => number = typeof perfNow === 'function'
  ? () => perfNow.call(g.performance)
  : () => Date.now();

// Settle tuning: a frame this calm ran no heavy boot/route work; this many calm
// frames in a row means the main thread has drained. The deadline is a safety cap so
// a never-quiet surface (an animating preview) still reports a number.
const CALM_MS = 32;
const QUIET_FRAMES = 6;
const SETTLE_DEADLINE_MS = 12000;

// t0 = when this module first evaluates (imported FIRST in index.tsx).
const t0 = nowMs();
let last = t0;
let done = false;

/** Stamp a boot phase. No-op once startup is marked done. */
export function startupMark(label: string): void {
  if (done) return;
  const t = nowMs();
  try { console.warn(`[startup] +${(t - t0).toFixed(0)}ms  Δ${(t - last).toFixed(0)}ms  ${label}`); } catch {}
  last = t;
}

/**
 * Arm the boot settle watch — call once, as early in the mount as possible. It
 * watches frames and declares startup done when the main thread goes quiet (chunk
 * bakes / grass / 3D build drained): the honest end-of-load, measured from t0.
 */
export function startupWatchSettle(): void {
  if (done) return;
  watchSettle((total, timedOut) => {
    if (done) return;
    done = true;
    try {
      console.warn(`[startup] +${total.toFixed(0)}ms  fully loaded — main thread settled${timedOut ? ' (deadline hit, still busy)' : ''}  ◀ READY`);
    } catch {}
  }, t0);
}

// ── Route navigation timing ──────────────────────────────────────────────────
let navAt = 0;
let navTo = '';

/** Call from a route button's onClick, BEFORE nav.push, with the target path. */
export function navStart(path: string): void {
  navAt = nowMs();
  navTo = path;
  try { console.warn(`[route] → ${path} (clicked)`); } catch {}
}

/**
 * Call when the shell has rendered the new route (a useEffect keyed on route.path).
 * Logs first-render latency, then arms a settle watch for the fully-loaded number.
 */
export function navReady(path: string): void {
  if (!navAt || path !== navTo) return;
  const clickedAt = navAt;
  navAt = 0; // consume so re-renders of the same route don't re-log
  try { console.warn(`[route] ${path} first render +${(nowMs() - clickedAt).toFixed(0)}ms`); } catch {}
  watchSettle((total, timedOut) => {
    try { console.warn(`[route] ${path} loaded +${total.toFixed(0)}ms${timedOut ? ' (deadline hit, still busy)' : ''}`); } catch {}
  }, clickedAt);
}

// Shared frame-settle detector: calls onDone(totalMsSinceStartAt, timedOut) once a
// run of calm frames is seen (boot/route work drained), or when the deadline passes.
function watchSettle(onDone: (totalMs: number, timedOut: boolean) => void, startAt: number): void {
  const raf = g.requestAnimationFrame;
  if (typeof raf !== 'function') { onDone(nowMs() - startAt, false); return; } // headless: no frames to watch
  let prev = nowMs();
  let quiet = 0;
  const deadline = startAt + SETTLE_DEADLINE_MS;
  const tick = () => {
    const t = nowMs();
    const dt = t - prev;
    prev = t;
    if (t >= deadline) { onDone(t - startAt, true); return; }
    if (dt <= CALM_MS) {
      if (++quiet >= QUIET_FRAMES) { onDone(t - startAt, false); return; }
    } else {
      quiet = 0;
    }
    raf.call(g, tick);
  };
  raf.call(g, tick);
}
