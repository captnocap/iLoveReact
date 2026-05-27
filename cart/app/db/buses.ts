// Maps DB writes to IFTTT bus channels.
//
// useCRUD calls `notifyRowChange(collection, row)` after each successful
// create/update. For supervisor entities, we forward to the canonical
// IFTTT channel (`event:append`, `rule:fired`, etc.). For everything
// else, no-op — the supervisor namespace is the only one currently
// hooked into useIFTTT, but more entities can be added as the rule
// surface grows.
//
// Importing this module also imports `runtime/hooks/ifttt/supervisor`,
// which performs the trigger-source / action-runner registrations on
// load. So `import 'cart/app/db'` is enough to get the whole supervisor
// IFTTT surface live.

import {
  emitEventAppend,
  emitRuleFired,
  emitVerbLifecycle,
  emitWorkerLifecycle,
  emitRunLifecycle,
  emitSessionLifecycle,
  emitClaimLifecycle,
} from '@reactjit/runtime/hooks/ifttt/supervisor';

type Notifier = (row: any) => void;

const NOTIFIERS: Record<string, Notifier> = {
  // event row → 'event:append' channel
  'event': (row) => emitEventAppend(row),
  // rule-firing row → 'rule:fired' channel
  'rule-firing': (row) => emitRuleFired(row),
  // verb-invocation row → 'verb:lifecycle'
  'verb-invocation': (row) => emitVerbLifecycle(row),
  // worker row updates → 'worker:lifecycle'
  'worker': (row) => emitWorkerLifecycle({ workerId: row.id, lifecycle: row.lifecycle, ...row }),
  // composition-run row updates → 'run:lifecycle'
  'composition-run': (row) => emitRunLifecycle({ runId: row.id, status: row.status, ...row }),
  // worker-session row updates → 'session:lifecycle'. The vm-bridges
  // module subscribes here to attach / detach the vsock mirror when a
  // session running in a Firecracker worker comes up or shuts down.
  'worker-session': (row) => emitSessionLifecycle({ sessionId: row.id, status: row.status, vmid: row.vmid, ...row }),
  // claim row updates → 'claim:lifecycle'. The supervisor surface
  // subscribes to render the open-claims panel; rules can subscribe
  // for behavior on transitions (e.g. block forward action while
  // status='unverified').
  'claim': (row) => emitClaimLifecycle({ claimId: row.id, status: row.status, ...row }),
};

/** Called from useCRUD after a successful create / update. The row is
 *  the validated data the caller wrote. */
export function notifyRowChange(collection: string, row: any): void {
  const fn = NOTIFIERS[collection];
  if (!fn) return;
  try {
    fn(row);
  } catch (e) {
    // Notifier failure must never block the actual write. Swallow + log.
    console.warn(`[db] notifyRowChange ${collection} failed:`, e);
  }
}
