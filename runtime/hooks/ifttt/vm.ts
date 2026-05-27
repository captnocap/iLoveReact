// ifttt-vm — registers the 'vm:' trigger source against the IFTTT
// registry. Lets a host-side useIFTTT subscribe to events emitted from
// inside a running Firecracker VM:
//
//   useIFTTT('vm:vmrun_001:event:tool-call.dispatched', 'flag-pathology:pat_X')
//   useIFTTT('vm:vmrun_001:rule:smoke.fired', (e) => console.log(e))
//   useIFTTT('vm:vmrun_001:verb:verb_build_dev.completed', 'queue-job:job_promote')
//
// Importing this module wires the 'vm:' prefix into the registry. The
// per-VM bridges (one openVsock per running VM, plus namespaceMirror)
// are managed by `attachVm(vmid)` / `detachVm(vmid)` — typically
// driven by the cart/app DB layer when CompositionRun rows transition
// to 'stage2-executing' / 'completed'.
//
// Spec format: `vm:<vmid>:<remainder>`. The remainder is what the guest
// emitted (e.g. 'event:tool-call.dispatched'). Once attachVm runs for
// `<vmid>`, namespaceMirror lifts every guest emit onto
// `vm:<vmid>:<remainder>` on the host bus, and a useIFTTT spec subscribe
// to that exact channel just works via the registry's fallback path.
//
// We register the source so the registry knows about the prefix even
// before any VM is attached; the source's match() returns a
// subscription that listens on the namespaced bus channel directly.

import { subscribe } from '../../ffi';
import { registerIfttSource, type IfttSubscription } from './registry';
import {
  openVsock,
  namespaceMirror,
  namespaceForward,
  type VsockTransport,
} from '../vsock';

const PREFIX = 'vm:';

// Active per-VM bridges. attachVm fills this; detachVm tears it down.
type Bridge = {
  vmid: string;
  transport: VsockTransport;
  unsubscribers: Array<() => void>;
};
const _bridges = new Map<string, Bridge>();

// ── Source registration ──────────────────────────────────────────

registerIfttSource(PREFIX, {
  match(spec): IfttSubscription | null {
    if (!spec.startsWith(PREFIX)) return null;
    // 'vm:<vmid>:<remainder>' — the channel a useIFTTT subscriber
    // should listen on is exactly the spec string. attachVm has
    // wired namespaceMirror so guest emits land here.
    return {
      subscribe(onFire) {
        return subscribe(spec, (payload: any) => onFire(payload));
      },
    };
  },
});

// ── Per-VM bridge lifecycle ──────────────────────────────────────

/** Open a vsock to the given running VM and start mirroring its
 *  events onto the host bus under the 'vm:<vmid>:' namespace. Idempotent
 *  — a second call for the same vmid is a no-op. */
export function attachVm(vmid: string): boolean {
  if (_bridges.has(vmid)) return true;
  const transport = openVsock({ kind: 'host', vmid });
  if (!transport.live) {
    // No transport — not necessarily an error. The framework may not
    // have wired __vsock_open yet (pre-firecracker dev). Caller can
    // still attach optimistically; real wiring lands later.
    transport.close();
    return false;
  }
  const unsubs: Array<() => void> = [];
  const hostPrefix = `${PREFIX}${vmid}:`;
  // Guest → host: every guest emit lifted onto vm:<vmid>:<remainder>
  unsubs.push(namespaceMirror(transport, hostPrefix));
  // Host → guest: any host emit on vm:<vmid>:<remainder> forwarded into
  // the guest as <remainder>. Lets the host's rule engine kick the VM
  // (e.g. 'invoke-verb:foo' or 'halt-run') by emitting on the
  // namespaced channel.
  unsubs.push(namespaceForward(transport, hostPrefix));
  _bridges.set(vmid, { vmid, transport, unsubscribers: unsubs });
  return true;
}

/** Close the bridge for a VM. Call when the CompositionRun ends or
 *  the VM is destroyed. */
export function detachVm(vmid: string): void {
  const b = _bridges.get(vmid);
  if (!b) return;
  for (const u of b.unsubscribers) {
    try { u(); } catch { /* ignore */ }
  }
  try { b.transport.close(); } catch { /* ignore */ }
  _bridges.delete(vmid);
}

/** Inspect: which VMs currently have an active bridge. */
export function listAttachedVms(): string[] {
  return Array.from(_bridges.keys()).sort();
}
