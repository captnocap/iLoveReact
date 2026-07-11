// The model surface's right-click menu content — the canonical home for every
// mesh tool (select / gizmo / toggles), the contextual topology ops, and the
// tucked-away Quality slider. Rendered at the app ROOT (see AppFrame) via
// useContextMenu so it lands at the cursor: the menu positions relative to its
// parent, and only the root sits at window origin (the stage is offset by the
// rail + content browser). The toolbar mirrors the quick subset of this.
import { Fragment, useState } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { Box, Pressable, Row, ScrollView, Slider, Text } from '../../../runtime/primitives';
import {
  meshToolCommands, meshToolActive, meshTopoCommands, modelContextMenuLayout,
  type ModelContextMenuGroup,
} from '../data/commands';
import type { Command, LightId, ModelToolSnapshot } from '../data/types';

// The viewer light-rig switches. Flat is the even paint-true master; Key/Fill only apply when
// Flat is off. `field` reads the on-state off the tool snapshot.
const LIGHT_ROWS: { id: LightId; label: string; field: 'litFlat' | 'litKey' | 'litFill' }[] = [
  { id: 'flat', label: 'Flat (even, paint-true)', field: 'litFlat' },
  { id: 'key', label: 'Key light', field: 'litKey' },
  { id: 'fill', label: 'Fill (lift shadows)', field: 'litFill' },
];

const STATEFUL_TOOL_IDS = new Set(meshToolCommands().map((command) => command.id));

type MeshHistoryPart = { lo: number; hi: number; faces: number };
type MeshHistoryState = {
  vertices: number;
  triangles: number;
  groupRows: number;
  groupsMatchTriangles: boolean;
  authoredGroups: number;
  parts: MeshHistoryPart[];
  rangesValid: boolean;
  unownedFaces: number;
  multiplyOwnedFaces: number;
  ownershipValid: boolean;
  hiddenParts: number;
  bytes: number;
  note: string | null;
};
type MeshHistoryEntry = { label: string; state: MeshHistoryState };
type MeshHistoryLog = {
  version: number;
  capacity: number;
  byteBudget: number;
  journalBytes: number;
  pending: { gizmo: boolean; loopCut: boolean };
  scope: { ranges: [number, number][] };
  topology: { weldedVertices: number; triangleEdges: number; editableEdges: number } | null;
  undo: MeshHistoryEntry[];
  current: MeshHistoryState;
  redo: MeshHistoryEntry[];
};

function readMeshHistoryLog(): MeshHistoryLog {
  const door = (globalThis as any).__mesh_history_log;
  if (typeof door !== 'function') throw new Error('history log door unavailable — rebuild the editor host');
  const raw = door();
  if (typeof raw !== 'string' || !raw) throw new Error('history log returned no data');
  const parsed = JSON.parse(raw) as MeshHistoryLog;
  if (!parsed?.current || !Array.isArray(parsed.undo) || !Array.isArray(parsed.redo)) {
    throw new Error('history log returned malformed data');
  }
  return parsed;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function namesFromNote(note: string | null): string[] {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    if (!Array.isArray(parsed?.parts)) return [];
    return parsed.parts.map((part: any, index: number) =>
      typeof part?.name === 'string' && part.name ? part.name : `part ${index + 1}`);
  } catch { return []; }
}

