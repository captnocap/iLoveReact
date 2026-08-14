// inspector/ModelFocusSections.tsx — SECTION G's Model Focus body slices
// (req_4392, the "Model Focus Handoff" design): identity header, SELECTION,
// SHAPE, and PART. The panel's law is THE BOX IS THE AFFORDANCE — derived
// facts are plain text, writable values are boxed EditCells, and empty
// sections collapse to a single header line instead of reserving body space.
import { useState } from 'react';
import { Box, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { getHotState, setHotState } from '@reactjit/runtime/hooks/useHotState';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from '../shell/regions';
import ModelThumbnail from '../library/ModelThumbnail';
import { AssignCell, CellRow, NumberCell, TripleCells, fmtCellNumber } from './EditCell';
import type { ModelFocusBridge, ModelFocusShape, ModelScopeTransformOp, ModelTransformScope } from '../stage/ModelView';
import type { ModelFocusSemantics } from '../model/modelSemanticsFocus';
import type { ModelPackage, ModelPart } from '../data/types';
import {
  modelSelectionModeName,
  summarizeSelectedFaces,
  type ModelSelectionFaceFact,
  type ModelSelectionSnapshot,
  type ModelSelectionVec3,
} from '../model/modelSelectionFocus';

const SELECTION_TUNING = {
  decimalPlaces: 4,
  /** Groups rendered before the "+ N more · show all" fold. */
  groupsVisible: 4,
  maxVisibleDetailRows: 8,
  idsPerRow: 6,
} as const;

function fmtCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function fmtSelectionNumber(value: number): string {
  const nearZero = Math.abs(value) < 0.5 * 10 ** -SELECTION_TUNING.decimalPlaces ? 0 : value;
  return nearZero.toFixed(SELECTION_TUNING.decimalPlaces).replace(/\.?0+$/, '');
}

const fmtSelectionVector = (value: ModelSelectionVec3): string =>
  `(${value.map(fmtSelectionNumber).join(', ')})`;

function fmtSelectionFact(value: ModelSelectionFaceFact, prefix: string): string {
  return value === 'mixed' ? `mixed ${prefix}s` : value === null ? 'none' : `${prefix} ${value}`;
}

// One writable lane per boxed cell (req_4401): preview follows the typing/scrub
// on the mesh through the bridge's squashing preview phase, commit lands the
// one journaled op, cancel restores. All delta math anchors on the BASE the
// edit started from — the published value may refresh under a live preview.
type AxisOpFor = (axis: 0 | 1 | 2, value: number, base: number) => ModelScopeTransformOp | null;
function axisLane(bridge: ModelFocusBridge | null, scope: ModelTransformScope, opFor: AxisOpFor) {
  const run = (phase: 'preview' | 'commit') => (axis: 0 | 1 | 2, value: number, base: number) => {
    const op = opFor(axis, value, base);
    if (op && bridge) bridge.transformScope(scope, op, phase);
  };
  return {
    onCommit: run('commit'),
    onPreview: bridge ? run('preview') : undefined,
    onCancel: bridge ? () => bridge.cancelScopePreview() : undefined,
  };
}

const axisDelta = (axis: 0 | 1 | 2, value: number, base: number): ModelScopeTransformOp | null => {
  if (value === base) return null;
  const delta: [number, number, number] = [0, 0, 0];
  delta[axis] = value - base;
  return { kind: 'translate', delta };
};

// ── Identity header ──────────────────────────────────────────────────────────
// The mock's compact top block: thumbnail chip · editable name · thumbnail-shot
// verb, then the save-state chip · lore revision · Recover / Save verbs. This
// replaces the two stacked rename bars — identity reads as ONE unit.
export function ModelIdentityHeader(props: {
  model: ModelPackage;
  onRename: (id: string, name: string) => void;
  /** Present only while the model is on disk to hold the shot (req_4044). */
  onStageThumbnail?: () => void;
  onDisk: boolean;
  dirty: boolean;
  /** Lore revision from the recovery service, when the coordinator is up. */
  revision: string | null;
  recoverEnabled: boolean;
  onRecover: () => void;
  onSave: () => void;
}) {
  const chip = !props.onDisk ? 'NOT ON DISK' : props.dirty ? 'UNSAVED EDITS' : 'ON DISK';
  const chipTone = props.onDisk && !props.dirty ? 'success' : 'warning';
  return (
    <Box style={{ width: '100%', flexDirection: 'column', gap: 5 }}>
      <Row style={{ alignItems: 'center', gap: 8, width: '100%' }}>
        <Box style={{
          width: 44, height: 34, borderRadius: 4, borderWidth: 1,
          borderColor: accentFor('controlBorder'), backgroundColor: accentFor('surface'),
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          <ModelThumbnail model={props.model} />
        </Box>
        <C.HW_RenameInput value={props.model.name} onChange={(name: string) => props.onRename(props.model.id, name)} />
        {props.onStageThumbnail ? (
          <C.HW_MiniVerb
            tooltip={props.model.thumbnail ? 'Re-shoot the thumbnail from this view' : 'Shoot this view as the model’s thumbnail'}
            onPress={props.onStageThumbnail}
          >
            <Icon name="Camera" size={11} color={accentFor(props.model.thumbnail ? 'textDim' : 'primary')} />
          </C.HW_MiniVerb>
        ) : null}
      </Row>
      <Row style={{ alignItems: 'center', gap: 6, width: '100%' }}>
        <C.HW_Tag
          tooltip={props.dirty ? 'Changes are not on disk yet. Save state only; editing stays enabled.' : 'The model on disk matches the live editor.'}
          style={{ backgroundColor: accentFor(chipTone) }}
        >
          <C.HW_TagText>{chip}</C.HW_TagText>
        </C.HW_Tag>
        {props.revision ? (
          // Lore revisions are full 40-char hashes — print the short form and
          // let the text SHRINK, or the row's Recover/Save verbs get shoved
          // clean off the panel (req_4399).
          <Text
            noWrap
            numberOfLines={1}
            tooltip={`lore revision ${props.revision}`}
            style={{ flexShrink: 1, minWidth: 0, fontSize: 9, fontFamily: 'monospace', color: accentFor('textFaint') }}
          >{`rev ${props.revision.slice(0, 8)}`}</Text>
        ) : null}
        <C.HW_Spacer />
        <C.HW_VerbFixed tooltip="Capture the native-resident mesh without invoking Save" onPress={props.recoverEnabled ? props.onRecover : undefined}>
          <Icon name="DatabaseBackup" size={12} color={accentFor(props.recoverEnabled ? 'warning' : 'textFaint')} />
          <C.HW_VerbText>Recover</C.HW_VerbText>
        </C.HW_VerbFixed>
        <C.HW_VerbFixed onPress={props.onSave}>
          <Icon name="Save" size={12} color={accentFor(props.dirty ? 'warning' : 'textDim')} />
          <C.HW_VerbText>Save</C.HW_VerbText>
        </C.HW_VerbFixed>
      </Row>
    </Box>
  );
}

// ── SELECTION ────────────────────────────────────────────────────────────────
// Empty state is ONE header line (mode badge · 0). Populated, each edge/face
// group is a collapsible row owning its detail rows, with the meta compressed
// onto the group line; only the first few groups render, then a quiet
// "+ N more · show all" fold. The pivot is the section's writable cell — its
// edit translates the live selection so the pivot lands where typed.
type SelectionDetailRow = { key: string; label: string; value: string };
type SelectionVertexRow = { id: number; at: ModelSelectionVec3 };
type SelectionGroup = {
  key: string; title: string; meta: string;
  rows: SelectionDetailRow[];
  /** Writable exact-coordinate rows (req_4401 — the alignment lane). */
  vertices: SelectionVertexRow[];
  assignable: boolean;
};

function selectionGroups(selection: ModelSelectionSnapshot, semanticNames: Map<number, string>): SelectionGroup[] {
  const groups: SelectionGroup[] = [];
  const vertexById = new Map(selection.vertices.map((vertex) => [vertex.id, vertex]));
  const pushIdRows = (rows: SelectionDetailRow[], key: string, label: string, ids: number[]) => {
    for (let at = 0; at < ids.length; at += SELECTION_TUNING.idsPerRow) {
      rows.push({
        key: `${key}-${at}`,
        label: at === 0 ? label : `${label} +`,
        value: ids.slice(at, at + SELECTION_TUNING.idsPerRow).join(', '),
      });
    }
  };
  if (selection.mode === 1) {
    for (const vertex of selection.vertices) {
      groups.push({
        key: `vertex-${vertex.id}`,
        title: `v${vertex.id}`,
        meta: vertex.part === null ? '' : `part ${vertex.part}`,
        rows: [],
        vertices: [{ id: vertex.id, at: vertex.at }],
        assignable: false,
      });
    }
  } else if (selection.mode === 2) {
    for (const edge of selection.edges) {
      const vertices: SelectionVertexRow[] = [];
      for (const vertexId of edge.vertices) {
        const vertex = vertexById.get(vertexId);
        if (vertex) vertices.push({ id: vertexId, at: vertex.at });
      }
      groups.push({
        key: `edge-${edge.id}`,
        title: `e${edge.id}`,
        meta: `v${edge.vertices[0]}–v${edge.vertices[1]} · ${fmtSelectionNumber(edge.length)} m · ${edge.open ? 'open' : 'closed'} · ${edge.part === null ? 'no part' : `part ${edge.part}`}`,
        rows: [],
        vertices,
        assignable: false,
      });
    }
  } else if (selection.mode === 3) {
    for (const face of summarizeSelectedFaces(selection)) {
      const rows: SelectionDetailRow[] = [];
      pushIdRows(rows, `${face.key}-triangles`, 'tri ids', face.triangleIds);
      pushIdRows(rows, `${face.key}-vertices`, 'vert ids', face.vertices);
      if (typeof face.region === 'number') {
        rows.push({
          key: `${face.key}-semantic`,
          label: 'semantic',
          value: `${semanticNames.get(face.region) ?? 'unnamed'} · region ${face.region} · ${fmtSelectionFact(face.instance, 'instance')}`,
        });
      } else if (face.region === 'mixed') {
        rows.push({ key: `${face.key}-semantic`, label: 'semantic', value: 'mixed regions' });
      }
      rows.push({ key: `${face.key}-normal`, label: 'normal', value: fmtSelectionVector(face.normal) });
      rows.push({ key: `${face.key}-area`, label: 'area', value: `${fmtSelectionNumber(face.area)} m²` });
      rows.push({ key: `${face.key}-surface`, label: 'surface', value: `${fmtSelectionFact(face.part, 'part')} · ${fmtSelectionFact(face.material, 'material')}` });
      groups.push({
        key: face.key,
        title: face.group === null ? `tri ${face.triangleIds[0]}` : `face ${face.group}`,
        meta: `${face.triangleIds.length} tris · ${face.vertices.length} verts`,
        rows,
        vertices: face.vertices
          .map((vertexId) => vertexById.get(vertexId))
          .filter((vertex): vertex is NonNullable<typeof vertex> => Boolean(vertex))
          .slice(0, SELECTION_TUNING.maxVisibleDetailRows)
          .map((vertex) => ({ id: vertex.id, at: vertex.at })),
        assignable: face.region === null,
      });
    }
  }
  return groups;
}

export function SelectionSection({ selection, semantics, bridge, onOpenNames }: {
  selection: ModelSelectionSnapshot | null;
  semantics: ModelFocusSemantics | null;
  bridge: ModelFocusBridge | null;
  /** The unassigned semantic's dashed "assign…" cell opens the NAMES pane. */
  onOpenNames: () => void;
}) {
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const mode = selection ? modelSelectionModeName(selection.mode) : 'view';
  const empty = !selection || selection.count === 0;
  const tagTone = empty ? 'textFaint' : 'primary';
  const header = (
    <C.HW_SectionHead style={empty ? { marginBottom: 0 } : {}}>
      <C.HW_AccentBar style={{ backgroundColor: accentFor(tagTone) }} />
      <C.HW_SectionTitle style={{ color: accentFor(tagTone) }}>SELECTION</C.HW_SectionTitle>
      {empty ? (
        <Text style={{ fontSize: 10, color: accentFor('textDim'), marginLeft: 4 }}>{selection ? 'none' : 'native read unavailable'}</Text>
      ) : null}
      <C.HW_Spacer />
      <C.HW_Tag style={{ backgroundColor: accentFor(tagTone) }}>
        <C.HW_TagText>{`${mode.toUpperCase()} · ${selection?.count ?? 0}`}</C.HW_TagText>
      </C.HW_Tag>
    </C.HW_SectionHead>
  );
  // Empty section = one header line, never reserved body space (the handoff law).
  if (empty || !selection) return <C.HW_Section>{header}</C.HW_Section>;

  const semanticNames = new Map((semantics?.rows ?? []).filter((row) => row.kind === 'face').map((row) => [row.id, row.name]));
  const groups = selectionGroups(selection, semanticNames);
  const visibleGroups = showAll ? groups : groups.slice(0, SELECTION_TUNING.groupsVisible);
  const hiddenCount = groups.length - visibleGroups.length;
  const countLabel = selection.mode === 3
    ? `${selection.count} authored face${selection.count === 1 ? '' : 's'} · ${selection.selectedTriangles} tris`
    : `${selection.count} ${mode}${selection.count === 1 ? '' : 's'}`;
  const open = new Set(openGroups);
  const toggleGroup = (key: string) => setOpenGroups((current) => (
    current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
  ));
  const pivotLane = axisLane(bridge, 'selection', axisDelta);
  // Trimmed coordinates ("-0.2354", "0.615") — a fixed 4-decimal print packed
  // three cells into an unreadable digit wall at this width (req_4412).
  const fmtCoord = fmtSelectionNumber;

  return (
    <C.HW_Section>
      {header}
      <C.HW_ReadRow>
        <C.HW_FormLabel>selected</C.HW_FormLabel>
        <C.HW_ReadValue>{countLabel}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>affected</C.HW_FormLabel>
        <C.HW_ReadValue>{`${selection.affectedVertices} welded verts`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      {selection.pivot ? (
        <CellRow label="pivot">
          <TripleCells
            values={selection.pivot}
            onCommit={pivotLane.onCommit}
            onPreview={pivotLane.onPreview}
            onCancel={pivotLane.onCancel}
            format={fmtCoord}
            scrubStep={0.01}
          />
        </CellRow>
      ) : null}
      {selection.bounds ? (
        <>
          <C.HW_ReadRow>
            <C.HW_FormLabel>bounds min</C.HW_FormLabel>
            <C.HW_ReadValue>{`${fmtSelectionVector(selection.bounds.slice(0, 3) as ModelSelectionVec3)} m`}</C.HW_ReadValue>
          </C.HW_ReadRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>bounds max</C.HW_FormLabel>
            <C.HW_ReadValue>{`${fmtSelectionVector(selection.bounds.slice(3, 6) as ModelSelectionVec3)} m`}</C.HW_ReadValue>
          </C.HW_ReadRow>
        </>
      ) : null}
      {selection.truncated ? (
        // A quiet notice, not a gold warning (the handoff): coverage is partial
        // because the native read caps detail on huge selections.
        <C.HW_ReadRow>
          <C.HW_ReadValue style={{ color: accentFor('textFaint') }}>
            {selection.mode === 3
              ? `rendering ${selection.triangles.length}/${selection.selectedTriangles} tris`
              : selection.mode === 2
                ? `rendering ${selection.edges.length}/${selection.count} edges`
                : `rendering ${selection.vertices.length}/${selection.affectedVertices} verts`}
          </C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
      {visibleGroups.map((group) => {
        const detailCount = group.rows.length + group.vertices.length;
        const isOpen = open.has(group.key) && detailCount > 0;
        return (
          <Box key={group.key} style={{ width: '100%', flexDirection: 'column' }}>
            <Pressable
              onPress={() => toggleGroup(group.key)}
              style={{ minHeight: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 12, width: '100%' }}
            >
              <Text style={{ width: 10, fontSize: 8, color: accentFor('textFaint'), textAlign: 'center' }}>{detailCount > 0 ? (isOpen ? '▾' : '▸') : '·'}</Text>
              <Text noWrap numberOfLines={1} style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 800, color: accentFor('textSecondary') }}>{group.title}</Text>
              <Text noWrap numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 9, fontFamily: 'monospace', color: accentFor('textFaint') }}>{group.meta}</Text>
              <C.HW_Spacer />
              {group.assignable ? (
                <AssignCell onPress={onOpenNames} tooltip="Name these faces in the NAMES pane — names ride the saved blob and feed skinning" />
              ) : null}
            </Pressable>
            {isOpen ? group.rows.map((row) => (
              <C.HW_ReadRow key={row.key} style={{ paddingLeft: 28 }}>
                <C.HW_FormLabel>{row.label}</C.HW_FormLabel>
                <C.HW_ReadValue>{row.value}</C.HW_ReadValue>
              </C.HW_ReadRow>
            )) : null}
            {/* Exact-coordinate vertex cells (req_4401): geometry spawning
                fractions of a unit apart cannot be aligned by hand — type the
                number. Commit-only lane: the write SELECTS that vertex (then
                restores the held selection host-side, req_4412), and a live
                preview would rebuild this very section mid-keystroke.
                COMPACT row (req_4412): the 82px form label + reset column left
                three 4-decimal cells ~36px each — an unreadable digit wall.
                A narrow id label hands the width back to the numbers. */}
            {isOpen ? group.vertices.map((vertex) => (
              <Row key={`vx-${group.key}-${vertex.id}`} style={{ minHeight: REGIONS.grid.rowHeight + 3, alignItems: 'center', gap: 6, paddingLeft: 16, paddingRight: 12, width: '100%' }}>
                <Text noWrap style={{ width: 34, fontSize: 10, fontFamily: 'monospace', color: accentFor('textDim') }}>{`v${vertex.id}`}</Text>
                <TripleCells
                  values={vertex.at}
                  format={fmtCoord}
                  scrubStep={0.005}
                  onCommit={(axis, value, base) => {
                    const op = axisDelta(axis, value, base);
                    if (op && bridge) bridge.transformScope({ vertex: vertex.id }, op);
                  }}
                />
              </Row>
            )) : null}
          </Box>
        );
      })}
      {hiddenCount > 0 ? (
        <Pressable
          onPress={() => setShowAll(true)}
          style={{ minHeight: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', paddingLeft: 28, width: '100%' }}
        >
          <Text style={{ fontSize: 9, fontFamily: 'monospace', color: accentFor('primary') }}>{`+ ${hiddenCount} more · show all`}</Text>
        </Pressable>
      ) : showAll && groups.length > SELECTION_TUNING.groupsVisible ? (
        <Pressable
          onPress={() => setShowAll(false)}
          style={{ minHeight: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', paddingLeft: 28, width: '100%' }}
        >
          <Text style={{ fontSize: 9, fontFamily: 'monospace', color: accentFor('textFaint') }}>show first {SELECTION_TUNING.groupsVisible}</Text>
        </Pressable>
      ) : null}
    </C.HW_Section>
  );
}

// ── SHAPE ────────────────────────────────────────────────────────────────────
// The five-count stat strip plus bounds. Bounds center/radius are WRITABLE
// boxed cells: center edits translate the whole model, radius edits scale it
// uniformly about its own pivot — one exact, host-journaled op each.
export function ShapeSection({ shape, bridge, onSelectAudit }: {
  shape: ModelFocusShape | null;
  bridge: ModelFocusBridge | null;
  onSelectAudit: (kind: 'intersecting' | 'unreachable' | 'both') => void;
}) {
  const cells: [string, string][] = [
    ['verts', shape && shape.topologyMeasured ? fmtCount(shape.verts) : '—'],
    ['faces', shape ? fmtCount(shape.faces) : '—'],
    ['edges', shape && shape.topologyMeasured ? fmtCount(shape.edges) : '—'],
    ["uv'd", shape ? fmtCount(shape.uvd) : '—'],
    ['mounts', shape ? fmtCount(shape.mounts) : '—'],
  ];
  const center = shape?.center ?? null;
  const centerLane = axisLane(bridge, 'model', axisDelta);
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>SHAPE</C.HW_SectionTitle>
        <C.HW_Spacer />
        {shape?.audited && (shape.intersecting > 0 || shape.unreachable > 0) ? (
          <C.HW_MiniVerb
            onPress={() => onSelectAudit('both')}
            tooltip="Select every intersecting AND unreachable triangle at once"
          >
            <Icon name="Target" size={10} color={accentFor('warning')} />
          </C.HW_MiniVerb>
        ) : null}
      </C.HW_SectionHead>
      <C.HW_StatGrid>
        {cells.map(([label, value]) => (
          <C.HW_StatCell key={label}>
            <C.HW_StatValue>{value}</C.HW_StatValue>
            <C.HW_StatLabel>{label}</C.HW_StatLabel>
          </C.HW_StatCell>
        ))}
      </C.HW_StatGrid>
      {center && bridge ? (
        <CellRow label="bounds center">
          <TripleCells
            values={center}
            scrubStep={0.01}
            onCommit={centerLane.onCommit}
            onPreview={centerLane.onPreview}
            onCancel={centerLane.onCancel}
          />
        </CellRow>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>bounds center</C.HW_FormLabel>
          <C.HW_ReadValue>—</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
      {shape && bridge && shape.radius > 0 ? (
        <CellRow label="bounds radius">
          <NumberCell
            width={64}
            value={shape.radius}
            scrubStep={0.01}
            onCommit={(value, base) => {
              if (value > 0 && base > 0) bridge.transformScope('model', { kind: 'scale-uniform', factor: value / base });
            }}
            onPreview={(value, base) => {
              if (value > 0 && base > 0) bridge.transformScope('model', { kind: 'scale-uniform', factor: value / base }, 'preview');
            }}
            onCancel={() => bridge.cancelScopePreview()}
          />
          <Text style={{ fontSize: 9, color: accentFor('textFaint') }}>u</Text>
          <C.HW_Spacer />
        </CellRow>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>bounds radius</C.HW_FormLabel>
          <C.HW_ReadValue>{shape ? `${shape.radius.toFixed(2)} u` : '—'}</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
      <GeometryFactRow
        label="intersecting"
        shape={shape}
        count={shape?.intersecting ?? 0}
        detail="tris through other tris"
        onSelect={() => onSelectAudit('intersecting')}
      />
      <GeometryFactRow
        label="unreachable"
        shape={shape}
        count={shape?.unreachable ?? 0}
        detail="tris no camera can see"
        onSelect={() => onSelectAudit('unreachable')}
      />
    </C.HW_Section>
  );
}

// The two hard geometry facts, in the panel so a disaster is visible without going to
// look for it (req_3750). Tinted only when the count is real: an over-budget mesh reads
// "not measured", never a clean zero it did not earn.
function GeometryFactRow(
  { label, shape, count, detail, onSelect }: {
    label: string; shape: ModelFocusShape | null; count: number; detail: string;
    /** Select these exact triangles — a count you cannot locate is not actionable
     *  (req_3883). Offered only when the audit is real and found something. */
    onSelect: () => void;
  },
) {
  // A count larger than the mesh cannot describe this mesh — it belongs to another one
  // (req_3752). Show that, rather than a number the panel knows is impossible.
  const inconsistent = !!shape && shape.audited && count > shape.tris;
  const value = !shape ? '—'
    : !shape.audited ? 'not measured'
      : inconsistent ? `stale · ${fmtCount(count)} vs ${fmtCount(shape.tris)} tris`
        : count === 0 ? `0 · ${detail}`
          : `${fmtCount(count)} · ${detail}`;
  const tone = inconsistent ? 'error' : shape?.audited && count > 0 ? 'warning' : 'textDim';
  const locatable = !!shape && shape.audited && !inconsistent && count > 0;
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{label}</C.HW_FormLabel>
      <C.HW_ReadValue style={{ color: accentFor(tone) }}>{value}</C.HW_ReadValue>
      {locatable ? (
        <C.HW_MiniVerb onPress={onSelect} tooltip={`Select all ${fmtCount(count)} ${label} triangles — face mode, then press F to frame them`}>
          <Icon name="Target" size={10} color={accentFor(tone)} />
        </C.HW_MiniVerb>
      ) : null}
    </C.HW_ReadRow>
  );
}

// ── PART ─────────────────────────────────────────────────────────────────────
// The active part's numeric transform rows. Geometry BAKES transforms — there
// is no retained per-part matrix — so these cells surface the SESSION-APPLIED
// offsets (a hot twig, per model+part) and every commit lands the delta as one
// exact host-journaled transform over the part's authored range. Host undo
// rewinds the geometry but not this ledger: the ledger is "what the panel
// applied", never a second source of geometric truth.
type PartTransformEntry = {
  pos: [number, number, number];
  rot: [number, number, number];
  scl: [number, number, number];
};
type PartTransformTwig = Record<string, PartTransformEntry>;
const PART_XFORM_TWIG = 'editor.part-xform.v1';
const PART_XFORM_DEFAULT: PartTransformEntry = { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] };

function readPartTransforms(): PartTransformTwig {
  return getHotState<PartTransformTwig>(PART_XFORM_TWIG, {});
}

export function PartSection({ modelId, part, bridge }: {
  modelId: string;
  part: ModelPart;
  bridge: ModelFocusBridge | null;
}) {
  const [, setRevision] = useState(0);
  const range = part.lo != null && part.hi != null && part.hi > part.lo
    ? { lo: part.lo, hi: part.hi }
    : null;
  const ledgerKey = `${modelId}:${part.id}`;
  const entry = readPartTransforms()[ledgerKey] ?? PART_XFORM_DEFAULT;
  const writeEntry = (next: PartTransformEntry) => {
    const all = { ...readPartTransforms() };
    const isDefault = next.pos.every((v) => v === 0) && next.rot.every((v) => v === 0) && next.scl.every((v) => v === 1);
    if (isDefault) delete all[ledgerKey];
    else all[ledgerKey] = next;
    setHotState(PART_XFORM_TWIG, all);
    setRevision((value) => value + 1);
  };
  const apply = (op: ModelScopeTransformOp, phase: 'preview' | 'commit' = 'commit'): boolean =>
    Boolean(range && bridge?.transformScope(range, op, phase));
  const laneOp = (lane: 'pos' | 'rot' | 'scl', axis: 0 | 1 | 2, value: number, base: number): ModelScopeTransformOp | null => {
    if (value === base) return null;
    if (lane === 'pos') {
      const delta: [number, number, number] = [0, 0, 0];
      delta[axis] = value - base;
      return { kind: 'translate', delta };
    }
    if (lane === 'rot') return { kind: 'rotate', axis, degrees: value - base };
    if (!(value > 0) || !(base > 0)) return null;
    return { kind: 'scale', axis, factor: value / base };
  };
  const previewAxis = (lane: 'pos' | 'rot' | 'scl') => (axis: 0 | 1 | 2, value: number, base: number) => {
    const op = laneOp(lane, axis, value, base);
    if (op) apply(op, 'preview');
  };
  const cancelPreview = bridge ? () => bridge.cancelScopePreview() : undefined;
  const commitAxis = (lane: 'pos' | 'rot' | 'scl', axis: 0 | 1 | 2, value: number, base: number) => {
    const op = laneOp(lane, axis, value, base);
    if (!op || !apply(op)) return;
    const next: PartTransformEntry = {
      pos: [...entry.pos] as [number, number, number],
      rot: [...entry.rot] as [number, number, number],
      scl: [...entry.scl] as [number, number, number],
    };
    next[lane][axis] = value;
    writeEntry(next);
  };
  const resetLane = (lane: 'pos' | 'rot' | 'scl') => {
    let ok = true;
    if (lane === 'pos') {
      if (entry.pos.some((v) => v !== 0)) ok = apply({ kind: 'translate', delta: [-entry.pos[0], -entry.pos[1], -entry.pos[2]] });
    } else if (lane === 'rot') {
      // Inverse rotations unwind in reverse application order (Z, Y, X follow
      // the commit order X, Y, Z only approximately for multi-axis stacks —
      // single-axis stacks, the common case, unwind exactly).
      for (const axis of [2, 1, 0] as const) {
        if (entry.rot[axis] !== 0) ok = apply({ kind: 'rotate', axis, degrees: -entry.rot[axis] }) && ok;
      }
    } else {
      for (const axis of [0, 1, 2] as const) {
        if (entry.scl[axis] !== 1 && entry.scl[axis] > 0) ok = apply({ kind: 'scale', axis, factor: 1 / entry.scl[axis] }) && ok;
      }
    }
    if (!ok) return;
    const next: PartTransformEntry = {
      pos: [...entry.pos] as [number, number, number],
      rot: [...entry.rot] as [number, number, number],
      scl: [...entry.scl] as [number, number, number],
    };
    next[lane] = lane === 'scl' ? [1, 1, 1] : [0, 0, 0];
    writeEntry(next);
  };
  const posOverridden = entry.pos.some((v) => v !== 0);
  const rotOverridden = entry.rot.some((v) => v !== 0);
  const sclOverridden = entry.scl.some((v) => v !== 1);
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('success') }} />
        <C.HW_SectionTitle style={{ color: accentFor('success') }}>{`PART · ${part.name.toUpperCase()}`}</C.HW_SectionTitle>
        <C.HW_Spacer />
        {range ? (
          <Text noWrap style={{ fontSize: 9, fontFamily: 'monospace', color: accentFor('textFaint') }}>{`${range.hi - range.lo} faces`}</Text>
        ) : null}
      </C.HW_SectionHead>
      {range ? (
        <>
          <CellRow label="position" overridden={posOverridden} onReset={() => resetLane('pos')} resetTooltip="Translate the part back to its session origin">
            <TripleCells values={entry.pos} overridden={posOverridden} scrubStep={0.01} onCommit={(axis, value, base) => commitAxis('pos', axis, value, base)} onPreview={previewAxis('pos')} onCancel={cancelPreview} />
          </CellRow>
          <CellRow label="rotation" overridden={rotOverridden} onReset={() => resetLane('rot')} resetTooltip="Unwind the session rotations">
            <TripleCells values={entry.rot} overridden={rotOverridden} scrubStep={0.5} format={(value) => `${Math.round(value)}°`} onCommit={(axis, value, base) => commitAxis('rot', axis, value, base)} onPreview={previewAxis('rot')} onCancel={cancelPreview} />
          </CellRow>
          <CellRow label="scale" overridden={sclOverridden} onReset={() => resetLane('scl')} resetTooltip="Scale the part back to 1.00">
            <TripleCells values={entry.scl} overridden={sclOverridden} scrubStep={0.01} format={(value) => fmtCellNumber(value)} onCommit={(axis, value, base) => commitAxis('scl', axis, value, base)} onPreview={previewAxis('scl')} onCancel={cancelPreview} />
          </CellRow>
        </>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>transforms</C.HW_FormLabel>
          <C.HW_ReadValue>part carries no authored range yet</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
    </C.HW_Section>
  );
}
