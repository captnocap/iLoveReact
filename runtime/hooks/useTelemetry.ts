/**
 * useTelemetry — single hook for the framework's perf/observability surface.
 *
 * One discriminated union over every telemetry host fn the runtime registers.
 * The hook only calls the host fn matching `spec.kind`; nothing else fires.
 *
 * Default behavior is one read on mount. Pass `pollMs` to opt into polling —
 * no kind polls itself behind your back. If a hook with `pollMs: 0` (the
 * default) returns a stale value, that's by design: ask for what you need.
 *
 * Importing this file is what gates the `__tel_*` / `getFps` / `getLayoutUs`
 * / `getPaintUs` / `getTickUs` / `getProcessesJson` / `getThreadsJson` V8
 * bindings into the binary (see sdk/dependency-registry.json telemetry
 * trigger, scripts/ship-metafile-gate.js). A cart that never imports
 * useTelemetry ships zero telemetry host fns.
 *
 * Usage:
 *   // Scalar reads (one number).
 *   const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 1000 });
 *
 *   // JSON snapshots (object/null).
 *   const { data: nodes } = useTelemetry({ kind: 'nodes' });
 *
 *   // Per-node queries.
 *   const { data: bbox } = useTelemetry({ kind: 'nodeBoxModel', nodeId: 42 });
 */

import { useEffect, useState } from 'react';
import { callHost } from '../ffi';
import { useLatest } from './useLatest';

// ── Spec types ─────────────────────────────────────────────────────

interface BaseSpec {
  /** Poll interval in ms. 0 (default) = read once on mount. */
  pollMs?: number;
}

/** Scalar kinds — host fn returns a single number. */
export type ScalarKind =
  | 'fps'         // getFps()         frames per second
  | 'layoutUs'    // getLayoutUs()    layout pass time, microseconds
  | 'paintUs'     // getPaintUs()     paint pass time, microseconds
  | 'nodeCount';  // __tel_node_count() total Node count in tree

export interface ScalarTelemetrySpec extends BaseSpec {
  kind: ScalarKind;
}

/** JSON kinds — host fn returns a structured snapshot or null. */
export type JsonKind =
  | 'frame'       // __tel_frame()       per-frame timing record
  | 'gpu'         // __tel_gpu()         GPU pipeline stats
  | 'nodes'       // __tel_nodes()       node tree summary
  | 'history'     // __tel_history()     ring of recent frames
  | 'input'       // __tel_input()       input pipeline counters
  | 'layout'      // __tel_layout()      layout-engine internals
  | 'net'         // __tel_net()         network/transport counters
  | 'system'      // __tel_system()      OS-level resource snapshot
  | 'canvas'      // __tel_canvas()      Canvas/Graph render stats
  | 'processes'   // getProcessesJson()  system process listing
  | 'threads';    // getThreadsJson()    per-thread CPU listing

export interface JsonTelemetrySpec extends BaseSpec {
  kind: JsonKind;
}

/** Per-node kinds — host fn takes a numeric node id. */
export type NodeKind =
  | 'node'         // __tel_node(id)          full node info
  | 'nodeBoxModel' // __tel_node_box_model(id) layout box for one node
  | 'nodeStyle';   // __tel_node_style(id)     resolved style for one node

export interface NodeTelemetrySpec extends BaseSpec {
  kind: NodeKind;
  nodeId: number;
}

export type TelemetrySpec = ScalarTelemetrySpec | JsonTelemetrySpec | NodeTelemetrySpec;

// ── Result types ───────────────────────────────────────────────────

export interface ScalarTelemetryResult {
  value: number;
}

export interface JsonTelemetryResult<T = any> {
  data: T | null;
}

export type TelemetryResult<S extends TelemetrySpec> =
  S extends ScalarTelemetrySpec ? ScalarTelemetryResult :
  S extends JsonTelemetrySpec ? JsonTelemetryResult :
  S extends NodeTelemetrySpec ? JsonTelemetryResult :
  never;

// ── Host fn name dispatch ──────────────────────────────────────────
// Mapping kind → registered host fn name. Only the entry matching the
// caller's kind ever runs; the others stay as table data.

const SCALAR_HOST_FN: Record<ScalarKind, string> = {
  fps: 'getFps',
  layoutUs: 'getLayoutUs',
  paintUs: 'getPaintUs',
  nodeCount: '__tel_node_count',
};

const JSON_HOST_FN: Record<JsonKind, string> = {
  frame: '__tel_frame',
  gpu: '__tel_gpu',
  nodes: '__tel_nodes',
  history: '__tel_history',
  input: '__tel_input',
  layout: '__tel_layout',
  net: '__tel_net',
  system: '__tel_system',
  canvas: '__tel_canvas',
  processes: 'getProcessesJson',
  threads: 'getThreadsJson',
};

const NODE_HOST_FN: Record<NodeKind, string> = {
  node: '__tel_node',
  nodeBoxModel: '__tel_node_box_model',
  nodeStyle: '__tel_node_style',
};

function isScalarKind(k: string): k is ScalarKind {
  return k in SCALAR_HOST_FN;
}
function isJsonKind(k: string): k is JsonKind {
  return k in JSON_HOST_FN;
}
function isNodeKind(k: string): k is NodeKind {
  return k in NODE_HOST_FN;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useTelemetry(spec: ScalarTelemetrySpec): ScalarTelemetryResult;
export function useTelemetry<T = any>(spec: JsonTelemetrySpec): JsonTelemetryResult<T>;
export function useTelemetry<T = any>(spec: NodeTelemetrySpec): JsonTelemetryResult<T>;
export function useTelemetry(spec: TelemetrySpec): ScalarTelemetryResult | JsonTelemetryResult {
  const [scalar, setScalar] = useState<number>(0);
  const [json, setJson] = useState<any>(null);
  const specRef = useLatest(spec);

  // Stable poll-key — restart the effect only when kind / nodeId / pollMs change.
  const nodeId = (spec as NodeTelemetrySpec).nodeId ?? 0;
  const pollMs = spec.pollMs ?? 0;
  const key = `${spec.kind}:${nodeId}:${pollMs}`;

  useEffect(() => {
    let cancelled = false;
    const s = specRef.current;

    const read = () => {
      if (cancelled) return;
      if (isScalarKind(s.kind)) {
        const fn = SCALAR_HOST_FN[s.kind];
        const v = callHost<number>(fn, 0);
        setScalar(typeof v === 'number' ? v : 0);
      } else if (isJsonKind(s.kind)) {
        const fn = JSON_HOST_FN[s.kind];
        const v = callHost<any>(fn, null);
        setJson(v ?? null);
      } else if (isNodeKind(s.kind)) {
        const fn = NODE_HOST_FN[s.kind];
        const id = (s as NodeTelemetrySpec).nodeId;
        const v = callHost<any>(fn, null, id);
        setJson(v ?? null);
      }
    };

    read();
    if (pollMs > 0) {
      const handle = setInterval(read, pollMs);
      return () => { cancelled = true; clearInterval(handle); };
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (isScalarKind(spec.kind)) return { value: scalar };
  return { data: json };
}