function HistoryState({ title, state, emphasis = false }: {
  title: string;
  state: MeshHistoryState;
  emphasis?: boolean;
}) {
  const names = namesFromNote(state.note);
  const ownershipColor = accentFor(state.ownershipValid ? 'success' : 'error');
  const partSummary = state.parts.length
    ? state.parts.map((part, index) => `${names[index] ?? `part ${index + 1}`} [${part.lo},${part.hi}) ${part.faces}f`).join('  ·  ')
    : 'no outliner ranges';
  const problems = [
    !state.groupsMatchTriangles ? `${state.groupRows}/${state.triangles} group rows` : null,
    !state.rangesValid ? 'invalid/overlapping ranges' : null,
    state.unownedFaces ? `${state.unownedFaces} unowned` : null,
    state.multiplyOwnedFaces ? `${state.multiplyOwnedFaces} multiply owned` : null,
  ].filter(Boolean).join('  ·  ');
  return (
    <Box style={{ flexDirection: 'column', gap: 3, padding: 7, borderRadius: 5, backgroundColor: emphasis ? 'theme:segActiveBg' : 'theme:cardBg', borderWidth: 1, borderColor: emphasis ? 'theme:primary' : 'theme:borderSoft' }}>
      <Row style={{ alignItems: 'center', gap: 7 }}>
        <Text fontSize={10} color={emphasis ? accentFor('primary') : accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 800 }}>{title}</Text>
        <Box style={{ flexGrow: 1, minWidth: 0 }} />
        <Text fontSize={9} color={ownershipColor} style={{ fontFamily: 'monospace', fontWeight: 800 }}>{state.ownershipValid ? 'ownership OK' : 'OWNERSHIP FAULT'}</Text>
      </Row>
      <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>
        {state.vertices} verts  ·  {state.triangles} tris  ·  {state.authoredGroups} faces  ·  {formatBytes(state.bytes)}
      </Text>
      <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>{partSummary}</Text>
      {problems ? <Text fontSize={9} color={accentFor('error')} style={{ fontFamily: 'monospace', fontWeight: 800 }}>{problems}</Text> : null}
      {state.hiddenParts ? <Text fontSize={9} color={accentFor('warning')} style={{ fontFamily: 'monospace' }}>{state.hiddenParts} hidden part{state.hiddenParts === 1 ? '' : 's'} retained in memory</Text> : null}
    </Box>
  );
}

function CommandRow({ command, modelTool, indented = false, onPress }: {
  command: Command;
  modelTool: ModelToolSnapshot;
  indented?: boolean;
  onPress: () => void;
}) {
  const active = STATEFUL_TOOL_IDS.has(command.id) && meshToolActive(command.id, modelTool);
  const color = STATEFUL_TOOL_IDS.has(command.id)
    ? accentFor(active ? 'primary' : 'textDim')
    : accentFor('primary');
  // Classifier user props are authoritative: `style={undefined}` erases the
  // classified row style instead of meaning "no override". Omit the prop for
  // direct rows; only expanded submenu children receive an indent override.
  const indentProps = indented ? { style: { paddingLeft: 26 } } : {};
  return (
    <C.HW_ContextRow onPress={onPress} {...indentProps}>
      <Icon name={command.icon} size={12} color={color} />
      <C.HW_ContextText>{command.name}</C.HW_ContextText>
      <C.HW_Spacer />
      <C.HW_KeyText>{command.key}</C.HW_KeyText>
    </C.HW_ContextRow>
  );
}

function GroupRow({ group, open, onToggle }: { group: ModelContextMenuGroup; open: boolean; onToggle: () => void }) {
  return (
    <C.HW_ContextRow onPress={onToggle}>
      <Icon name={group.icon} size={12} color={accentFor('primary')} />
      <C.HW_ContextText>{group.label}</C.HW_ContextText>
      <C.HW_Spacer />
      <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
    </C.HW_ContextRow>
  );
}

