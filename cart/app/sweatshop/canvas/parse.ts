// canvas/parse — code → graph reconciler.
//
// Reverse direction of canvas/describe.ts (graph → code). Walks the
// edited TS source and rebuilds the FlowEditor graph:
//   - useIFTTT("trigger", "action") calls become trigger→action edges
//   - // TRIGGER <label> / // ACTION <label> orphan-comments place
//     unwired nodes on the canvas
//
// Identity is preserved by label match: when a parsed spec equals an
// existing FlowNode's label, that node's id + position are reused so
// the canvas doesn't shuffle on every keystroke. Token nodes
// (kind='token' — e.g. the seed Goal node) are kept verbatim because
// they're scenery, not rule wiring.
//
// Parse is best-effort. Empty source → empty graph (minus token
// nodes like Goal which are always carried as scenery). Caller
// debounces so a typing-in-progress keystroke doesn't briefly nuke
// the canvas mid-edit.

import type { FlowNode, FlowEdge } from '../gallery/components/flow-editor/types';

const RE_IFTTT_CALL = /useIFTTT\s*\(\s*(['"`])((?:[^\\]|\\.)*?)\1\s*,\s*(['"`])((?:[^\\]|\\.)*?)\3\s*\)/g;
const RE_ORPHAN     = /^\s*\/\/\s+(TRIGGER|ACTION)\s+(.+?)\s*$/gm;
const RE_DOMAIN     = /^\s*\/\/\s+DOMAIN\s+(.+?)\s*$/gm;

interface IfttCall { trigger: string; action: string }
interface Orphan { kind: 'trigger' | 'action'; label: string }
interface DomainRef { label: string }

function extractCalls(code: string): IfttCall[] {
  const out: IfttCall[] = [];
  RE_IFTTT_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_IFTTT_CALL.exec(code)) !== null) {
    out.push({ trigger: m[2], action: m[4] });
  }
  return out;
}

function extractOrphans(code: string): Orphan[] {
  const out: Orphan[] = [];
  RE_ORPHAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ORPHAN.exec(code)) !== null) {
    out.push({
      kind: m[1] === 'TRIGGER' ? 'trigger' : 'action',
      label: m[2].trim(),
    });
  }
  return out;
}

function extractDomains(code: string): DomainRef[] {
  const out: DomainRef[] = [];
  RE_DOMAIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_DOMAIN.exec(code)) !== null) {
    out.push({ label: m[1].trim() });
  }
  return out;
}

// Position layout for nodes the parser had to create from scratch.
// Triggers stack on the left column, actions on the right column.
// Subsequent rows below the seed scene so we don't overlap the Goal.
function placementFor(kind: 'trigger' | 'action', index: number): { x: number; y: number } {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const xBase = kind === 'trigger' ? -240 : 280;
  const yBase = 80;
  return {
    x: xBase + col * 200 * (kind === 'trigger' ? -1 : 1),
    y: yBase + row * 140,
  };
}

function newNodeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeNode(label: string, kind: 'trigger' | 'action', x: number, y: number): FlowNode {
  return {
    id: newNodeId(kind === 'trigger' ? 'trg' : 'act'),
    label,
    x,
    y,
    data: kind === 'trigger'
      ? { kind: 'trigger', role: 'TRG', state: 'idle', stripe: 'trigger' }
      : { kind: 'action',  role: 'ACT', state: 'idle' },
  };
}

/** Parse `code` and reconcile against `prevNodes` / `prevEdges`.
 *  Always returns a graph: empty source produces an empty graph
 *  (token-only). Caller's debounce smooths typing-in-progress. */
export function parseCodeToGraph(
  code: string,
  prevNodes: FlowNode[],
  prevEdges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const calls = extractCalls(code);
  const orphans = extractOrphans(code);
  const domains = extractDomains(code);

  // Look-up: existing nodes keyed by (kind, label) — we preserve id+x+y
  // when a parsed spec matches.
  const prevByLabel = new Map<string, FlowNode>();
  for (const n of prevNodes) {
    const k = n.data?.kind;
    if (k === 'trigger' || k === 'action') {
      prevByLabel.set(`${k}::${n.label}`, n);
    }
  }
  // Look-up: existing edges keyed by (from-label, to-label).
  const prevEdgeByPair = new Map<string, FlowEdge>();
  for (const e of prevEdges) {
    const f = prevNodes.find((n) => n.id === e.from);
    const t = prevNodes.find((n) => n.id === e.to);
    if (!f || !t) continue;
    prevEdgeByPair.set(`${f.label}::${t.label}`, e);
  }

  const newNodes: FlowNode[] = [];
  const newEdges: FlowEdge[] = [];
  const usedNodeIds = new Set<string>();

  // Tokens (Goal, domain refs) — keep only those still referenced via
  // // DOMAIN <label> comments. Removing the comment removes the node.
  // The seed Goal is preserved by the page-level seed, not here.
  const wantedDomainLabels = new Set(domains.map((d) => d.label));
  for (const n of prevNodes) {
    if ((n.data as any)?.kind === 'token' && wantedDomainLabels.has(n.label)) {
      newNodes.push(n);
      usedNodeIds.add(n.id);
    }
  }
  // Add brand-new domain comments that didn't have a prior token.
  let domainIdx = 0;
  for (const d of domains) {
    const already = newNodes.some((n) => (n.data as any)?.kind === 'token' && n.label === d.label);
    if (already) continue;
    newNodes.push({
      id: `dom_${d.label}_${Math.random().toString(36).slice(2, 8)}`,
      label: d.label,
      x: -360 + (domainIdx % 3) * 160,
      y: -260 - Math.floor(domainIdx / 3) * 120,
      data: { kind: 'token', role: d.label.toUpperCase().slice(0, 3), state: 'idle' },
    });
    domainIdx++;
  }

  // First pass: useIFTTT calls become edges + their endpoints.
  let triggerCount = 0;
  let actionCount = 0;
  const ensureNode = (label: string, kind: 'trigger' | 'action'): FlowNode => {
    const key = `${kind}::${label}`;
    const existing = prevByLabel.get(key);
    if (existing) {
      if (!usedNodeIds.has(existing.id)) {
        newNodes.push(existing);
        usedNodeIds.add(existing.id);
      }
      return existing;
    }
    const idx = kind === 'trigger' ? triggerCount++ : actionCount++;
    const { x, y } = placementFor(kind, idx);
    const created = makeNode(label, kind, x, y);
    newNodes.push(created);
    usedNodeIds.add(created.id);
    return created;
  };

  for (const c of calls) {
    const trg = ensureNode(c.trigger, 'trigger');
    const act = ensureNode(c.action, 'action');
    const pairKey = `${trg.label}::${act.label}`;
    const prev = prevEdgeByPair.get(pairKey);
    newEdges.push(prev ?? {
      id: newNodeId('edge'),
      from: trg.id,
      to: act.id,
      fromPort: 'out',
      toPort: 'in',
    });
  }

  // Second pass: orphan comments — placed but unwired.
  for (const o of orphans) {
    ensureNode(o.label, o.kind);
  }

  return { nodes: newNodes, edges: newEdges };
}
