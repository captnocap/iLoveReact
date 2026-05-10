import { Box, Canvas, Graph } from '@reactjit/runtime/primitives';
import { FLOW_EDITOR_DEFAULT_THEME, type FlowEditorTheme } from './flowEditorTheme';
import { bezierFor } from './bezier';
import { FlowTile, getEdgeColor, getEdgeDasharray, getFlowNodePorts, getFlowNodeSize } from './FlowTile';
import type { FlowEdge, FlowNode, FlowPort, FlowPortKind, FlowPortSide, FlowTileBodyRenderer } from './types';
import { useFlowEditorState, type UseFlowEditorStateOptions } from './useFlowEditorState';

// Public, embeddable flow editor.
//
// Two ways to use it:
//
//   1. Uncontrolled (simplest)
//      <FlowEditor initialNodes={...} initialEdges={...} />
//      The editor manages its own state. Node/edge changes can be observed
//      via onChange callbacks if you want to mirror them out.
//
//   2. Controlled
//      Drive `nodes` + `edges` from your own state, then pass `onNodesChange`
//      and `onEdgesChange` to receive updates. The component will not write
//      to its internal state when you supply both.
//
// Theme is a single prop with sensible defaults; pass a partial override to
// re-skin without forking the component.
export type FlowEditorProps = {
  // Controlled
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  onNodesChange?: (next: FlowNode[]) => void;
  onEdgesChange?: (next: FlowEdge[]) => void;

  // Uncontrolled seeds (ignored if `nodes`/`edges` are passed)
  initialNodes?: FlowNode[];
  initialEdges?: FlowEdge[];

  // Visuals
  theme?: Partial<FlowEditorTheme>;
  renderTileBody?: FlowTileBodyRenderer;

  // Layout knobs
  spawnPadX?: number;
  spawnPadY?: number;

  // Behavior
  allowDelete?: boolean; // false hides the × button on tiles
};