export default function ModelContextMenu({ modelTool, hasActivePart, selectedPartCount, onCommand, onQuality, onToggleLight, onClose }: {
  modelTool: ModelToolSnapshot;
  // Whether the outliner has a FOCUSED part (unlocks duplicate / mirror) and how
  // many rows are explicitly selected (2+ unlocks structural merge).
  hasActivePart: boolean;
  selectedPartCount: number;
  onCommand: (id: string, source: string) => void;
  onQuality: (quality: number) => void;
  onToggleLight: (which: LightId) => void;
  onClose: () => void;
}) {
  // One family at a time keeps the right-click menu short even after expansion.
  // Child commands preserve the canonical dispatch path; this component only lays them out.
  const [openGroup, setOpenGroup] = useState<ModelContextMenuGroup['id'] | 'edit-history' | null>(null);
  const [history, setHistory] = useState<MeshHistoryLog | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const layout = modelContextMenuLayout(hasActivePart, selectedPartCount);
  const toolGroups = layout.groups.filter((group) => group.id !== 'view');
  const viewGroup = layout.groups.find((group) => group.id === 'view')!;
  const run = (command: Command) => { onCommand(command.id, 'context'); onClose(); };
  const refreshHistory = () => {
    try {
      setHistory(readMeshHistoryLog());
      setHistoryError(null);
      setCopyStatus(null);
    } catch (error) {
      setHistory(null);
      setHistoryError(error instanceof Error ? error.message : String(error));
    }
  };
  const toggleHistory = () => {
    if (openGroup === 'edit-history') {
      setOpenGroup(null);
      return;
    }
    setOpenGroup('edit-history');
    refreshHistory();
  };
  const copyHistory = () => {
    if (!history) return;
    const text = JSON.stringify(history, null, 2);
    (globalThis as any).__meshHistoryLastCopy = text;
    try {
      const copy = (globalThis as any).__clipboard_set;
      if (typeof copy !== 'function') throw new Error('clipboard door unavailable');
      copy(text);
      setCopyStatus('copied');
    } catch { setCopyStatus('copy failed'); }
  };

  const renderGroup = (group: ModelContextMenuGroup) => {
    const open = openGroup === group.id;
    return (
      <Fragment key={group.id}>
        <GroupRow group={group} open={open} onToggle={() => setOpenGroup((current) => current === group.id ? null : group.id)} />
        {open ? group.commands.map((command) => (
          <CommandRow key={command.id} command={command} modelTool={modelTool} indented onPress={() => run(command)} />
        )) : null}
      </Fragment>
    );
  };

  const historyOpen = openGroup === 'edit-history';
  const scopeRanges = history?.scope?.ranges ?? [];
  const staleScope = Boolean(history && scopeRanges.some(([lo, hi]) =>
    !history.current.parts.some((part) => part.lo === lo && part.hi === hi)));
  const scopeLabel = scopeRanges.length
    ? scopeRanges.map(([lo, hi]) => `[${lo},${hi})`).join(' + ')
    : 'whole model';

  return (
    <C.HW_StageContextMenu style={{ width: historyOpen ? 430 : 188 }}>
      {toolGroups.map(renderGroup)}
      {layout.directToolCommands.map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
      {meshTopoCommands(modelTool, selectedPartCount).map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
      {renderGroup(viewGroup)}
      {openGroup === 'view' ? LIGHT_ROWS.map((row) => {
        const disabled = row.id !== 'flat' && modelTool.litFlat;
        const on = modelTool[row.field] && !disabled;
        return (
          <C.HW_ContextRow key={row.id} onPress={() => { if (!disabled) onToggleLight(row.id); }} style={{ paddingLeft: 26 }}>
            <Icon name={on ? 'Lightbulb' : 'LightbulbOff'} size={12} color={accentFor(on ? 'primary' : 'textDim')} />
            <C.HW_ContextText>{row.label}</C.HW_ContextText>
            <C.HW_Spacer />
            <C.HW_KeyText>{disabled ? '—' : on ? 'on' : 'off'}</C.HW_KeyText>
          </C.HW_ContextRow>
        );
      }) : null}
      {/* Part verbs for the FOCUSED outliner part (duplicate / mirrored twin / merge
          the explicit selected set) + the library import. Mirrored twins live in
          the Mirror family above; these primary actions stay one click away. */}
      {layout.directPartCommands.map((command) => (
        <CommandRow key={command.id} command={command} modelTool={modelTool} onPress={() => run(command)} />
      ))}
      <C.HW_ContextRow onPress={toggleHistory}>
        <Icon name="History" size={12} color={accentFor('primary')} />
        <C.HW_ContextText>Edit History</C.HW_ContextText>
        <C.HW_Spacer />
        <Icon name={historyOpen ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
      </C.HW_ContextRow>
      {historyOpen ? (
        <Box style={{ flexDirection: 'column', gap: 7, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 8, borderTopWidth: 1, borderTopColor: 'theme:borderSoft' }}>
          <Row style={{ alignItems: 'center', gap: 7 }}>
            <Text fontSize={9} color={accentFor('textDim')} style={{ fontFamily: 'monospace' }}>
              {history ? `${history.undo.length} undo  ·  ${history.redo.length} redo  ·  ${formatBytes(history.journalBytes)} journal` : 'resident native journal'}
            </Text>
            <Box style={{ flexGrow: 1, minWidth: 0 }} />
            {copyStatus ? <Text fontSize={9} color={accentFor(copyStatus === 'copied' ? 'success' : 'error')} style={{ fontFamily: 'monospace' }}>{copyStatus}</Text> : null}
            <Pressable onPress={refreshHistory} style={{ width: 24, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: 'theme:controlBg', borderWidth: 1, borderColor: 'theme:controlBorder' }}>
              <Icon name="RefreshCw" size={11} color={accentFor('textSecondary')} />
            </Pressable>
            <Pressable onPress={copyHistory} style={{ height: 22, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 7, paddingRight: 7, borderRadius: 4, backgroundColor: 'theme:controlBg', borderWidth: 1, borderColor: 'theme:controlBorder', opacity: history ? 1 : 0.4 }}>
              <Icon name="ClipboardCopy" size={11} color={accentFor('textSecondary')} />
              <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace', fontWeight: 700 }}>Copy</Text>
            </Pressable>
          </Row>
          {history ? (
            <Text fontSize={9} color={accentFor(staleScope ? 'error' : 'textSecondary')} style={{ fontFamily: 'monospace', fontWeight: staleScope ? 800 : 500 }}>
              {history.topology
                ? `${history.topology.weldedVertices} welded verts  ·  ${history.topology.editableEdges} editable edges  ·  ${history.topology.triangleEdges} triangle edges`
                : 'topology unavailable'}
              {`  ·  scope ${scopeLabel}${staleScope ? '  ·  STALE SCOPE' : ''}`}
            </Text>
          ) : null}
          {historyError ? <Text fontSize={9} color={accentFor('error')} style={{ fontFamily: 'monospace' }}>{historyError}</Text> : null}
          {history ? (
            <ScrollView style={{ height: 258 }} showScrollbar contentContainerStyle={{ flexDirection: 'column', gap: 6, paddingRight: 3, paddingBottom: 4 }}>
              {history.undo.map((entry, index) => (
                <HistoryState key={`undo-${index}`} title={`${index + 1}. before ${entry.label}`} state={entry.state} />
              ))}
              <HistoryState title="NOW · resident mesh" state={history.current} emphasis />
              {history.redo.map((entry, index) => (
                <HistoryState key={`redo-${index}`} title={`redo ${index + 1}. after ${entry.label}`} state={entry.state} />
              ))}
            </ScrollView>
          ) : null}
          {history?.pending.gizmo || history?.pending.loopCut ? (
            <Text fontSize={9} color={accentFor('warning')} style={{ fontFamily: 'monospace' }}>
              pending: {[history.pending.gizmo ? 'gizmo gesture' : null, history.pending.loopCut ? 'loop cut' : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {/* Quality lives here — tucked away, only present when the menu is called.
          Dragging stays inside the menu, so it doesn't dismiss. */}
      <C.HW_StageMenuQuality>
        <C.HW_StageMenuQualityHead>
          <C.HW_ContextText>Quality</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{modelTool.tris.toLocaleString()} tris</C.HW_KeyText>
        </C.HW_StageMenuQualityHead>
        {/* Commit-only: the host owns the thumb mid-drag; decimation runs ONCE on
            release. Re-decimating on every onChange frame melted the app. */}
        <Slider value={modelTool.quality} min={0} max={1} onCommit={(v: number) => onQuality(v)} style={{ height: 22 }} />
      </C.HW_StageMenuQuality>
    </C.HW_StageContextMenu>
  );
}
