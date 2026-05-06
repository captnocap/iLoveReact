// vsock — bus transport extension for the host↔guest boundary.
//
// The principle: there's only one substrate. The reactjit bus
// (subscribe/emit in runtime/ffi.ts) is the same on both sides of the
// VM boundary; vsock is a *transport* that mirrors selected channels
// across it. Code on either side uses the same hooks, the same DSL,
// the same useIFTTT — bus events just travel further.
//
// ── Two roles ────────────────────────────────────────────────────
//
// Inside a VM (the worker shell cart):
//   const t = openVsock({ kind: 'guest' });
//   mirrorChannels(t, ['event:append', 'rule:fired', 'verb:lifecycle', …]);
// — the cart's local emits propagate to the host. Incoming envelopes
// from the host re-emit locally (so the host can issue 'invoke-verb:'
// or 'halt-run' and the in-VM cart reacts).
//
// On the host (cart/app, sweatshop):
//   const t = openVsock({ kind: 'host', vmid: 'vmrun_001' });
//   namespaceMirror(t, 'vm:vmrun_001:');
// — events arriving from that VM get re-emitted with a 'vm:<vmid>:'
// prefix, so a useIFTTT subscriber on
// 'vm:vmrun_001:event:tool-call.dispatched' fires.
//
// ── Stub when host bindings missing ──────────────────────────────
// `__vsock_open` / `__vsock_send` / `__vsock_close` are framework-side
// host functions; until they're wired, openVsock returns a NullTransport
// that warns once and otherwise no-ops. Keeps cart-time imports safe
// during pre-firecracker development.

import { subscribe, subscribeAll, emit } from '../ffi';
import { callHost, hasHost } from '../ffi';

export type VsockKind = 'guest' | 'host';

export type VsockEnvelope = { channel: string; payload?: any };

export interface VsockTransport {
  /** Send an envelope across the boundary. Returns false if the
   *  transport is disconnected or stub. */
  send(channel: string, payload?: any): boolean;
  /** Subscribe to incoming envelopes. */
  onEnvelope(fn: (env: VsockEnvelope) => void): () => void;
  /** Tear down the connection. Idempotent. */
  close(): void;
  /** True for real transports; false for the null stub. */
  readonly live: boolean;
}

// ── Null transport (when host bindings missing) ──────────────────

let nullWarned = false;
class NullTransport implements VsockTransport {
  readonly live = false;
  send(channel: string, _payload?: any): boolean {
    if (!nullWarned) {
      nullWarned = true;
      console.warn(`[vsock] no transport — drop send '${channel}' (and future sends; warning suppressed)`);
    }
    return false;
  }
  onEnvelope(_fn: (env: VsockEnvelope) => void): () => void { return () => {}; }
  close(): void { /* no-op */ }
}

// ── Host-fn transport ────────────────────────────────────────────

class HostFnTransport implements VsockTransport {
  readonly live = true;
  private id: number;
  private listeners = new Set<(env: VsockEnvelope) => void>();
  private unsubBus: () => void;
  private closed = false;

  constructor(id: number) {
    this.id = id;
    // Host (Zig) emits envelopes on `vsock:<id>:envelope`. Each payload
    // is the parsed envelope (already a JS object).
    this.unsubBus = subscribe(`vsock:${id}:envelope`, (env: any) => {
      if (this.closed) return;
      if (!env || typeof env !== 'object' || typeof env.channel !== 'string') return;
      for (const fn of Array.from(this.listeners)) {
        try { fn(env as VsockEnvelope); }
        catch (e: any) { console.error('[vsock] envelope listener error:', e?.message || e); }
      }
    });
  }

  send(channel: string, payload?: any): boolean {
    if (this.closed) return false;
    return callHost<boolean>('__vsock_send', false, this.id, JSON.stringify({ channel, payload }));
  }

