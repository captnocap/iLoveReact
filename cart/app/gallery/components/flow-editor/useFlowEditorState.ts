import { useCallback, useRef, useState } from 'react';
import type { FlowEdge, FlowNode, FlowPendingWire, FlowPortKind, FlowPortSide } from './types';

// Headless state machine for the FlowEditor. Embed this hook directly when
// you want to drive your own UI; the <FlowEditor /> component is just a
// view layer over this. Either pass controlled `nodes`/`edges` props (with
// the matching setters) or rely on the seeded internal state.

export type UseFlowEditorStateOptions = {
  initialNodes?: FlowNode[];
  initialEdges?: FlowEdge[];
  // Used to lay out new nodes added via `addNode()`. Spiral search around
  // the origin in (padX × padY) cells until an empty slot is found.
  spawnPadX?: number;
  spawnPadY?: number;
};

export type FlowEditorState = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  pending: FlowPendingWire;
  selectedId: string | null;
  setNodes: (next: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => void;
  setEdges: (next: FlowEdge[] | ((prev: FlowEdge[]) => FlowEdge[])) => void;
  setPending: (next: FlowPendingWire) => void;
  setSelectedId: (next: string | null) => void;
  addNode: (label?: string, data?: unknown) => string;
  moveNode: (id: string, x: number, y: number) => void;
  removeNode: (id: string) => void;
  tryAddEdge: (fromId: string, toId: string, fromPort?: string, toPort?: string, kind?: FlowPortKind) => void;
  onPortClick: (nodeId: string, side: FlowPortSide, portId?: string) => void;
  onTileClick: (id: string) => void;
  clearAll: () => void;
};

export function useFlowEditorState(options: UseFlowEditorStateOptions = {}): FlowEditorState {
  const padX = options.spawnPadX ?? 280;
  const padY = options.spawnPadY ?? 190;
  const [nodes, setNodes] = useState<FlowNode[]>(options.initialNodes ?? []);
  const [edges, setEdges] = useState<FlowEdge[]>(options.initialEdges ?? []);
  const [pending, setPending] = useState<FlowPendingWire>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const pendingRef = useRef<FlowPendingWire>(pending); pendingRef.current = pending;
  const counterRef = useRef((options.initialNodes ?? []).length);
  const edgeCounterRef = useRef(0);

  const addNode = useCallback((label?: string, data?: unknown): string => {
    counterRef.current += 1;
    const id = `n${counterRef.current}_${Date.now().toString(36)}`;
    const existing = nodesRef.current;
    const overlaps = (x: number, y: number) =>
      existing.some((n) => Math.abs(n.x - x) < padX && Math.abs(n.y - y) < padY);
    let x = 0;
    let y = 0;
    if (existing.length > 0) {
      let placed = false;
      for (let r = 1; r < 30 && !placed; r += 1) {
        for (let dy = -r; dy <= r && !placed; dy += 1) {
          for (let dx = -r; dx <= r && !placed; dx += 1) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const cx = dx * padX;
            const cy = dy * padY;
            if (!overlaps(cx, cy)) { x = cx; y = cy; placed = true; }
          }
        }
      }
    }
    const node: FlowNode = { id, label: label ?? `Step ${counterRef.current}`, x, y, data };
    setNodes((prev) => [...prev, node]);
    return id;
  }, [padX, padY]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const tryAddEdge = useCallback((fromId: string, toId: string, fromPort?: string, toPort?: string, kind?: FlowPortKind) => {
    if (fromId === toId) return;
    // Enforce rule shape at draw time: a rule needs a trigger (or
    // domain token) pointing at an action. If the user drew it
    // backwards (action → trigger), auto-flip. Anything else
    // (trigger↔trigger, action↔action, unlabeled kinds) is rejected
    // silently — the canvas should never show a connection that the
    // code/prose pane can't honor.
    const live = nodesRef.current;
    const from = live.find((n) => n.id === fromId);
    const to = live.find((n) => n.id === toId);
    if (!from || !to) return;
    const fk = (from.data as any)?.kind ?? '';
    const tk = (to.data as any)?.kind ?? '';
    const isTrigger = (k: string) => k === 'trigger' || k === 'token';
    const isAction = (k: string) => k === 'action';
    let resolvedFromId = fromId;
    let resolvedToId = toId;
    let resolvedFromPort = fromPort;
    let resolvedToPort = toPort;
    if (isTrigger(fk) && isAction(tk)) {
      // canonical shape — keep as-is
    } else if (isAction(fk) && isTrigger(tk)) {
      // backwards — flip orientation so it lands as trigger → action
      resolvedFromId = toId;
      resolvedToId = fromId;
      resolvedFromPort = toPort;
      resolvedToPort = fromPort;
    } else {
      return;
    }
    edgeCounterRef.current += 1;
    const id = `e${edgeCounterRef.current}_${Date.now().toString(36)}`;
    setEdges((prev) =>
      prev.some((e) => (
        e.from === resolvedFromId
        && e.to === resolvedToId
        && (e.fromPort ?? '') === (resolvedFromPort ?? '')
        && (e.toPort ?? '') === (resolvedToPort ?? '')
      ))
        ? prev
        : [...prev, { id, from: resolvedFromId, to: resolvedToId, fromPort: resolvedFromPort, toPort: resolvedToPort, kind }],
    );
  }, []);

  const onPortClick = useCallback((nodeId: string, side: FlowPortSide, portId?: string) => {
    const cur = pendingRef.current;
    if (!cur) { setPending({ nodeId, side, portId }); return; }
    if (cur.nodeId === nodeId) { setPending(null); return; }
    if (cur.side === side) { setPending({ nodeId, side, portId }); return; }
    if (cur.side === 'out') tryAddEdge(cur.nodeId, nodeId, cur.portId, portId);
    else tryAddEdge(nodeId, cur.nodeId, portId, cur.portId);
    setPending(null);
  }, [tryAddEdge]);

  const onTileClick = useCallback((id: string) => {
    const cur = pendingRef.current;
    if (cur) {
      if (cur.nodeId !== id) {
        if (cur.side === 'out') tryAddEdge(cur.nodeId, id, cur.portId);
        else tryAddEdge(id, cur.nodeId, undefined, cur.portId);
      }
      setPending(null);
      return;
    }
    setSelectedId(id);
  }, [tryAddEdge]);

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    setPending((cur) => (cur?.nodeId === id ? null : cur));
  }, []);

  const clearAll = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setPending(null);
    setSelectedId(null);
  }, []);

  return {
    nodes,
    edges,
    pending,
    selectedId,
    setNodes,
    setEdges,
    setPending,
    setSelectedId,
    addNode,
    moveNode,
    removeNode,
    tryAddEdge,
    onPortClick,
    onTileClick,
    clearAll,
  };
}
