// canvas/compile — turn the FlowEditor graph into live IFTTT bindings.
//
// Each edge from a trigger-kind node to an action-kind node compiles
// to one binding: subscribe to `trigger.label` (an IFTTT spec string)
// and dispatch `action.label` on every fire. Spec strings come straight
// from the palette items — every IFTTT prefix registered in the
// runtime/hooks/* surface produces a draggable node whose label is
// the prefix; wiring two of them lights a real rule.
//
// Compilation is structural — it doesn't hit the DB. Persistence
// (writing the canvas to a `composition` row, listening for the row
// to change, recompiling cross-process) lives in a follow-up.
//
// applyBindings returns a single teardown that detaches every
// subscription. The page calls it on graph change, then applies fresh
// bindings.

import { resolveTrigger, dispatchAction } from '@reactjit/runtime/hooks/ifttt-registry';
import type { FlowNode, FlowEdge } from '../../gallery/components/flow-editor/types';

export type Binding = {
  edgeId: string;
  triggerSpec: string;
  actionSpec: string;
};

export interface CompileResult {
  bindings: Binding[];
  warnings: string[];
}

/** Walk the graph and return one binding per trigger→action edge.
 *  Edges that don't connect a trigger to an action are skipped (with
 *  a warning so the canvas can surface them later). */
export function compileGraph(nodes: FlowNode[], edges: FlowEdge[]): CompileResult {
  const byId = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const bindings: Binding[] = [];
  const warnings: string[] = [];

  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) {
      warnings.push(`edge ${e.id}: dangling endpoint (${e.from} → ${e.to})`);
      continue;
    }
    const fromKind = from.data?.kind;
    const toKind = to.data?.kind;
    if (fromKind !== 'trigger') continue;          // not a rule edge — likely a domain wire
    if (toKind !== 'action') continue;
    if (!from.label || !to.label) {
      warnings.push(`edge ${e.id}: missing label on ${!from.label ? 'trigger' : 'action'} node`);
      continue;
    }
    bindings.push({ edgeId: e.id, triggerSpec: from.label, actionSpec: to.label });
  }

  return { bindings, warnings };
}

export interface ApplyResult {
  /** Tears down every subscription. Idempotent. */
  dispose: () => void;
  /** How many bindings actually attached (a spec that doesn't resolve
   *  is skipped + warned). */
  attached: number;
  /** Per-binding warnings emitted during apply. */
  warnings: string[];
}

/** Subscribe each binding through the IFTTT registry and dispatch
 *  the named action on each fire. Returns a single teardown. */
export function applyBindings(bindings: Binding[]): ApplyResult {
  const teardowns: Array<() => void> = [];
  const warnings: string[] = [];
  let attached = 0;

  for (const b of bindings) {
    const sub = resolveTrigger(b.triggerSpec);
    if (!sub) {
      warnings.push(`trigger spec did not resolve: '${b.triggerSpec}' (edge ${b.edgeId})`);
      continue;
    }
    const off = sub.subscribe((payload) => {
      try {
        const ok = dispatchAction(b.actionSpec, payload);
        if (!ok) console.warn(`[sweatshop] action did not dispatch: '${b.actionSpec}' (edge ${b.edgeId})`);
      } catch (e: any) {
        console.warn(`[sweatshop] action threw on '${b.actionSpec}':`, e?.message ?? e);
      }
    });
    teardowns.push(off);
    attached++;
  }

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const t of teardowns) {
      try { t(); } catch { /* ignore */ }
    }
  };

  return { dispose, attached, warnings };
}