  onEnvelope(fn: (env: VsockEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    callHost<void>('__vsock_close', undefined, this.id);
    this.unsubBus();
    this.listeners.clear();
  }
}

// ── Public open ──────────────────────────────────────────────────

export interface OpenVsockOpts {
  /** 'guest' connects from inside a VM to the host. 'host' connects
   *  from the host to a specific running VM. */
  kind: VsockKind;
  /** Required when kind='host'. Identifies which running VM. */
  vmid?: string;
}

/** Open a vsock transport. Returns a NullTransport when the framework
 *  host functions aren't registered — caller code stays valid; it just
 *  doesn't ferry events. */
export function openVsock(opts: OpenVsockOpts): VsockTransport {
  if (!hasHost('__vsock_open')) return new NullTransport();
  const id = callHost<number>('__vsock_open', 0, JSON.stringify(opts));
  if (!id) return new NullTransport();
  return new HostFnTransport(id);
}

// ── Channel mirroring ────────────────────────────────────────────

/** Mirror a single bus channel across the transport. Local emits get
 *  forwarded as envelopes. Received envelopes for this channel re-emit
 *  locally. */
export function mirrorChannel(t: VsockTransport, channel: string): () => void {
  const unsubLocal = subscribe(channel, (payload) => { t.send(channel, payload); });
  const unsubRemote = t.onEnvelope((env) => {
    if (env.channel === channel) emit(channel, env.payload);
  });
  return () => { unsubLocal(); unsubRemote(); };
}

/** Mirror an explicit list of channels. Convenience over mirrorChannel
 *  for the supervisor-namespace defaults. */
export function mirrorChannels(t: VsockTransport, channels: string[]): () => void {
  const unsubs = channels.map((c) => mirrorChannel(t, c));
  return () => { for (const u of unsubs) u(); };
}

/** Mirror by prefix. Local emits whose channel starts with `prefix`
 *  get forwarded; received envelopes whose channel starts with `prefix`
 *  re-emit locally. Uses subscribeAll, so bus traffic outside the
 *  prefix is untouched. */
export function mirrorPrefix(t: VsockTransport, prefix: string): () => void {
  const unsubLocal = subscribeAll((channel, payload) => {
    if (channel.startsWith(prefix)) t.send(channel, payload);
  });
  const unsubRemote = t.onEnvelope((env) => {
    if (typeof env.channel === 'string' && env.channel.startsWith(prefix)) {
      emit(env.channel, env.payload);
    }
  });
  return () => { unsubLocal(); unsubRemote(); };
}

/** Host-side helper: mirror everything coming from a guest, but
 *  prepend a namespace prefix on the local re-emit. So a guest emitting
 *  'event:tool-call.dispatched' becomes 'vm:<vmid>:event:tool-call.dispatched'
 *  on the host, where the rule engine's vm: source picks it up. */
export function namespaceMirror(t: VsockTransport, hostPrefix: string): () => void {
  return t.onEnvelope((env) => {
    if (typeof env.channel === 'string') {
      emit(`${hostPrefix}${env.channel}`, env.payload);
    }
  });
}

/** Host-side helper: forward host emits matching the prefix INTO the
 *  guest, stripping the prefix on the way. So a host emit on
 *  'vm:<vmid>:invoke-verb:foo' arrives in-guest as 'invoke-verb:foo'.
 *  Inverse of namespaceMirror. */
export function namespaceForward(t: VsockTransport, hostPrefix: string): () => void {
  return subscribeAll((channel, payload) => {
    if (channel.startsWith(hostPrefix)) {
      const guestChannel = channel.slice(hostPrefix.length);
      t.send(guestChannel, payload);
    }
  });
}

// ── Default supervisor channel set ───────────────────────────────
// The minimum set the worker shell cart and host bridge agree on by
// default. Callers can override by calling mirrorChannels/mirrorPrefix
// directly with a custom list.

export const DEFAULT_GUEST_OUTGOING = [
  'event:append',
  'rule:fired',
  'verb:lifecycle',
  'worker:lifecycle',
  'run:lifecycle',
];

export const DEFAULT_GUEST_INCOMING = [
  'supervisor:halt-run',
  'supervisor:invoke-verb',
  'supervisor:inject-message',
  'supervisor:flag-pathology',
  'supervisor:set-variable',
  'supervisor:modify-assembly',
  'supervisor:commit-state',
];
