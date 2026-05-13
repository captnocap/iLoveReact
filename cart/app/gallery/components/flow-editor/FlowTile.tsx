import { Box, Canvas, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import type { FlowEditorTheme } from './flowEditorTheme';
import type {
  FlowCase,
  FlowKvPair,
  FlowLane,
  FlowNode,
  FlowNodeKind,
  FlowNodeState,
  FlowNodeVisualData,
  FlowPort,
  FlowPortKind,
  FlowPortSide,
  FlowStep,
  FlowTileBodyRenderer,
} from './types';

export type FlowTileProps = {
  node: FlowNode;
  theme: FlowEditorTheme;
  selected: boolean;
  pendingIn: boolean;
  pendingOut: boolean;
  pendingPortId?: string;
  onMove: (id: string, x: number, y: number) => void;
  onPortClick: (id: string, side: FlowPortSide, portId?: string) => void;
  onTileClick: (id: string) => void;
  onRemove?: (id: string) => void;
  renderBody?: FlowTileBodyRenderer;
};

type FlowNodeSize = {
  width: number;
  height: number;
};

const HEADER_H = 32;
const FOOT_H = 24;
const BODY_PAD_X = 10;

function asVisualData(data: unknown): FlowNodeVisualData {
  if (!data || typeof data !== 'object') return {};
  return data as FlowNodeVisualData;
}

function nodeKind(node: FlowNode): FlowNodeKind {
  return asVisualData(node.data).kind ?? 'action';
}

export function getFlowNodeVisual(node: FlowNode): FlowNodeVisualData {
  return asVisualData(node.data);
}

export function getFlowNodeSize(node: FlowNode, theme: FlowEditorTheme): FlowNodeSize {
  const minW = theme.tileWidth;
  const minH = theme.tileHeight;
  switch (nodeKind(node)) {
    case 'sequence':
      return { width: Math.max(minW, 252), height: Math.max(minH, 194) };
    case 'if':
      return { width: Math.max(minW, 248), height: Math.max(minH, 174) };
    case 'switch':
      return { width: Math.max(minW, 264), height: Math.max(minH, 206) };
    case 'lanes':
      return { width: Math.max(minW, 290), height: Math.max(minH, 194) };
    case 'loop':
      return { width: Math.max(minW, 242), height: Math.max(minH, 176) };
    case 'token':
      return { width: Math.max(minW, 286), height: Math.max(minH, 216) };
    case 'trigger':
    case 'end':
    case 'action':
    default:
      return { width: Math.max(minW, 226), height: Math.max(minH, 148) };
  }
}

export function getPortColor(kind: FlowPortKind | undefined, theme: FlowEditorTheme): string {
  switch (kind) {
    case 'data':
      return theme.dataColor;
    case 'tool':
      return theme.toolColor;
    case 'cond-true':
      return theme.condTrueColor;
    case 'cond-false':
      return theme.condFalseColor;
    case 'error':
      return theme.errorColor;
    case 'ctx':
      return theme.ctxColor;
    case 'loop':
      return theme.loopColor;
    case 'flow':
    default:
      return theme.flowColor;
  }
}

export function getEdgeColor(kind: FlowPortKind | undefined, theme: FlowEditorTheme): string {
  return getPortColor(kind ?? 'flow', theme);
}

export function getEdgeDasharray(kind: FlowPortKind | undefined): string | undefined {
  if (kind === 'tool') return '5,4';
  if (kind === 'error') return '2,4';
  return undefined;
}

function withOffsets(ports: FlowPort[], size: FlowNodeSize): FlowPort[] {
  const left = ports.filter((port) => port.side === 'in');
  const right = ports.filter((port) => port.side === 'out');
  const spread = (list: FlowPort[]) => {
    if (list.length === 0) return [];
    if (list.every((port) => typeof port.offsetY === 'number')) return list;
    const start = Math.max(HEADER_H + 22, size.height / 2 - (list.length - 1) * 14);
    return list.map((port, index) => ({
      ...port,
      offsetY: port.offsetY ?? start + index * 28,
    }));
  };
  return [...spread(left), ...spread(right)];
}

export function getFlowNodePorts(node: FlowNode, theme: FlowEditorTheme): FlowPort[] {
  const data = getFlowNodeVisual(node);
  const size = getFlowNodeSize(node, theme);
  if (data.ports && data.ports.length > 0) return withOffsets(data.ports, size);
  const center = size.height / 2;
  const lower = size.height - FOOT_H - 10;
  const kind = data.kind ?? 'action';
  switch (kind) {
    case 'if':
      return withOffsets([
        { id: 'in', side: 'in', kind: 'flow', label: 'flow in', offsetY: center },
        { id: 'true', side: 'out', kind: 'cond-true', label: 'true branch', offsetY: center - 24 },
        { id: 'false', side: 'out', kind: 'cond-false', label: 'false branch', offsetY: center + 8 },
        { id: 'err', side: 'out', kind: 'error', label: 'exception path', offsetY: lower },
      ], size);
    case 'switch': {
      const cases = data.cases ?? [];
      const outPorts = cases.length > 0
        ? cases.map((item, index) => ({
          id: item.id,
          side: 'out' as const,
          kind: 'cond-true' as const,
          label: `case ${index + 1}: ${item.label}`,
          offsetY: HEADER_H + 48 + index * 28,
        }))
        : [
          { id: 'case-1', side: 'out' as const, kind: 'cond-true' as const, label: 'case 1', offsetY: center - 18 },
          { id: 'case-2', side: 'out' as const, kind: 'cond-false' as const, label: 'case 2', offsetY: center + 18 },
        ];
      return withOffsets([
        { id: 'in', side: 'in', kind: 'flow', label: 'flow in', offsetY: center },
        ...outPorts,
        { id: 'err', side: 'out', kind: 'error', label: 'exception path', offsetY: lower },
      ], size);
    }
    case 'loop':
      return withOffsets([
        { id: 'in', side: 'in', kind: 'flow', label: 'flow in', offsetY: center },
        { id: 'item', side: 'out', kind: 'loop', label: 'per-item loop tail', offsetY: center - 28 },
        { id: 'done', side: 'out', kind: 'flow', label: 'loop done', offsetY: center + 2 },
        { id: 'err', side: 'out', kind: 'error', label: 'exception path', offsetY: lower },
      ], size);
    case 'token':
      return withOffsets([
        { id: 'prompt', side: 'in', kind: 'data', label: 'prompt input' },
        { id: 'ctx', side: 'in', kind: 'ctx', label: 'context injection' },
        { id: 'tools', side: 'in', kind: 'tool', label: 'tool binding' },
        { id: 'tokens', side: 'out', kind: 'data', label: 'token stream' },
        { id: 'output', side: 'out', kind: 'flow', label: 'model output' },
        { id: 'err', side: 'out', kind: 'error', label: 'exception path' },
      ], size);
    case 'trigger':
      return withOffsets([
        { id: 'out', side: 'out', kind: 'flow', label: 'trigger flow out', offsetY: center },
        { id: 'ctx', side: 'out', kind: 'ctx', label: 'trigger context', offsetY: lower },
      ], size);
    case 'end':
      return withOffsets([
        { id: 'in', side: 'in', kind: 'flow', label: 'flow in', offsetY: center - 12 },
        { id: 'err', side: 'in', kind: 'error', label: 'error in', offsetY: center + 20 },
      ], size);
    case 'sequence':
    case 'lanes':
    case 'action':
    default:
      return withOffsets([
        { id: 'in', side: 'in', kind: 'flow', label: 'flow in', offsetY: center },
        { id: 'out', side: 'out', kind: 'flow', label: 'flow out', offsetY: center - 12 },
        { id: 'err', side: 'out', kind: 'error', label: 'exception path', offsetY: lower },
      ], size);
  }
}

function roleDefaults(kind: FlowNodeKind): { role: string; glyph: string; roleKind: FlowPortKind } {
  switch (kind) {
    case 'sequence':
      return { role: 'SEQ', glyph: '≡', roleKind: 'flow' };
    case 'if':
      return { role: 'IF', glyph: '?', roleKind: 'cond-true' };
    case 'switch':
      return { role: 'SW', glyph: '#', roleKind: 'cond-false' };
    case 'lanes':
      return { role: 'LANE', glyph: '║', roleKind: 'ctx' };
    case 'loop':
      return { role: 'LOOP', glyph: '↺', roleKind: 'loop' };
    case 'token':
      return { role: 'AI', glyph: '✦', roleKind: 'tool' };
    case 'trigger':
      return { role: 'TRG', glyph: '◉', roleKind: 'ctx' };
    case 'end':
      return { role: 'END', glyph: '■', roleKind: 'error' };
    case 'action':
    default:
      return { role: 'ACT', glyph: '·', roleKind: 'flow' };
  }
}

function stateColor(state: FlowNodeState | 'done' | 'skip' | undefined, theme: FlowEditorTheme): string {
  switch (state) {
    case 'run':
      return theme.stateRun;
    case 'ok':
    case 'done':
      return theme.stateOk;
    case 'err':
      return theme.stateErr;
    case 'wait':
      return theme.stateWait;
    case 'skip':
    case 'idle':
    default:
      return theme.stateIdle;
  }
}

function StatePip({ state, theme }: { state?: FlowNodeState | 'done' | 'skip'; theme: FlowEditorTheme }) {
  const color = stateColor(state, theme);
  const active = state === 'run' || state === 'err';
  return (
    <Box
      style={{
        width: active ? 12 : 9,
        height: active ? 12 : 9,
        borderRadius: active ? 6 : 5,
        borderWidth: active ? 1 : 0,
        borderColor: color,
        borderDashOn: active ? 2 : undefined,
        borderDashOff: active ? 2 : undefined,
        borderDashWidth: active ? 1 : undefined,
        borderFlowSpeed: state === 'run' ? 24 : state === 'err' ? 36 : undefined,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </Box>
  );
}

function RenderKvRows({ rows, theme }: { rows: FlowKvPair[]; theme: FlowEditorTheme }) {
  return (
    <Box style={{ gap: 4 }}>
      {rows.map((row) => (
        <Row
          key={`${row.key}:${row.value}`}
          style={{
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
            borderColor: theme.frameColor,
            paddingBottom: 2,
          }}
        >
          <Text fontSize={8} color={theme.textDim} style={{ fontFamily: 'monospace' }}>
            {row.key}
          </Text>
          <Text fontSize={9} color={theme.textBright} numberOfLines={1} style={{ fontWeight: 'bold' }}>
            {row.value}
          </Text>
        </Row>
      ))}
    </Box>
  );
}

function RenderCodePreview({ lines, theme }: { lines: string[]; theme: FlowEditorTheme }) {
  return (
    <Box
      style={{
        gap: 2,
        borderWidth: 1,
        borderColor: theme.frameColor,
        borderRadius: 4,
        backgroundColor: theme.codeBg,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
      }}
    >
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} fontSize={8} color={index === 0 ? theme.accentHot : theme.textBright} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function RenderSteps({ steps, theme }: { steps: FlowStep[]; theme: FlowEditorTheme }) {
  return (
    <Box style={{ gap: 4 }}>
      {steps.map((step, index) => {
        const running = step.state === 'run';
        return (
          <Row
            key={step.id}
            style={{
              gap: 6,
              alignItems: 'center',
              paddingLeft: 7,
              paddingRight: 7,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: running ? theme.stateRun : theme.frameColor,
              backgroundColor: running ? theme.rowBg : theme.bodyBg,
            }}
          >
            <Text fontSize={9} color={running ? theme.stateRun : theme.textDim} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
              {step.glyph ?? `${index + 1}`}
            </Text>
            <StatePip state={step.state} theme={theme} />
            <Text fontSize={9} color={theme.textBright} numberOfLines={1} style={{ flexGrow: 1, flexBasis: 0 }}>
              {step.label}
            </Text>
            <Text fontSize={8} color={theme.textDim} style={{ fontFamily: 'monospace' }}>
              {step.metric ?? '--'}
            </Text>
          </Row>
        );
      })}
    </Box>
  );
}

function RenderCases({ cases, activeCaseId, theme }: { cases: FlowCase[]; activeCaseId?: string; theme: FlowEditorTheme }) {
  return (
    <Box style={{ gap: 4 }}>
      {cases.map((item, index) => {
        const active = item.active || item.id === activeCaseId;
        return (
          <Row
            key={item.id}
            style={{
              gap: 8,
              alignItems: 'center',
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: active ? theme.condTrueColor : theme.frameColor,
              backgroundColor: active ? theme.rowBg : theme.bodyBg,
            }}
          >
            <Text fontSize={8} color={active ? theme.condTrueColor : theme.textDim} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
              {index + 1}
            </Text>
            <Text fontSize={9} color={theme.textBright} numberOfLines={1} style={{ flexGrow: 1, flexBasis: 0 }}>
              {item.label}
            </Text>
            <Text fontSize={8} color={active ? theme.stateRun : theme.textDim} style={{ fontFamily: 'monospace' }}>
              {item.hitRate ?? item.value ?? '--'}
            </Text>
          </Row>
        );
      })}
    </Box>
  );
}

function RenderLanes({ lanes, theme }: { lanes: FlowLane[]; theme: FlowEditorTheme }) {
  return (
    <Row style={{ gap: 6, alignItems: 'stretch', flexGrow: 1 }}>
      {lanes.map((lane) => (
        <Box
          key={lane.id}
          style={{
            flexGrow: 1,
            flexBasis: 0,
            borderWidth: 1,
            borderColor: stateColor(lane.state, theme),
            borderRadius: 5,
            backgroundColor: theme.codeBg,
            paddingLeft: 7,
            paddingRight: 7,
            paddingTop: 6,
            paddingBottom: 6,
            gap: 4,
          }}
        >
          <Row style={{ gap: 5, alignItems: 'center' }}>
            <StatePip state={lane.state} theme={theme} />
            <Text fontSize={9} color={theme.textBright} numberOfLines={1} style={{ fontWeight: 'bold' }}>
              {lane.label}
            </Text>
          </Row>
          {(lane.lines ?? []).map((line) => (
            <Text key={line} fontSize={8} color={theme.textDim} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
              {line}
            </Text>
          ))}
          <Text fontSize={8} color={stateColor(lane.state, theme)} style={{ fontFamily: 'monospace' }}>
            {lane.metric ?? '--'}
          </Text>
        </Box>
      ))}
    </Row>
  );
}

function RenderLoopBar({ data, theme }: { data: FlowNodeVisualData; theme: FlowEditorTheme }) {
  const loop = data.loop ?? { current: 0, total: 1, label: 'iteration' };
  const ratio = loop.total > 0 ? Math.max(0, Math.min(1, loop.current / loop.total)) : 0;
  return (
    <Box style={{ gap: 5 }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text fontSize={8} color={theme.textDim} style={{ fontFamily: 'monospace' }}>
          {loop.label ?? 'iteration'}
        </Text>
        <Text fontSize={8} color={theme.loopColor} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
          {loop.current}/{loop.total}
        </Text>
      </Row>
      <Box
        style={{
          height: 12,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.loopColor,
          backgroundColor: theme.codeBg,
          overflow: 'hidden',
        }}
      >
        <Box
          style={{
            width: `${Math.round(ratio * 100)}%`,
            height: '100%',
            backgroundColor: theme.loopColor,
            borderDashOn: 3,
            borderDashOff: 3,
            borderDashWidth: 1,
          }}
        />
      </Box>
    </Box>
  );
}

function RenderTokenChip({ node, theme }: { node: FlowNode; theme: FlowEditorTheme }) {
  const ports = getFlowNodePorts(node, theme);
  const left = ports.filter((port) => port.side === 'in');
  const right = ports.filter((port) => port.side === 'out');
  return (
    <Row style={{ gap: 8, alignItems: 'stretch', flexGrow: 1 }}>
      <Box style={{ width: 58, gap: 5 }}>
        {left.map((port) => (
          <Row key={port.id} style={{ gap: 4, alignItems: 'center' }}>
            <Box style={{ width: 10, height: 3, backgroundColor: getPortColor(port.kind, theme) }} />
            <Text fontSize={8} color={theme.textDim} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
              {port.id}
            </Text>
          </Row>
        ))}
      </Box>
      <Box
        style={{
          flexGrow: 1,
          flexBasis: 0,
          borderWidth: 1,
          borderColor: theme.accentHot,
          borderRadius: 6,
          backgroundColor: theme.codeBg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <Text fontSize={18} color={theme.accentHot} style={{ fontWeight: 'bold' }}>LLM</Text>
        <Text fontSize={8} color={theme.textDim} style={{ fontFamily: 'monospace' }}>prompt + ctx + tools</Text>
        <Text fontSize={8} color={theme.textBright} style={{ fontFamily: 'monospace' }}>tokens → output</Text>
      </Box>
      <Box style={{ width: 58, gap: 5, alignItems: 'flex-end' }}>
        {right.map((port) => (
          <Row key={port.id} style={{ gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Text fontSize={8} color={theme.textDim} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
              {port.id}
            </Text>
            <Box style={{ width: 10, height: 3, backgroundColor: getPortColor(port.kind, theme) }} />
          </Row>
        ))}
      </Box>
    </Row>
  );
}

function RenderDefaultBody({ node, theme }: { node: FlowNode; theme: FlowEditorTheme }) {
  const data = getFlowNodeVisual(node);
  const kind = data.kind ?? 'action';
  if (kind === 'sequence') {
    return <RenderSteps steps={data.steps ?? []} theme={theme} />;
  }
  if (kind === 'if') {
    return (
      <Box style={{ gap: 8 }}>
        <RenderCodePreview lines={data.code ?? ['return input.ok && budget > cost']} theme={theme} />
        <Row style={{ gap: 6 }}>
          <Box style={{ flexGrow: 1, flexBasis: 0, borderWidth: 1, borderColor: theme.condTrueColor, borderRadius: 4, paddingTop: 4, paddingBottom: 4, alignItems: 'center' }}>
            <Text fontSize={8} color={theme.condTrueColor} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>TRUE {data.hitRate?.true ?? '0%'}</Text>
          </Box>
          <Box style={{ flexGrow: 1, flexBasis: 0, borderWidth: 1, borderColor: theme.condFalseColor, borderRadius: 4, paddingTop: 4, paddingBottom: 4, alignItems: 'center' }}>
            <Text fontSize={8} color={theme.condFalseColor} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>FALSE {data.hitRate?.false ?? '0%'}</Text>
          </Box>
        </Row>
      </Box>
    );
  }
  if (kind === 'switch') {
    return <RenderCases cases={data.cases ?? []} activeCaseId={data.activeCaseId} theme={theme} />;
  }
  if (kind === 'lanes') {
    return <RenderLanes lanes={data.lanes ?? []} theme={theme} />;
  }
  if (kind === 'loop') {
    return (
      <Box style={{ gap: 8 }}>
        <RenderKvRows rows={data.kv ?? []} theme={theme} />
        <RenderLoopBar data={data} theme={theme} />
      </Box>
    );
  }
  if (kind === 'token') {
    return <RenderTokenChip node={node} theme={theme} />;
  }
  return (
    <RenderKvRows
      rows={data.kv ?? [
        { key: 'method', value: 'GET' },
        { key: 'url', value: '/endpoint' },
        { key: 'auth', value: 'none' },
        { key: 'timeout', value: '30s' },
      ]}
      theme={theme}
    />
  );
}

function MetaStrip({ data, theme }: { data: FlowNodeVisualData; theme: FlowEditorTheme }) {
  const meta = data.meta ?? {};
  const parts = [
    `runs ${meta.runs ?? '0'}`,
    `${meta.ms ?? '--'}ms`,
    `$${meta.cost ?? '--'}`,
    meta.model ?? '--',
    meta.version ?? 'v0',
    meta.lastRun ?? 'never',
  ];
  return (
    <Row
      style={{
        height: FOOT_H,
        gap: 7,
        alignItems: 'center',
        paddingLeft: BODY_PAD_X,
        paddingRight: BODY_PAD_X,
        borderTopWidth: 1,
        borderColor: theme.frameColor,
        backgroundColor: theme.footBg,
      }}
    >
      {parts.map((part, index) => (
        <Text key={`${index}:${part}`} fontSize={7} color={theme.textDim} numberOfLines={1} style={{ fontFamily: 'monospace' }}>
          {part}
        </Text>
      ))}
    </Row>
  );
}

function CornerMarks({ color, width, height }: { color: string; width: number; height: number }) {
  const mark = { position: 'absolute' as const, backgroundColor: color };
  return (
    <>
      <Box style={{ ...mark, left: 0, top: 0, width: 11, height: 1 }} />
      <Box style={{ ...mark, left: 0, top: 0, width: 1, height: 11 }} />
      <Box style={{ ...mark, left: width - 11, top: 0, width: 11, height: 1 }} />
      <Box style={{ ...mark, left: width - 1, top: 0, width: 1, height: 11 }} />
      <Box style={{ ...mark, left: 0, top: height - 1, width: 11, height: 1 }} />
      <Box style={{ ...mark, left: 0, top: height - 11, width: 1, height: 11 }} />
      <Box style={{ ...mark, left: width - 11, top: height - 1, width: 11, height: 1 }} />
      <Box style={{ ...mark, left: width - 1, top: height - 11, width: 1, height: 11 }} />
    </>
  );
}

function PortPin({
  node,
  port,
  theme,
  width,
  pending,
  onPortClick,
}: {
  node: FlowNode;
  port: FlowPort;
  theme: FlowEditorTheme;
  width: number;
  pending: boolean;
  onPortClick: (id: string, side: FlowPortSide, portId?: string) => void;
}) {
  const color = pending ? theme.tilePending : getPortColor(port.kind, theme);
  const top = Math.max(HEADER_H + 4, (port.offsetY ?? 0) - 5);
  const left = port.side === 'in' ? -4 : width - 6;
  return (
    <Pressable
      tooltip={port.label}
      hoverable
      onPress={() => onPortClick(node.id, port.side, port.id)}
      style={{
        position: 'absolute',
        left,
        top,
        width: 10,
        height: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 2,
        borderWidth: pending ? 1 : 0,
        borderColor: color,
      }}
    >
      <Box
        style={{
          width: 8,
          height: 3,
          backgroundColor: color,
        }}
      />
    </Pressable>
  );
}

export function FlowTile({
  node,
  theme,
  selected,
  pendingIn,
  pendingOut,
  pendingPortId,
  onMove,
  onPortClick,
  onTileClick,
  onRemove,
  renderBody,
}: FlowTileProps) {
  const size = getFlowNodeSize(node, theme);
  const data = getFlowNodeVisual(node);
  const kind = data.kind ?? 'action';
  const role = roleDefaults(kind);
  const ports = getFlowNodePorts(node, theme);
  const anyPending = pendingIn || pendingOut;
  const roleKind = data.roleKind ?? role.roleKind;
  const roleColor = kind === 'token' ? theme.accentHot : getPortColor(roleKind, theme);
  const stripe = data.stripe ?? (kind === 'trigger' ? 'trigger' : kind === 'end' ? 'end' : undefined);
  const roleWord = data.role ?? role.role;
  const quickActions = data.quickActions ?? ['⏸', '⋯'];
  const frameColor = selected ? theme.selectedRing : anyPending ? theme.tilePending : theme.frameColor;
  return (
    <Canvas.Node
      gx={node.x}
      gy={node.y}
      gw={size.width}
      gh={size.height}
      onMove={(e: any) => onMove(node.id, e.gx, e.gy)}
    >
      <Box
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          borderRadius: theme.radiusMd,
          backgroundColor: selected ? theme.tileBgSelected : theme.tileBg,
          borderWidth: 1,
          borderColor: frameColor,
          borderDashOn: selected ? 5 : undefined,
          borderDashOff: selected ? 4 : undefined,
          borderDashWidth: selected ? 1 : undefined,
          overflow: 'hidden',
        }}
      >
        <Pressable
          onPress={() => onTileClick(node.id)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
          }}
        >
          <Row
            style={{
              height: HEADER_H,
              alignItems: 'center',
              gap: 7,
              paddingLeft: BODY_PAD_X,
              paddingRight: onRemove ? 22 : BODY_PAD_X,
              borderBottomWidth: 1,
              borderColor: theme.frameColor,
              backgroundColor: theme.headerBg,
            }}
          >
            <Row
              style={{
                height: 18,
                paddingLeft: 5,
                paddingRight: 6,
                borderRadius: 4,
                backgroundColor: theme.roleBg,
                borderWidth: 1,
                borderColor: roleColor,
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: roleColor }} />
              <Text fontSize={8} color={theme.roleText} style={{ fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 0.5 }}>
                {roleWord}
              </Text>
            </Row>
            <Text fontSize={9} color={theme.textBright} numberOfLines={1} style={{ flexGrow: 1, flexBasis: 0, fontWeight: 'bold' }}>
              {node.label}
            </Text>
            <StatePip state={data.state ?? 'idle'} theme={theme} />
            <Row style={{ gap: 5, alignItems: 'center' }}>
              {quickActions.map((action) => (
                <Text key={action} fontSize={10} color={theme.textDim} style={{ fontFamily: 'monospace' }}>
                  {action}
                </Text>
              ))}
            </Row>
          </Row>
          <Box
            style={{
              flexGrow: 1,
              flexBasis: 0,
              minHeight: 0,
              paddingLeft: BODY_PAD_X,
              paddingRight: BODY_PAD_X,
              paddingTop: 9,
              paddingBottom: 8,
              backgroundColor: theme.bodyBg,
              gap: 7,
            }}
          >
            {data.draft ? (
              <Box
                style={{
                  position: 'absolute',
                  left: size.width - 56,
                  top: HEADER_H - 1,
                  width: 44,
                  height: 15,
                  borderWidth: 1,
                  borderColor: theme.stateWait,
                  borderRadius: 4,
                  backgroundColor: theme.headerBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text fontSize={7} color={theme.stateWait} style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>DRAFT</Text>
              </Box>
            ) : null}
            {renderBody ? renderBody({ node, selected, pending: anyPending }) : <RenderDefaultBody node={node} theme={theme} />}
          </Box>
          <MetaStrip data={data} theme={theme} />
        </Pressable>
        {stripe === 'trigger' ? (
          <Box style={{ position: 'absolute', left: 0, top: HEADER_H, width: 3, height: size.height - HEADER_H, backgroundColor: theme.ctxColor }} />
        ) : null}
        {stripe === 'end' ? (
          <Box style={{ position: 'absolute', left: size.width - 3, top: HEADER_H, width: 3, height: size.height - HEADER_H, backgroundColor: theme.errorColor }} />
        ) : null}
        <CornerMarks color={selected ? theme.selectedRing : theme.frameColorStrong} width={size.width} height={size.height} />
        {ports.map((port) => (
          <PortPin
            key={`${port.side}:${port.id}`}
            node={node}
            port={port}
            theme={theme}
            width={size.width}
            pending={pendingPortId ? pendingPortId === port.id : port.side === 'in' ? pendingIn : pendingOut}
            onPortClick={onPortClick}
          />
        ))}
        {onRemove ? (
          <Pressable
            onPress={() => onRemove(node.id)}
            style={{
              position: 'absolute',
              left: size.width - 19,
              top: 7,
              width: 13,
              height: 13,
              borderRadius: 6,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.deleteBg,
              borderWidth: 1,
              borderColor: theme.frameColor,
            }}
          >
            <Text fontSize={9} color={theme.textDim}>×</Text>
          </Pressable>
        ) : null}
      </Box>
    </Canvas.Node>
  );
}
