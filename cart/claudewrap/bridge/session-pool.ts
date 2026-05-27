// SessionPool — one claude process per chat thread, keyed by claude's
// session id (sid). This is what kills the "god session": instead of one
// immortal claude shared by every thread, each open thread holds its own
// live process.
//
// We ASSIGN the sid (a valid UUID) via `claude --session-id <uuid>` and
// resume with `claude --resume <uuid>`. Assigning it — rather than
// discovering it after the fact — is deliberate: claude doesn't write its
// <sid>.jsonl transcript until it receives a prompt, so a capture-first
// design deadlocked (wait for a file that never appears until we paste,
// but don't paste until we capture). Knowing the sid up front means we
// know the transcript path immediately and can write the per-sid bridge
// directive before pasting. It's still claude's real session id — we just
// hand it the UUID to use.
//
// State split:
//   - sid       → DURABLE. The thread persists it; it's what --resume
//                 reopens after the process (or the whole bridge) dies.
//   - { pipe }  → EPHEMERAL. A handle to the running process. A resumed
//                 thread gets a new pipe, same sid.
//
// The framework execs the launcher as a bare path (no args), so each
// spawn writes its own launcher script (see launcher.ts).

import { writeSpawnLauncher, type BridgeModel } from './launcher';

export interface ProcEntry {
  sid: string;
  pipe: string;
  model: BridgeModel;
  lastUsed: number;
}

const POOL_PUMP_MS = 100;
// How long to let a freshly-spawned claude boot its TUI before the first
// paste. The bridge handler ALSO re-pastes if the prompt doesn't land, so
// this is a hint, not a hard requirement.
const BOOT_DELAY_MS = 2500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function uuidv4(): string {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

function vtermOpen(pipe: string, rows: number, cols: number, launcher: string): void {
  (globalThis as any).__vterm_open?.(pipe, rows, cols, launcher);
}
function vtermPoll(pipe: string): void {
  (globalThis as any).__vterm_poll?.(pipe);
}
function vtermClose(pipe: string): void {
  (globalThis as any).__vterm_close?.(pipe);
}

function ensureSupported(model: BridgeModel): void {
  if (model === 'firecracker-claude') {
    throw new Error(
      'firecracker-claude is not wired for the headless bridge yet: claude-ss ' +
      'controls the in-VM claude (can\'t pass --session-id) and the VM transcript ' +
      'is not synced to the host, so the bridge can\'t observe it. Use disk-claude.',
    );
  }
}

export class SessionPool {
  private procs = new Map<string, ProcEntry>(); // keyed by sid
  private pumpId: any = null;

  constructor(private opts: { port: number; rows: number; cols: number }) {}

  /** Drain every open pipe. With nothing painting these sessions no
   *  tickDrain runs, so the kernel PTY buffer would fill and block claude
   *  once it produces ~64KB of unread output. */
  start(): void {
    if (this.pumpId != null) return;
    this.pumpId = setInterval(() => {
      for (const p of this.procs.values()) vtermPoll(p.pipe);
    }, POOL_PUMP_MS);
  }

  stop(): void {
    if (this.pumpId != null) clearInterval(this.pumpId);
    this.pumpId = null;
    for (const p of this.procs.values()) vtermClose(p.pipe);
    this.procs.clear();
  }

  get(sid: string): ProcEntry | undefined {
    const e = this.procs.get(sid);
    if (e) e.lastUsed = Date.now();
    return e;
  }

  list(): ProcEntry[] {
    return [...this.procs.values()];
  }

  /** Fresh thread: assign a UUID and spawn `claude --session-id <uuid>`. */
  async spawnFresh(model: BridgeModel): Promise<ProcEntry> {
    ensureSupported(model);
    const sid = uuidv4();
    return this.spawn(sid, model, false);
  }

  /** Resume a known thread. Warm process → reuse. Cold → respawn with
   *  `claude --resume <sid>` (reattaches to the same transcript). */
  async resume(sid: string, model: BridgeModel): Promise<ProcEntry> {
    ensureSupported(model);
    const existing = this.procs.get(sid);
    if (existing) { existing.lastUsed = Date.now(); return existing; }
    return this.spawn(sid, model, true);
  }

  private async spawn(sid: string, model: BridgeModel, resume: boolean): Promise<ProcEntry> {
    const pipe = `bridge:${sid}`;
    const launcher = writeSpawnLauncher({ model, port: this.opts.port, sessionId: sid, resume });
    vtermOpen(pipe, this.opts.rows, this.opts.cols, launcher);
    // Register BEFORE the boot wait so a failure anywhere downstream still
    // leaves the process tracked (and thus closable) — no orphan leak.
    const entry: ProcEntry = { sid, pipe, model, lastUsed: Date.now() };
    this.procs.set(sid, entry);
    await sleep(BOOT_DELAY_MS);
    return entry;
  }

  evictIdle(maxIdleMs: number): void {
    const now = Date.now();
    for (const [sid, e] of this.procs) {
      if (now - e.lastUsed > maxIdleMs) {
        vtermClose(e.pipe);
        this.procs.delete(sid);
      }
    }
  }

  close(sid: string): void {
    const e = this.procs.get(sid);
    if (!e) return;
    vtermClose(e.pipe);
    this.procs.delete(sid);
  }
}
