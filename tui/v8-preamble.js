// v8cli polyfills — must run before any module that captures setTimeout
// or process.stdout into a local. Imported as the first line of entry.tsx,
// so esbuild emits it at the top of the bundle.

const __timers = [];
let __timerSeq = 1;

globalThis.setTimeout = (fn, ms) => {
  const id = __timerSeq++;
  __timers.push({ id, fn, fireAt: __nowMs() + (ms | 0), repeat: 0 });
  return id;
};
globalThis.setInterval = (fn, ms) => {
  const id = __timerSeq++;
  __timers.push({ id, fn, fireAt: __nowMs() + (ms | 0), repeat: ms | 0 });
  return id;
};
globalThis.clearTimeout = (id) => {
  for (let i = 0; i < __timers.length; i++) if (__timers[i].id === id) { __timers.splice(i, 1); return; }
};
globalThis.clearInterval = globalThis.clearTimeout;

if (typeof globalThis.queueMicrotask !== 'function') {
  globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
}

// process polyfill — v8cli already exposes process with argv/env/exit/cwd/platform.
// We tack on stdout/stdin shims for the host.
globalThis.process = globalThis.process || {};
const stdout = globalThis.process.stdout = globalThis.process.stdout || {};

// Live terminal size via TIOCGWINSZ on every access — handles resize
// without a SIGWINCH handler. Falls back to build-time defines, then 80x24.
function __readTermSize() {
  try {
    const arr = JSON.parse(__termSize());
    if (Array.isArray(arr) && arr.length === 2 && arr[0] > 0 && arr[1] > 0) return arr;
  } catch {}
  return [
    (typeof __TUI_COLS__ === 'number') ? __TUI_COLS__ : 80,
    (typeof __TUI_ROWS__ === 'number') ? __TUI_ROWS__ : 24,
  ];
}
Object.defineProperty(stdout, 'columns', { get: () => __readTermSize()[0], configurable: true });
Object.defineProperty(stdout, 'rows',    { get: () => __readTermSize()[1], configurable: true });
stdout.write   = (s) => { __writeStdout(typeof s === 'string' ? s : String(s)); return true; };
stdout.on      = () => stdout;
stdout.isTTY   = true;

const stdin = globalThis.process.stdin = globalThis.process.stdin || {};
const __stdinListeners = [];
let __stdinPollTimer = null;
stdin.isTTY       = true;
stdin.setRawMode  = (on) => { __setStdinRaw(on ? 1 : 0); };
stdin.resume      = () => {
  if (__stdinPollTimer !== null) return;
  __stdinPollTimer = setInterval(() => {
    const data = __readStdin();
    if (data && data.length > 0) {
      for (const fn of __stdinListeners) {
        try { fn(data); } catch (e) { __writeStderr('[stdin] ' + e + '\n'); }
      }
    }
  }, 16);
};
stdin.pause       = () => {
  if (__stdinPollTimer !== null) { clearInterval(__stdinPollTimer); __stdinPollTimer = null; }
};
stdin.setEncoding = () => {};
stdin.on          = (event, fn) => {
  if (event === 'data' && typeof fn === 'function') __stdinListeners.push(fn);
  return stdin;
};

globalThis.process.env = globalThis.process.env || { NODE_ENV: 'production' };
globalThis.process.exit = globalThis.process.exit || ((code) => __exit(code | 0));
globalThis.process.on   = globalThis.process.on   || (() => globalThis.process);

// performance.now() shim — many carts (and renderer/hostConfig.ts) call
// this for timestamps. v8cli exposes __nowMs but not performance.
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => __nowMs() };
}

// requestAnimationFrame shim — fires roughly at 60Hz via setTimeout. The
// TUI host doesn't have a real frame loop; this is enough to keep
// useHostAnimation-driven carts ticking.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  let rafId = 1;
  globalThis.requestAnimationFrame = (fn) => {
    const id = rafId++;
    setTimeout(() => fn(performance.now()), 16);
    return id;
  };
  globalThis.cancelAnimationFrame = () => {};
}

// v8cli has no event loop. We run our own as a microtask trampoline so
// V8 drains queued microtasks (repaint, scheduler callbacks, react effect
// flushes) between every timer step. A naive synchronous while-loop
// would prevent the call stack from ever returning to the top, blocking
// microtask drain forever.
globalThis.__runEventLoop = function (done) {
  // __tickDrain pumps optional V8 bindings whose tickDrain() advances
  // async work (httpsrv accepts, sdk request completion, etc.). It's
  // registered by v8_tui_app.zig when the relevant -Dhas-* flags fired.
  // Undefined for TUI builds that don't ship any networking.
  const tickDrain = (typeof __tickDrain === 'function') ? __tickDrain : null;
  const step = () => {
    if (tickDrain && tickDrain() && globalThis.__onVtermUpdate) globalThis.__onVtermUpdate();
    if (__timers.length === 0) { if (done) done(); return; }
    __timers.sort((a, b) => a.fireAt - b.fireAt);
    const head = __timers[0];
    const wait = head.fireAt - __nowMs();
    if (wait > 0) {
      __sleepMs(Math.min(wait, 50));
      Promise.resolve().then(step);
      return;
    }
    __timers.shift();
    if (head.repeat > 0) {
      head.fireAt = __nowMs() + head.repeat;
      __timers.push(head);
    }
    try { head.fn(); } catch (e) { __writeStderr('[timer] ' + e + '\n'); }
    // Yielding via a microtask lets V8 drain everything queued by the
    // callback (commit phase repaint, scheduled effects) before we pull
    // the next timer.
    Promise.resolve().then(step);
  };
  step();
};
