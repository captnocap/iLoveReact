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
// Same idea for routes (req_1637): clicking a route button -> navStart(path); the
// shell's route effect calls navReady(path) on first render; a settle watch then
// reports when that route actually finished loading (not just first-painted). Route
// readiness also waits for the host-flush drain to go calm; a calm JS timer alone
// is not proof that the native tree is usable.
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
const ROUTE_NATIVE_QUIET_FRAMES = 8;

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
let navSeq = 0;

type RouteCounters = {
  jsFlushes: number;
  jsBytes: number;
  nativeQueued: number;
  nativeEnqueued: number;
  nativeDrained: number;
  nativeDrainBytes: number;
};

type ActiveRouteProbe = {
  seq: number;
  path: string;
  clickedAt: number;
  start: RouteCounters;
  firstInput: boolean;
};

let activeProbe: ActiveRouteProbe | null = null;

function readRouteCounters(): RouteCounters {
  const flush = typeof g.__flushReport === 'function' ? (g.__flushReport() ?? {}) : {};
  const native = typeof g.__tel_host_flush === 'function' ? (g.__tel_host_flush() ?? {}) : {};
  return {
    jsFlushes: Number(flush.flushCount) || 0,
    jsBytes: Number(flush.totalBytes) || 0,
    nativeQueued: Number(native.queued_batches) || 0,
    nativeEnqueued: Number(native.total_enqueued_batches) || 0,
    nativeDrained: Number(native.total_drained_batches) || 0,
    nativeDrainBytes: Number(native.total_drained_bytes) || 0,
  };
}

function routeCounterDelta(from: RouteCounters, to: RouteCounters): string {
  const kb = (Math.max(0, to.jsBytes - from.jsBytes) / 1024).toFixed(0);
  const drainKb = (Math.max(0, to.nativeDrainBytes - from.nativeDrainBytes) / 1024).toFixed(0);
  return `flushes +${Math.max(0, to.jsFlushes - from.jsFlushes)}, js +${kb}KB, native drained +${Math.max(0, to.nativeDrained - from.nativeDrained)} batch/${drainKb}KB`;
}

/** Call from a route button's onClick, BEFORE nav.push, with the target path. */
export function navStart(path: string): void {
  navAt = nowMs();
  navTo = path;
  const seq = ++navSeq;
  activeProbe = { seq, path, clickedAt: navAt, start: readRouteCounters(), firstInput: false };
  try { console.warn(`[route] → ${path} (clicked)`); } catch {}
}

/**
 * Call when the shell has rendered the new route (a useEffect keyed on route.path).
 * Logs first-render latency, then arms a settle watch for the fully-loaded number.
 */
export function navReady(path: string): void {
  if (!navAt || path !== navTo) return;
  const clickedAt = navAt;
  const probe = activeProbe && activeProbe.path === path ? activeProbe : null;
  navAt = 0; // consume so re-renders of the same route don't re-log
  try { console.warn(`[route] ${path} first render +${(nowMs() - clickedAt).toFixed(0)}ms`); } catch {}
  watchRouteSettle((total, timedOut, counters) => {
    if (probe && activeProbe?.seq !== probe.seq) return;
    const detail = probe ? ` — ${routeCounterDelta(probe.start, counters)}` : '';
    try { console.warn(`[route] ${path} loaded +${total.toFixed(0)}ms${timedOut ? ' (deadline hit, still busy)' : ''}${detail}`); } catch {}
  }, clickedAt, probe?.start ?? readRouteCounters());
}

// Called by runtime/index.tsx from the real Zig -> JS event path. This does not
// assert the route is loaded by itself; it proves when a user event actually made
// it through after navigation, which is the number to compare against "I can do
// something now."
g.__routeInputMaybe = (id: number, type: string) => {
  const probe = activeProbe;
  if (!probe || probe.firstInput) return;
  if (!isUserActionEvent(type)) return;
  probe.firstInput = true;
  const counters = readRouteCounters();
  try {
    console.warn(`[route] ${probe.path} first input +${(nowMs() - probe.clickedAt).toFixed(0)}ms (${type} id=${id}) — ${routeCounterDelta(probe.start, counters)}`);
  } catch {}
};

function isUserActionEvent(type: string): boolean {
  return type !== 'onMouseMove' && type !== 'onPointerMove' && type !== 'onHoverEnter' && type !== 'onHoverExit';
}

function routeNativeIsQuiet(start: RouteCounters, last: RouteCounters, current: RouteCounters): boolean {
  // If the host telemetry is absent, all native counters are zero; don't block on
  // impossible evidence. The timer-settle path still measures JS/main-thread delay.
  const nativeWired = current.nativeEnqueued > 0 || current.nativeDrained > 0 || current.nativeQueued > 0;
  if (!nativeWired) return true;

  const routeEnqueued = current.nativeEnqueued > start.nativeEnqueued || current.jsFlushes > start.jsFlushes;
  if (!routeEnqueued) return false;
  if (current.nativeQueued > 0) return false;
  if (current.nativeDrained < current.nativeEnqueued) return false;
  return current.nativeEnqueued === last.nativeEnqueued && current.nativeDrained === last.nativeDrained && current.jsFlushes === last.jsFlushes;
}

function watchRouteSettle(
  onDone: (totalMs: number, timedOut: boolean, counters: RouteCounters) => void,
  startAt: number,
  startCounters: RouteCounters,
): void {
  const schedule = scheduler();
  if (!schedule) { onDone(nowMs() - startAt, false, readRouteCounters()); return; }
  let prev = nowMs();
  let quiet = 0;
  let nativeQuiet = 0;
  let lastCounters = readRouteCounters();
  const deadline = startAt + SETTLE_DEADLINE_MS;
  const tick = () => {
    const t = nowMs();
    const dt = t - prev;
    const counters = readRouteCounters();
    const jsQuiet = dt <= CALM_MS;
    const nativeQuietNow = routeNativeIsQuiet(startCounters, lastCounters, counters);
    prev = t;
    lastCounters = counters;
    if (t >= deadline) { onDone(t - startAt, true, counters); return; }
    quiet = jsQuiet ? quiet + 1 : 0;
    nativeQuiet = nativeQuietNow ? nativeQuiet + 1 : 0;
    if (quiet >= QUIET_FRAMES && nativeQuiet >= ROUTE_NATIVE_QUIET_FRAMES) {
      onDone(t - startAt, false, counters);
      return;
    }
    schedule(tick);
  };
  schedule(tick);
}

// Shared frame-settle detector: calls onDone(totalMsSinceStartAt, timedOut) once a
// run of calm frames is seen (boot/route work drained), or when the deadline passes.
function watchSettle(onDone: (totalMs: number, timedOut: boolean) => void, startAt: number): void {
  const schedule = scheduler();
  if (!schedule) { onDone(nowMs() - startAt, false); return; } // headless: no frames or timers to watch
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
    schedule(tick);
  };
  schedule(tick);
}

function scheduler(): ((fn: () => void) => void) | null {
  const raf = g.requestAnimationFrame;
  if (typeof raf === 'function') return (fn) => { raf.call(g, fn); };
  const st = g.setTimeout;
  if (typeof st === 'function') return (fn) => { st.call(g, fn, 16); };
  return null;
}
