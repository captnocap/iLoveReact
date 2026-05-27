/**
 * process — subprocess + environment bindings backed by framework/process.zig.
 *
 * Stdin/stdout are handled via streaming callbacks since process output comes
 * over time. Small-program patterns (one-shot commands that finish fast) get
 * convenience wrappers that await completion.
 *
 * Registration (Zig side):
 *
 *   qjs_runtime.registerHostFn("__proc_spawn", @ptrCast(&proc_spawn), 1);
 *   qjs_runtime.registerHostFn("__proc_kill", @ptrCast(&proc_kill), 1);
 *   qjs_runtime.registerHostFn("__proc_wait", @ptrCast(&proc_wait), 1);
 *   qjs_runtime.registerHostFn("__proc_stdin_write", @ptrCast(&proc_stdin_write), 2);
 *   qjs_runtime.registerHostFn("__proc_stdin_close", @ptrCast(&proc_stdin_close), 1);
 *   qjs_runtime.registerHostFn("__env_get", @ptrCast(&env_get), 1);
 *   qjs_runtime.registerHostFn("__env_set", @ptrCast(&env_set), 2);
 *   qjs_runtime.registerHostFn("__exit", @ptrCast(&exit), 1);
 *
 * Process events (stdout lines, stderr lines, exit) fire via __ffiEmit:
 *   __ffiEmit('proc:stdout:<pid>', line)
 *   __ffiEmit('proc:stderr:<pid>', line)
 *   __ffiEmit('proc:exit:<pid>', { code, signal })
 */

import { callHost, callHostJson, hasHost, subscribe } from '../ffi';
import { registerIfttSource, registerIfttAction } from './ifttt/registry';

export interface SpawnOptions {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'pipe' | 'inherit' | 'ignore';
}

export type Pid = number;

/** Spawn a subprocess. Returns pid or 0 on failure. */
export function spawn(opts: SpawnOptions): Pid {
  return callHost<number>('__proc_spawn', 0, JSON.stringify(opts));
}

/** Send SIGTERM (or optional signal name). */
export function kill(pid: Pid, signal: string = 'SIGTERM'): boolean {
  return callHost<boolean>('__proc_kill', false, pid, signal);
}

/** Block until the process exits. Returns exit code. */
export function wait(pid: Pid): number {
  return callHost<number>('__proc_wait', -1, pid);
}

/** Write to the child's stdin (only if spawned with `stdin: 'pipe'`). */
export function stdinWrite(pid: Pid, data: string): boolean {
  return callHost<boolean>('__proc_stdin_write', false, pid, data);
}

/** Close the child's stdin. */
export function stdinClose(pid: Pid): void {
  callHost<void>('__proc_stdin_close', undefined as any, pid);
}

/** Subscribe to a child's stdout line-stream. Returns unsubscribe fn. */
export function onStdout(pid: Pid, fn: (line: string) => void): () => void {
  return subscribe(`proc:stdout:${pid}`, fn);
}

/** Subscribe to a child's stderr line-stream. */
export function onStderr(pid: Pid, fn: (line: string) => void): () => void {
  return subscribe(`proc:stderr:${pid}`, fn);
}

/** Subscribe to a child's exit event. Zig emits this as a JSON-string payload
 *  `{"code":N,"signal":null}` (see framework/v8_bindings_process.zig:365);
 *  the dispatcher hands the payload through verbatim, so we parse it here so
 *  callers get a real object instead of `res.code === undefined`. */
export function onExit(pid: Pid, fn: (res: { code: number; signal: string | null }) => void): () => void {
  return subscribe(`proc:exit:${pid}`, (payload: any) => {
    let parsed: { code: number; signal: string | null } = { code: -1, signal: null };
    if (typeof payload === 'string') {
      try { parsed = JSON.parse(payload); } catch {}
    } else if (payload && typeof payload === 'object') {
      parsed = payload;
    }
    fn(parsed);
  });
}

// ── Environment ────────────────────────────────────────────────────

export function envGet(name: string): string | null {
  return callHost<string | null>('__env_get', null, name);
}

export function envSet(name: string, value: string): void {
  callHost<void>('__env_set', undefined as any, name, value);
}

export function exit(code: number = 0): void {
  callHost<void>('__exit', undefined as any, code);
}

// ── Convenience: one-shot command ──────────────────────────────────

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn, collect all stdout/stderr, wait for exit. For short-running commands.
 * Don't use for long-running processes — use spawn + on* instead.
 */
export function run(cmd: string, args: string[] = []): Promise<RunResult> {
  return new Promise((resolve) => {
    const pid = spawn({ cmd, args });
    if (pid === 0) { resolve({ code: -1, stdout: '', stderr: 'spawn failed' }); return; }
    let stdout = ''; let stderr = '';
    const offOut = onStdout(pid, (l) => { stdout += l + '\n'; });
    const offErr = onStderr(pid, (l) => { stderr += l + '\n'; });
    const offExit = onExit(pid, (r) => {
      offOut(); offErr(); offExit();
      resolve({ code: r.code, stdout, stderr });
    });
  });
}

