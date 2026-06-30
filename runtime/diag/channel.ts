// diag/channel.ts — the diagnostics CHANNEL contract.
//
// First-class instrumentation is part of every feature's contract, not a later
// cleanup pass: a system registers its debug channels ONCE here, and from then on
// the settings UI renders them as searchable toggles and the in-app raw console
// reads them — no scattered one-off logs, no rebuild-only probes re-added every
// time something misbehaves.
//
// This is the Phase-0 seam. Workstream B implements the host emit (`__diag_emit`,
// capturing Zig host events too, not just JS) and the z-indexed console overlay
// against this contract. Disabled channels must be a cheap branch; enabled
// high-frequency channels aggregate/throttle/sample before emitting — the
// `costTier` makes the expensive ones obvious.

/** How costly a channel is to leave enabled. The registry surfaces this so a
 *  hot-path channel is never silently always-on. */
export type CostTier =
  | 'cheap'    // safe to leave on during normal authoring (low frequency)
  | 'sampled'  // high-frequency: MUST aggregate/throttle/sample before emitting
  | 'heavy';   // off by default; expensive, opt-in only

/** Where a channel's lines may go. The in-app console is the user-facing path;
 *  file/bus are secondary sinks (implementation detail). */
export type Sink = 'console' | 'file' | 'bus';

export type Severity = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** Everything the registry owns about one debug stream. */
export interface DiagChannel {
  /** Stable channel id (registry key), e.g. 'editor.place'. */
  id: string;
  /** Short human label for the toggle menu. */
  label: string;
  /** What this stream is and when it helps. */
  description: string;
  costTier: CostTier;
  /** Whether it emits by default. Hot channels default off. */
  defaultOn: boolean;
  /** Allowed sinks for this channel. */
  sinks: Sink[];
  /** Optional 1-of-N sample divisor for high-frequency channels (default: 16 for
   *  'sampled', 1 otherwise). Mirrored to the host at registration so host-side
   *  emitters throttle without crossing the bridge. */
  sampleDiv?: number;
}

const REGISTRY = new Map<string, DiagChannel>();
const _enabled = new Map<string, boolean>();

// ── Host-door contract (workstream B implements these in Zig) ───────────────
declare module '../ffi' {
  interface HostCalls {
    /** Emit one diagnostics line. Cheap no-op when the channel is disabled.
     *  fieldsJson is an optional structured payload ('{}' when none). */
    __diag_emit(channelId: string, severity: string, msg: string, fieldsJson: string): void;
    /** Mirror a channel's enabled state to the host so host-side emitters can
     *  branch cheaply without crossing the bridge. */
    __diag_set_enabled(channelId: string, on: number): void;
    /** Mirror a channel's 1-of-N sample divisor to the host so high-frequency
     *  host-side emitters throttle without crossing the bridge. */
    __diag_set_sample(channelId: string, divisor: number): void;
  }
}

/** Default sample divisor: throttle 'sampled' channels, full detail otherwise. */
function defaultSampleDiv(def: DiagChannel): number {
  if (typeof def.sampleDiv === 'number' && def.sampleDiv > 0) return def.sampleDiv;
  return def.costTier === 'sampled' ? 16 : 1;
}

/** Mirror a channel's registration state (enabled + sample divisor) to the host.
 *  defineChannel is the one-time registration point, so host-side emitters can
 *  branch a defaultOn:false channel and throttle a sampled tier from the first
 *  frame — without waiting for a JS toggle. No-ops when the doors aren't wired. */
function mirrorToHost(def: DiagChannel): void {
  const setEnabled = (globalThis as any).__diag_set_enabled;
  if (typeof setEnabled === 'function') setEnabled(def.id, def.defaultOn ? 1 : 0);
  const setSample = (globalThis as any).__diag_set_sample;
  if (typeof setSample === 'function') setSample(def.id, defaultSampleDiv(def));
}

/** A bound emitter for one channel. */
export interface ChannelLogger {
  id: string;
  def: DiagChannel;
  /** True when this channel is currently emitting. Check before building an
   *  expensive message: `if (ch.on) ch.log('info', heavyToString())`. */
  readonly on: boolean;
  log: (severity: Severity, msg: string, fields?: Record<string, unknown>) => void;
  setEnabled: (on: boolean) => void;
}

/** Register a diagnostics channel ONCE (at module load of the owning system).
 *  Re-registering the same id is an error — channels are permanent and singular. */
export function defineChannel(def: DiagChannel): ChannelLogger {
  if (REGISTRY.has(def.id)) {
    throw new Error(`diag: channel '${def.id}' already registered`);
  }
  REGISTRY.set(def.id, def);
  _enabled.set(def.id, def.defaultOn);
  mirrorToHost(def);

  const logger: ChannelLogger = {
    id: def.id,
    def,
    get on() { return _enabled.get(def.id) === true; },
    log(severity, msg, fields) {
      if (_enabled.get(def.id) !== true) return; // disabled = cheap branch
      const emit = (globalThis as any).__diag_emit;
      if (typeof emit === 'function') {
        let fieldsJson = '{}';
        if (fields) { try { fieldsJson = JSON.stringify(fields); } catch { /* keep {} */ } }
        emit(def.id, severity, msg, fieldsJson);
      }
    },
    setEnabled(on) { setChannelEnabled(def.id, on); },
  };
  return logger;
}

/** Toggle a channel (the settings UI calls this); mirrors to the host. */
export function setChannelEnabled(id: string, on: boolean): void {
  if (!REGISTRY.has(id)) return;
  _enabled.set(id, on);
  const fn = (globalThis as any).__diag_set_enabled;
  if (typeof fn === 'function') fn(id, on ? 1 : 0);
}

export function isChannelEnabled(id: string): boolean {
  return _enabled.get(id) === true;
}

/** Every registered channel — the settings menu renders toggles from this. */
export function registeredChannels(): DiagChannel[] {
  return Array.from(REGISTRY.values()).sort((a, b) => a.id.localeCompare(b.id));
}