export function FlowEditor(props: FlowEditorProps) {
  const theme: FlowEditorTheme = { ...FLOW_EDITOR_DEFAULT_THEME, ...(props.theme ?? {}) };
  const stateOptions: UseFlowEditorStateOptions = {
    initialNodes: props.initialNodes,
    initialEdges: props.initialEdges,
    spawnPadX: props.spawnPadX,
    spawnPadY: props.spawnPadY,
  };
  const state = useFlowEditorState(stateOptions);

  // Controlled mode: prefer external nodes/edges if supplied. We still use
  // the headless state machine for pending/selected/handlers; the data lists
  // come from props.
  const controlledNodes = props.nodes;
  const controlledEdges = props.edges;
  const nodes = controlledNodes ?? state.nodes;
  const edges = controlledEdges ?? state.edges;

  const propagateNodes = (next: FlowNode[]) => {
    if (props.onNodesChange) props.onNodesChange(next);
    if (controlledNodes == null) state.setNodes(next);
  };
  const propagateEdges = (next: FlowEdge[]) => {
    if (props.onEdgesChange) props.onEdgesChange(next);
    if (controlledEdges == null) state.setEdges(next);
  };

  const moveNode = (id: string, x: number, y: number) => {
    propagateNodes(nodes.map((n) => (n.id === id ? { ...n, x, y } : n)));
  };
  const removeNode = (id: string) => {
    propagateNodes(nodes.filter((n) => n.id !== id));
    propagateEdges(edges.filter((e) => e.from !== id && e.to !== id));
    if (state.selectedId === id) state.setSelectedId(null);
    if (state.pending?.nodeId === id) state.setPending(null);
  };

  const findNodePort = (nodeId: string, side: FlowPortSide, portId?: string, kind?: FlowPortKind): FlowPort | undefined => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return undefined;
    const ports = getFlowNodePorts(node, theme).filter((port) => port.side === side);
    if (portId) {
      const byId = ports.find((port) => port.id === portId);
      if (byId) return byId;
    }
    if (kind) {
      const byKind = ports.find((port) => port.kind === kind);
      if (byKind) return byKind;
    }
    return ports[0];
  };

  const tryAddEdge = (fromId: string, toId: string, fromPort?: string, toPort?: string, kind?: FlowPortKind) => {
    if (fromId === toId) return;
    if (edges.some((e) => (
      e.from === fromId
      && e.to === toId
      && (e.fromPort ?? '') === (fromPort ?? '')
      && (e.toPort ?? '') === (toPort ?? '')
    ))) return;
    const sourcePort = findNodePort(fromId, 'out', fromPort, kind);
    const id = `e${Date.now().toString(36)}`;
    propagateEdges([...edges, { id, from: fromId, to: toId, fromPort, toPort, kind: kind ?? sourcePort?.kind ?? 'flow' }]);
  };

  const onPortClick = (nodeId: string, side: FlowPortSide, portId?: string) => {
    const cur = state.pending;
    if (!cur) { state.setPending({ nodeId, side, portId }); return; }
    if (cur.nodeId === nodeId) { state.setPending(null); return; }
    if (cur.side === side) { state.setPending({ nodeId, side, portId }); return; }
    if (cur.side === 'out') tryAddEdge(cur.nodeId, nodeId, cur.portId, portId);
    else tryAddEdge(nodeId, cur.nodeId, portId, cur.portId);
    state.setPending(null);
  };
  const onTileClick = (id: string) => {
    const cur = state.pending;
    if (cur) {
      if (cur.nodeId !== id) {
        if (cur.side === 'out') tryAddEdge(cur.nodeId, id, cur.portId);
        else tryAddEdge(id, cur.nodeId, undefined, cur.portId);
      }
      state.setPending(null);
      return;
    }
    state.setSelectedId(id);
  };

  const byId = new Map<string, FlowNode>();
  for (const n of nodes) byId.set(n.id, n);

  const edgePaths: any[] = [];
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const aSize = getFlowNodeSize(a, theme);
    const bSize = getFlowNodeSize(b, theme);
    const sourcePort = findNodePort(e.from, 'out', e.fromPort, e.kind);
    const targetPort = findNodePort(e.to, 'in', e.toPort);
    const kind = e.kind ?? sourcePort?.kind ?? 'flow';
    const x1 = a.x + aSize.width / 2;
    const y1 = a.y - aSize.height / 2 + (sourcePort?.offsetY ?? aSize.height / 2);
    const x2 = b.x - bSize.width / 2;
    const y2 = b.y - bSize.height / 2 + (targetPort?.offsetY ?? bSize.height / 2);
    const bz = bezierFor(x1, y1, x2, y2);
    // Highlight edges whose endpoint kinds don't form a rule
    // (trigger → action). New edges are validated at draw time in
    // useFlowEditorState.tryAddEdge, so this only paints stale data
    // that pre-dates that gate — but it still gives the user a clear
    // visual cue that a connection isn't usable as a rule.
    const fk = (a.data as any)?.kind ?? '';
    const bk = (b.data as any)?.kind ?? '';
    const isRuleShape =
      (fk === 'trigger' || fk === 'token') && bk === 'action';
    const color = isRuleShape
      ? getEdgeColor(kind, theme)
      : 'theme:warn';
    const dash = isRuleShape
      ? getEdgeDasharray(kind)
      : '4 3';
    edgePaths.push(
      <Canvas.Path
        key={`p-${e.id}`}
        d={bz.d}
        stroke={color}
        strokeWidth={theme.hairlineWidth ?? theme.edgeStrokeWidth}
        strokeDasharray={dash}
        flowSpeed={1}
        fill="none"
      />,
    );
  }

  const tiles = nodes.map((node) => (
    <FlowTile
      key={node.id}
      node={node}
      theme={theme}
      selected={state.selectedId === node.id}
      pendingIn={state.pending?.nodeId === node.id && state.pending.side === 'in'}
      pendingOut={state.pending?.nodeId === node.id && state.pending.side === 'out'}
      pendingPortId={state.pending?.nodeId === node.id ? state.pending.portId : undefined}
      onMove={moveNode}
      onPortClick={onPortClick}
      onTileClick={onTileClick}
      onRemove={props.allowDelete === false ? undefined : removeNode}
      renderBody={props.renderTileBody}
    />
  ));

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: theme.bg }}>
      <Canvas
        style={{ width: '100%', height: '100%', backgroundColor: theme.bg }}
        gridStep={theme.gridStep}
        gridStroke={1}
        gridColor={theme.gridColor}
        gridMajorColor={theme.gridMajorColor}
        gridMajorEvery={theme.gridMajorEvery}
      >
        <Graph
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
          viewX={0}
          viewY={0}
          viewZoom={1}
        >
          {edgePaths}
        </Graph>
        {tiles}
      </Canvas>
    </Box>
  );
}

// Re-exports for convenience.
export type { FlowEdge, FlowNode, FlowNodeVisualData, FlowPort, FlowPortKind, FlowTileBodyRenderer } from './types';
export type { FlowEditorTheme } from './flowEditorTheme';
export { FLOW_EDITOR_DEFAULT_THEME } from './flowEditorTheme';
export { useFlowEditorState } from './useFlowEditorState';
export { bezierFor, arrowHeadPath } from './bezier';