// ── Async exec (shell one-liners) ─────────────────────────────────
// `execAsync(cmd)` is the async twin of the sync `exec(cmd)` host fn. The
// host runs popen on a detached thread and drains results via __ffiEmit;
// the Promise resolves when the process exits. Use this from any UI handler
// instead of `exec` — sync `exec` blocks the click frame for subprocess
// startup + total runtime (tsc, git, etc. are easily 500ms–2s).
let _execRidCounter = 0;

export interface ExecResult {
  code: number;
  stdout: string;
}

export function execAsync(cmd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    if (!hasHost('__exec_async')) {
      if (hasHost('__exec')) {
        resolve({ code: 0, stdout: String(callHost('__exec', '', cmd) ?? '') });
        return;
      }
      resolve({ code: -1, stdout: '' });
      return;
    }
    const rid = 'x' + (++_execRidCounter) + ':' + Date.now();
    const off = subscribe('exec:' + rid, (payload: any) => {
      off();
      try {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        resolve({ code: parsed.code ?? -1, stdout: parsed.stdout ?? '' });
      } catch {
        resolve({ code: -1, stdout: '' });
      }
    });
    callHost<void>('__exec_async', undefined as any, cmd, rid);
  });
}

// ── Per-process memory + cpu sampling ─────────────────────────────
//
// Backed by `__proc_watch_*` and `__proc_stat` in v8_bindings_process.zig
// (Linux-only — gracefully no-ops elsewhere). The Zig sampler emits two
// raw channels per pid:
//   'proc:ram:<pid>'  { pid, rss, vsize, memTotal, percent }   — fraction 0..1
//   'proc:cpu:<pid>'  { pid, utime, stime, delta, intervalMs }
//
// JS-side derived triggers below add the threshold/idle predicates so
// carts can subscribe with one line.

export interface ProcStat {
  pid: number;
  rss: number;
  vsize: number;
  utime: number;
  stime: number;
  memTotal: number;
  percent: number;
}

/** One-shot snapshot of a process's RSS / cpu ticks. Returns null if the
 *  pid doesn't exist or procfs isn't available. */
export function procStat(pid: Pid): ProcStat | null {
  return callHostJson<ProcStat | null>('__proc_stat', null, pid);
}

const _watchRefs = new Map<number, number>();

/** Arm the engine sampler for `pid`. Refcounted — call the returned fn
 *  once to release. The IFTTT sources below auto-arm/release so carts
 *  rarely call this directly. */
export function watchProcess(pid: Pid, intervalMs: number = 500): () => void {
  const cur = _watchRefs.get(pid) ?? 0;
  _watchRefs.set(pid, cur + 1);
  if (cur === 0) {
    callHost<void>('__proc_watch_add', undefined as any, pid, Math.max(100, intervalMs | 0));
  }
  return () => {
    const n = (_watchRefs.get(pid) ?? 1) - 1;
    if (n <= 0) {
      _watchRefs.delete(pid);
      callHost<void>('__proc_watch_remove', undefined as any, pid);
    } else {
      _watchRefs.set(pid, n);
    }
  };
}

function parsePayload(raw: any): any {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── IFTTT registration ─────────────────────────────────────────────
//
// `proc:stdout:<pid>` / `proc:stderr:<pid>` / `proc:exit:<pid>` are
// reachable via the registry's raw-event fallback today (the channels
// already flow through the unified ffi bus). What we register here are
// the variants that need parsing or side-effecting host calls.

// proc:line:<pid>:<regex> — fires when a stdout line matches the regex.
// Useful for "wait until process announces it's ready", e.g.
// useIFTTT('proc:line:1234:^READY$', 'send:engine-up').
registerIfttSource('proc:line:', {
  match(spec) {
    if (!spec.startsWith('proc:line:')) return null;
    const rest = spec.slice('proc:line:'.length);
    const colon = rest.indexOf(':');
    if (colon < 0) return null;
    const pid = rest.slice(0, colon);
    const pattern = rest.slice(colon + 1);
    let re: RegExp;
    try { re = new RegExp(pattern); }
    catch { console.warn(`[ifttt] bad regex in '${spec}'`); return null; }
    return {
      subscribe(onFire) {
        return subscribe(`proc:stdout:${pid}`, (line: any) => {
          const s = typeof line === 'string' ? line : String(line);
          const m = re.exec(s);
          if (m) onFire({ pid: Number(pid), line: s, match: m });
        });
      },
    };
  },
});

// proc:spawn:<cmd>     — spawn a child with no args. Returns synchronously
//                        on the action side; the resulting pid is dropped
//                        (callers needing it should use the spawn() helper).
// proc:kill:<pid>      — SIGTERM the pid. With $id substitution this is
//                        the watchdog one-liner: useIFTTT(condition, 'proc:kill:$id').
// proc:write:<pid>:<x> — write x to the child's stdin (newline appended
//                        client-side if needed).

registerIfttAction('proc:spawn:', (rest, _payload) => {
  if (!rest) return;
  spawn({ cmd: rest });
});

registerIfttAction('proc:kill:', (rest, _payload) => {
  const pid = Number(rest);
  if (!pid || pid <= 0) return;
  kill(pid, 'SIGTERM');
});

registerIfttAction('proc:write:', (rest, _payload) => {
  const colon = rest.indexOf(':');
  if (colon < 0) return;
  const pid = Number(rest.slice(0, colon));
  const text = rest.slice(colon + 1);
  if (!pid || pid <= 0) return;
  stdinWrite(pid, text);
});

/**
 * Parse a memory threshold token. Returns either a fraction-of-system or an
 * absolute byte count, so 'proc:ram:<pid>:>:<spec>' can express both
 * production-style ceilings (`0.80` = 80% of system RAM) and demo-friendly
 * absolute limits (`50MB`).
 *
 *   '0.85'   → { kind: 'frac',  value: 0.85 }
 *   '5%'     → { kind: 'frac',  value: 0.05 }
 *   '50MB'   → { kind: 'bytes', value: 52428800 }
 *   '2GB'    → { kind: 'bytes', value: 2147483648 }
 *   '512KB'  → { kind: 'bytes', value: 524288 }
 */
function parseRamThreshold(s: string): { kind: 'frac' | 'bytes'; value: number } | null {
  const m = /^(\d+(?:\.\d+)?)(%|B|KB|MB|GB)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || '').toUpperCase();
  switch (unit) {
    case '':   return { kind: 'frac', value: n };
    case '%':  return { kind: 'frac', value: n / 100 };
    case 'B':  return { kind: 'bytes', value: n };
    case 'KB': return { kind: 'bytes', value: n * 1024 };
    case 'MB': return { kind: 'bytes', value: n * 1024 * 1024 };
    case 'GB': return { kind: 'bytes', value: n * 1024 * 1024 * 1024 };
  }
  return null;
}

// proc:ram:<pid>            — fires on every sampled change.
// proc:ram:<pid>:>:<thresh> — fires when sample crosses threshold.
// proc:ram:<pid>:<:<thresh> — opposite direction.
//   <thresh> is a fraction (`0.80`, `5%`) compared against payload.percent
//   OR an absolute byte size (`50MB`, `2GB`) compared against payload.rss.
// Auto-arms the engine watcher on first subscribe; releases on last unsub.
registerIfttSource('proc:ram:', {
  match(spec) {
    const rest = spec.slice('proc:ram:'.length);
    const m = /^(\d+)(?::([<>]):(.+))?$/.exec(rest);
    if (!m) return null;
    const pid = Number(m[1]);
    const op = m[2] as '<' | '>' | undefined;
    const threshold = m[3] != null ? parseRamThreshold(m[3]) : null;
    if (m[3] != null && !threshold) {
      console.warn(`[ifttt] bad proc:ram threshold '${m[3]}' in '${spec}'`);
      return null;
    }
    return {
      subscribe(onFire) {
        const release = watchProcess(pid);
        const off = subscribe(`proc:ram:${pid}`, (raw: any) => {
          const payload = parsePayload(raw);
          if (threshold && op) {
            const sampled = threshold.kind === 'frac'
              ? Number(payload?.percent ?? 0)
              : Number(payload?.rss ?? 0);
            if (op === '>' && !(sampled > threshold.value)) return;
            if (op === '<' && !(sampled < threshold.value)) return;
          }
          onFire(payload);
        });
        return () => { off(); release(); };
      },
    };
  },
});

// proc:cpu:<pid> — raw cpu ticks. Auto-arms the watcher.
registerIfttSource('proc:cpu:', {
  match(spec) {
    const rest = spec.slice('proc:cpu:'.length);
    if (!/^\d+$/.test(rest)) return null;
    const pid = Number(rest);
    return {
      subscribe(onFire) {
        const release = watchProcess(pid);
        const off = subscribe(`proc:cpu:${pid}`, (raw: any) => onFire(parsePayload(raw)));
        return () => { off(); release(); };
      },
    };
  },
});

// proc:idle:<pid>:<ms> — fires when no cpu/stdout/stderr activity for
// `ms` milliseconds. Re-arms on the next activity edge, so a single
// subscription fires once per idle-period transition.
registerIfttSource('proc:idle:', {
  match(spec) {
    const rest = spec.slice('proc:idle:'.length);
    const m = /^(\d+):(\d+)$/.exec(rest);
    if (!m) return null;
    const pid = Number(m[1]);
    const idleMs = Number(m[2]);
    if (!pid || idleMs <= 0) return null;
    return {
      subscribe(onFire) {
        const release = watchProcess(pid);
        let timer: any = null;
        const arm = () => {
          if (timer != null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            onFire({ pid, id: pid, idleMs, at: Date.now() });
          }, idleMs);
        };
        arm();
        const offCpu = subscribe(`proc:cpu:${pid}`, arm);
        const offOut = subscribe(`proc:stdout:${pid}`, arm);
        const offErr = subscribe(`proc:stderr:${pid}`, arm);
        return () => {
          if (timer != null) { clearTimeout(timer); timer = null; }
          offCpu(); offOut(); offErr();
          release();
        };
      },
    };
  },
});
