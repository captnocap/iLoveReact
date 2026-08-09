// SECTION G — Focus Panel (see shell/regions.ts SECTIONS): the contextual focus
// body + its persistent pane rail. The active rail button folds the body away.
import { useEffect, useRef, useState } from 'react';
import { Pressable, Row, ScrollView } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
// Fixed-region contract (req_2627): the UV preview sizes itself from the focus
// panel's CONSTANT inner width — imported, never measured.
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge, ModelFocusShape } from '../stage/ModelView';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, SNAP_MODES, effectiveModelPackage } from '../data/content';
import { resolvedPanelId, rightPanelsFor, type RightPanelId } from '../data/panelSystem';
import { objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, ModelTextureSlot, WorkspaceDocumentKind, WorldObject } from '../data/types';
import type { MaterialRef } from '../world/pieces';
import type { WorldView } from '../world/worldViews';
import { assetById, resolveMaterialRef } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import RigSection from './RigSection';
import CharacterRigSection from './CharacterRigSection';
import { skeletonToPropRig, type CharacterRigApi, type CharacterRigSnapshot, type HumanoidSemanticMembership, type PropRig } from '../../../runtime/skeleton';
import PieceBody, { type PieceEditHandlers } from './PieceBody';
import GlobalsSection from './GlobalsSection';
import GcStressSection from './GcStressSection';
import PresetSection from './PresetSection';
import ModelDetailBody from '../library/ModelDetailBody';
import ModelPaintVariants from '../library/ModelPaintVariants';
import NamesPanel from './NamesPanel';
import type { ColorSpineHandlers } from './ModelBrushDock';
import ModelOutliner from '../stage/ModelOutliner';
import BlobExplorerSurface, {
  type BlobExplorerSurfaceProps,
} from '../stage/BlobExplorerSurface';
import type { OutlinerHandlers } from '../stage/ModelDocumentSurface';
import type { Brush } from '../../../runtime/paint/model';
import UvEditor from './UvEditor';
import { UV_WORKSPACE_FLEX_STYLE, uvPanelWidthFromDrag, uvWorkspaceLayout, type UvWorkspaceLayout } from './uvWorkspace';
import type { LightRig } from '../model/editMesh';
import { blobViewportFaceSelection } from '../model/blobExplorerState';
import { semanticHorizonLines, type ModelFocusSemantics } from '../model/modelSemanticsFocus';
import { hasCharacterRigCapability } from '../skeleton/characterRigCapability';
import {
  modelSelectionModeName,
  summarizeSelectedFaces,
  type ModelSelectionFaceFact,
  type ModelSelectionSnapshot,
  type ModelSelectionVec3,
} from '../model/modelSelectionFocus';

// ── Model-focus bridge (req_2643 OO / req_2618 G): the model viewer publishes the
// UV-atlas + SHAPE truth on globalThis.__modelFocusBridge and pings
// __modelFocusBridgeChanged (the same global-door pattern as __modelPartRangesChanged).
// This hook subscribes so the focus panel re-reads on every ping — no AppFrame plumbing.
function useModelFocusBridge(): ModelFocusBridge | null {
  const [snap, setSnap] = useState<ModelFocusBridge | null>(() => ((globalThis as any).__modelFocusBridge ?? null));
  useEffect(() => {
    (globalThis as any).__modelFocusBridgeChanged = () => setSnap((globalThis as any).__modelFocusBridge ?? null);
    return () => { (globalThis as any).__modelFocusBridgeChanged = undefined; };
  }, []);
  return snap;
}

function fmtCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

const SELECTION_READOUT_TUNING = {
  decimalPlaces: 4,
  maxVisibleDetailRows: 8,
  idsPerRow: 6,
} as const;

function fmtSelectionNumber(value: number): string {
  const nearZero = Math.abs(value) < 0.5 * 10 ** -SELECTION_READOUT_TUNING.decimalPlaces ? 0 : value;
  return nearZero.toFixed(SELECTION_READOUT_TUNING.decimalPlaces).replace(/\.?0+$/, '');
}

const fmtSelectionVector = (value: ModelSelectionVec3): string =>
  `(${value.map(fmtSelectionNumber).join(', ')})`;

function fmtSelectionFact(value: ModelSelectionFaceFact, prefix: string): string {
  return value === 'mixed' ? `mixed ${prefix}s` : value === null ? 'none' : `${prefix} ${value}`;
}

function SelectionSection({ selection, semantics }: {
  selection: ModelSelectionSnapshot | null;
  semantics: ModelFocusSemantics | null;
}) {
  const mode = selection ? modelSelectionModeName(selection.mode) : 'view';
  const semanticNames = new Map((semantics?.rows ?? []).map((row) => [row.id, row.name]));
  const faces = selection ? summarizeSelectedFaces(selection) : [];
  const vertexById = new Map((selection?.vertices ?? []).map((vertex) => [vertex.id, vertex]));
  const detailRows: { key: string; label: string; value: string }[] = [];
  const pushIdRows = (key: string, label: string, ids: number[]) => {
    for (let at = 0; at < ids.length; at += SELECTION_READOUT_TUNING.idsPerRow) {
      detailRows.push({
        key: `${key}-${at}`,
        label: at === 0 ? label : `${label} +`,
        value: ids.slice(at, at + SELECTION_READOUT_TUNING.idsPerRow).join(', '),
      });
    }
  };

  if (selection?.mode === 1) {
    for (const vertex of selection.vertices) {
      detailRows.push({
        key: `vertex-${vertex.id}`,
        label: `vertex v${vertex.id}`,
        value: `${fmtSelectionVector(vertex.at)} m${vertex.part === null ? '' : ` · part ${vertex.part}`}`,
      });
    }
  } else if (selection?.mode === 2) {
    for (const edge of selection.edges) {
      detailRows.push({
        key: `edge-${edge.id}`,
        label: `edge e${edge.id}`,
        value: `v${edge.vertices[0]}—v${edge.vertices[1]} · ${fmtSelectionNumber(edge.length)} m`,
      });
      detailRows.push({
        key: `edge-${edge.id}-topology`,
        label: 'topology',
        value: `${edge.faces} incident · ${edge.open ? 'open' : 'closed'} · ${edge.part === null ? 'no part' : `part ${edge.part}`}`,
      });
      for (const vertexId of edge.vertices) {
        const vertex = vertexById.get(vertexId);
        if (vertex) detailRows.push({
          key: `edge-${edge.id}-vertex-${vertexId}`,
          label: `vertex v${vertexId}`,
          value: `${fmtSelectionVector(vertex.at)} m`,
        });
      }
    }
  } else if (selection?.mode === 3) {
    for (const face of faces) {
      const faceId = face.group === null ? `tri ${face.triangleIds[0]}` : `group ${face.group}`;
      // With ONE face selected the summary above already said its triangle and
      // welded-vertex counts; repeating them here was the same number a third time
      // on screen (req_3889). With several faces this is real per-face detail.
      if (faces.length > 1) detailRows.push({
        key: `${face.key}-face`,
        label: `face ${faceId}`,
        value: `${face.triangleIds.length} tris · ${face.vertices.length} verts`,
      });
      pushIdRows(`${face.key}-triangles`, 'tri ids', face.triangleIds);
      pushIdRows(`${face.key}-vertices`, 'vert ids', face.vertices);
      const semantic = typeof face.region === 'number'
        ? `${semanticNames.get(face.region) ?? 'unnamed'} · region ${face.region}`
        : fmtSelectionFact(face.region, 'region');
      detailRows.push({
        key: `${face.key}-semantic`,
        label: 'semantic',
        value: `${semantic} · ${fmtSelectionFact(face.instance, 'instance')}`,
      });
      detailRows.push({
        key: `${face.key}-normal`,
        label: 'normal',
        value: fmtSelectionVector(face.normal),
      });
      detailRows.push({
        key: `${face.key}-area`,
        label: 'area',
        value: `${fmtSelectionNumber(face.area)} m²`,
      });
      detailRows.push({
        key: `${face.key}-surface`,
        label: 'surface',
        value: `${fmtSelectionFact(face.part, 'part')} · ${fmtSelectionFact(face.material, 'material')}`,
      });
    }
    for (const vertex of selection.vertices) {
      detailRows.push({
        key: `face-vertex-${vertex.id}`,
        label: `vertex v${vertex.id}`,
        value: `${fmtSelectionVector(vertex.at)} m${vertex.part === null ? '' : ` · part ${vertex.part}`}`,
      });
    }
  }

  const countLabel = !selection ? 'native read unavailable'
    : selection.count === 0 ? 'none'
      : selection.mode === 3
        ? `${selection.count} authored face${selection.count === 1 ? '' : 's'} · ${selection.selectedTriangles} tris`
        : `${selection.count} ${mode}${selection.count === 1 ? '' : 's'}`;
  const detailHeight = Math.min(SELECTION_READOUT_TUNING.maxVisibleDetailRows, detailRows.length) * REGIONS.grid.rowHeight;
  const detailCoverage = selection?.mode === 3
    ? `${selection.triangles.length}/${selection.selectedTriangles} tris · ${selection.vertices.length}/${selection.affectedVertices} verts`
    : selection?.mode === 2
      ? `${selection.edges.length}/${selection.count} edges · ${selection.vertices.length}/${selection.affectedVertices} verts`
      : `${selection?.vertices.length ?? 0}/${selection?.affectedVertices ?? 0} verts`;
  const tagTone = selection?.count ? 'primary' : 'textFaint';

  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(tagTone) }} />
        <C.HW_SectionTitle style={{ color: accentFor(tagTone) }}>SELECTION</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_Tag style={{ backgroundColor: accentFor(tagTone) }}>
          <C.HW_TagText>{`${mode.toUpperCase()} · ${selection?.count ?? 0}`}</C.HW_TagText>
        </C.HW_Tag>
      </C.HW_SectionHead>
      <C.HW_ReadRow>
        <C.HW_FormLabel>selected</C.HW_FormLabel>
        <C.HW_ReadValue>{countLabel}</C.HW_ReadValue>
      </C.HW_ReadRow>
      {selection && selection.count > 0 ? (
        <>
          <C.HW_ReadRow>
            <C.HW_FormLabel>affected</C.HW_FormLabel>
            <C.HW_ReadValue>{`${selection.affectedVertices} welded verts`}</C.HW_ReadValue>
          </C.HW_ReadRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>pivot</C.HW_FormLabel>
            <C.HW_ReadValue>{selection.pivot ? `${fmtSelectionVector(selection.pivot)} m` : '—'}</C.HW_ReadValue>
          </C.HW_ReadRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>bounds min</C.HW_FormLabel>
            <C.HW_ReadValue>{selection.bounds ? `${fmtSelectionVector(selection.bounds.slice(0, 3) as ModelSelectionVec3)} m` : '—'}</C.HW_ReadValue>
          </C.HW_ReadRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>bounds max</C.HW_FormLabel>
            <C.HW_ReadValue>{selection.bounds ? `${fmtSelectionVector(selection.bounds.slice(3, 6) as ModelSelectionVec3)} m` : '—'}</C.HW_ReadValue>
          </C.HW_ReadRow>
          {selection.truncated ? (
            <C.HW_ReadRow>
              <C.HW_FormLabel>detail</C.HW_FormLabel>
              <C.HW_ReadValue style={{ color: accentFor('warning') }}>{`showing ${detailCoverage}`}</C.HW_ReadValue>
            </C.HW_ReadRow>
          ) : null}
          {detailRows.length > 0 ? (
            <ScrollView style={{ width: '100%', height: detailHeight }} showScrollbar>
              {detailRows.map((row) => (
                <C.HW_ReadRow key={row.key}>
                  <C.HW_FormLabel>{row.label}</C.HW_FormLabel>
                  <C.HW_ReadValue>{row.value}</C.HW_ReadValue>
                </C.HW_ReadRow>
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </C.HW_Section>
  );
}

// SHAPE — the old studio's count strip (req_2618 G): verts/faces/edges/uv'd/mounts as
// five labeled numbers on ONE grid row, plus the bounds line. Everything shown is
// already real cart-side (surface-vs-mock ruling): verts/edges come from the host
// counts door and read '—' until it builds topology (vertex/edge mode) — never 0-faked;
// uv'd is faces-with-atlas (whole-model atlas covers all once it exists); mounts is an
// honest 0 until the rig slice lands.
function ShapeSection({ shape, onSelectAudit }: {
  shape: ModelFocusShape | null;
  onSelectAudit: (kind: 'intersecting' | 'unreachable' | 'both') => void;
}) {
  const cells: [string, string][] = [
    ['verts', shape && shape.verts > 0 ? fmtCount(shape.verts) : '—'],
    ['faces', shape ? fmtCount(shape.faces) : '—'],
    ['edges', shape && shape.edges > 0 ? fmtCount(shape.edges) : '—'],
    ["uv'd", shape ? fmtCount(shape.uvd) : '—'],
    ['mounts', shape ? fmtCount(shape.mounts) : '—'],
  ];
  // Bounds on TWO grid rows (center / radius) — one value per row so neither ever
  // truncates against the panel's fixed inner width.
  const centerLine = shape ? (shape.center ? `${shape.center.map((c) => c.toFixed(2)).join(', ')} u` : '—') : '—';
  const radiusLine = shape ? `${shape.radius.toFixed(2)} u` : '—';
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
      <C.HW_ReadRow>
        <C.HW_FormLabel>bounds center</C.HW_FormLabel>
        <C.HW_ReadValue>{centerLine}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>bounds radius</C.HW_FormLabel>
        <C.HW_ReadValue>{radiusLine}</C.HW_ReadValue>
      </C.HW_ReadRow>
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

function SemanticsSection({ semantics, onRefresh, onOpenNames }: {
  semantics: ModelFocusSemantics;
  onRefresh: () => void;
  /** The region list lives in its own pane now — this row goes there instead of
   *  printing a second, smaller copy of it (req_3889). */
  onOpenNames: () => void;
}) {
  const statusLabel = semantics.status === 'healthy' ? 'RESIDENT'
    : semantics.status === 'visibility-filtered' ? 'HIDDEN PARTS'
    : semantics.status === 'mount-mismatch' ? 'MOUNT DROP'
    : semantics.status === 'load-mismatch' ? 'LOAD MISMATCH'
      : semantics.status === 'resident-only' ? 'LIVE ONLY'
        : 'NO NAMES';
  const statusTone = semantics.status === 'healthy' || semantics.status === 'visibility-filtered' ? 'success'
    : semantics.status === 'load-mismatch' || semantics.status === 'mount-mismatch' ? 'warning'
      : 'textFaint';
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>SEMANTICS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_Tag style={{ backgroundColor: accentFor(statusTone) }}>
          <C.HW_TagText>{statusLabel}</C.HW_TagText>
        </C.HW_Tag>
        <C.HW_MiniVerb onPress={onRefresh} tooltip="Re-read semantic names from the resident native mesh">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {semanticHorizonLines(semantics).map((line) => (
        <C.HW_ReadRow key={line.label}>
          <C.HW_FormLabel>{line.label}</C.HW_FormLabel>
          <C.HW_ReadValue>{line.value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      {semantics.status === 'mount-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>viewport input dropped them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'load-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>native hydration lost them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'visibility-filtered' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>hidden parts, names intact</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
      {semantics.rows.length > 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>names</C.HW_FormLabel>
          <Pressable
            onPress={onOpenNames}
            tooltip="Open the NAMES pane — the full region list, each row selecting its faces"
            style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <C.HW_ReadValue style={{ color: accentFor('primary') }}>{`${semantics.rows.length} in the NAMES pane →`}</C.HW_ReadValue>
          </Pressable>
        </C.HW_ReadRow>
      ) : null}
    </C.HW_Section>
  );
}

// UV — the atlas section relocated INTO the focus panel from the floating viewport
// card (req_2643 OO). The header carries the active OUTLINER part's name (req_2619 P:
// the UV read is per-outliner even while storage stays whole-model) plus the dims/
// density readout on one line. Atlas pixels are a raw Paintable substrate; every
// island remains live selectable geometry above it, including off-part islands.
// extraCount is the multi-select overflow (req_2659d): 'CUBE 1 +2' = primary + 2 more.
function UvSection({
  bridge,
  partName,
  extraCount,
  workspace,
  onToggleFocus,
}: {
  bridge: ModelFocusBridge | null;
  partName: string;
  extraCount: number;
  workspace: UvWorkspaceLayout;
  onToggleFocus: () => void;
}) {
  const uv = bridge?.uv ?? null;
  const FocusVerb = workspace.focused ? C.HW_UvFocusVerbOn : C.HW_UvFocusVerb;
  return (
    <C.HW_Section style={{ ...UV_WORKSPACE_FLEX_STYLE, flexDirection: 'column' }}>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>{`UV · ${partName.toUpperCase()}${extraCount > 0 ? ` +${extraCount}` : ''}`}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_ReadValue>{uv ? `${uv.w}×${uv.h} · ${uv.detail} x/m target` : '—'}</C.HW_ReadValue>
        <FocusVerb onPress={onToggleFocus} tooltip={workspace.toggleTooltip}>
          <Icon name={workspace.focused ? 'Minimize2' : 'Maximize2'} size={10} color={accentFor(workspace.focused ? 'primary' : 'textDim')} />
          <C.HW_UvFocusVerbText>{workspace.toggleLabel}</C.HW_UvFocusVerbText>
        </FocusVerb>
        <C.HW_MiniVerb onPress={() => bridge?.refreshUv()} tooltip="Re-read the live paint atlas">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {uv && uv.rgba && bridge ? (
        <UvEditor uv={uv} bridge={bridge} focused={workspace.focused} />
      ) : workspace.emptyState === 'workspace' ? (
        <C.HW_UvEmptyWorkspace>
          <C.HW_UvEmptyTitle>NO UV ATLAS</C.HW_UvEmptyTitle>
          <C.HW_UvEmptyCopy>{uv?.note ?? 'Use Paint or import a texture to create the editable atlas.'}</C.HW_UvEmptyCopy>
        </C.HW_UvEmptyWorkspace>
      ) : uv ? (
        <C.HW_ReadRow>
          <C.HW_UvNote>{uv.note ?? 'no atlas'}</C.HW_UvNote>
        </C.HW_ReadRow>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>atlas</C.HW_FormLabel>
          <C.HW_ReadValue>none saved — use Paint to create one</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
      {workspace.showScope ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>scope</C.HW_FormLabel>
          <C.HW_ReadValue>{uv?.scope ?? 'whole model'}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
    </C.HW_Section>
  );
}

// ── VIEW BOOKMARKS (req_3074) ───────────────────────────────────────────────────────
// The camera bookmark list, directly below the UV card. Pins come from the viewer (the
// action-bar Store View verb or the + here); clicking a row jumps the camera back to
// that pose, the trash verb drops it. The active row (last stored/recalled — what the
// H key returns to) carries the primary accent. List truth is view state in the
// viewer's hot twig: it survives hot reloads and resets on a cold start.
function ViewBookmarksSection({ bridge }: { bridge: ModelFocusBridge | null }) {
  const marks = bridge?.camMarks ?? [];
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>VIEWS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_MiniVerb onPress={() => bridge?.camStore()} tooltip="Pin the current camera as a bookmark">
          <Icon name="BookmarkPlus" size={11} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {marks.length === 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>bookmarks</C.HW_FormLabel>
          <C.HW_ReadValue>none</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : marks.map((mark, index) => (
        <Row key={`view-mark-${index}`} style={{ alignItems: 'center', gap: 6, height: REGIONS.grid.rowHeight, width: '100%' }}>
          <Pressable
            onPress={() => bridge?.camRecallAt(index)}
            tooltip="Jump the camera to this view"
            style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="Bookmark" size={11} color={accentFor(mark.active ? 'primary' : 'textDim')} />
            <C.HW_ReadValue>{mark.name}</C.HW_ReadValue>
          </Pressable>
          <C.HW_MiniVerb onPress={() => bridge?.camRemoveAt(index)} tooltip="Remove this bookmark">
            <Icon name="Trash2" size={11} color={accentFor('textDim')} />
          </C.HW_MiniVerb>
        </Row>
      ))}
    </C.HW_Section>
  );
}

/** The world surface's saved-view verbs, mirroring the model surface's bookmark set. */
export type WorldViewHandlers = {
  views: readonly WorldView[];
  activeId: string | null;
  onStore: () => void;
  onRecall: (id: string) => void;
  onRemove: (id: string) => void;
};

// ── SAVED VIEWS (req_4168) ──────────────────────────────────────────────────────────
// The world twin of the model surface's bookmark card, and deliberately the same card:
// one editor, one bookmark vocabulary. The difference is what a pin carries and how
// long it lives — a world view restores the ACTIVE STOREY along with the camera, and
// it rides world.json, so a 3 km map still knows your places after a cold restart.
function WorldViewsSection({ handlers }: { handlers: WorldViewHandlers }) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>VIEWS</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_MiniVerb onPress={handlers.onStore} tooltip="Pin where you are standing — camera, facing, zoom and storey">
          <Icon name="BookmarkPlus" size={11} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {handlers.views.length === 0 ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>saved</C.HW_FormLabel>
          <C.HW_ReadValue>none — Store View pins this spot</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : handlers.views.map((view) => (
        <Row key={view.id} style={{ alignItems: 'center', gap: 6, height: REGIONS.grid.rowHeight, width: '100%' }}>
          <Pressable
            onPress={() => handlers.onRecall(view.id)}
            tooltip={`Jump to ${view.name} (floor ${view.floor})`}
            style={{ flexGrow: 1, minWidth: 0, height: REGIONS.grid.rowHeight, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="Bookmark" size={11} color={accentFor(view.id === handlers.activeId ? 'primary' : 'textDim')} />
            <C.HW_ReadValue>{view.name}</C.HW_ReadValue>
          </Pressable>
          <C.HW_MiniVerb onPress={() => handlers.onRemove(view.id)} tooltip="Remove this view">
            <Icon name="Trash2" size={11} color={accentFor('textDim')} />
          </C.HW_MiniVerb>
        </Row>
      ))}
    </C.HW_Section>
  );
}

// The FOCUS PANEL's pane-switch rail — the fixed 40px icon column on the
// panel's right edge (REGIONS.focusPanel.railWidth). One component, every
// branch: the rail is part of the region, not of any one panel mode.
function FocusRail(props: {
  documentKind: WorkspaceDocumentKind;
  activePane: string;
  collapsed: boolean;
  onPane: (pane: RightPanelId) => void;
}) {
  const panes = rightPanelsFor(props.documentKind);
  const activePane = resolvedPanelId(panes, props.activePane);
  return (
    <C.HW_RightRail>
      {panes.map((pane) => {
        const active = activePane === pane.id;
        const Btn = active ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn
            key={pane.id}
            tooltip={active ? `${pane.label} — ${props.collapsed ? 'open panel' : 'collapse panel'}` : `Open ${pane.label}`}
            onPress={() => props.onPane(pane.id)}
          >
            <Icon name={pane.icon} size={14} color={accentFor(active ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
    </C.HW_RightRail>
  );
}

/**
 * AppFrame owns recovery coordination. When it supplies no contract, keep the
 * seam explicit: the pane is visible and truthful, but every unavailable
 * operation remains disabled and no component reaches for a host global.
 */
function unavailableBlobExplorerProps(modelId: string): BlobExplorerSurfaceProps {
  const detail = 'Recovery coordinator is unavailable in AppFrame.';
  return {
    modelId,
    widthPreset: 'compact',
    onWidthPreset: () => {},
    faceQuery: {
      source: 'resident',
      sort: { column: 'address', direction: 'asc' },
      filters: [],
      cursor: null,
      limit: 200,
    },
    facePage: null,
    faceError: { ok: false, version: 1, code: 'module_unavailable', detail },
    faceLoading: false,
    selectedAddress: null,
    selectedTriangles: null,
    onFaceQueryChange: () => {},
    onSelectFace: () => {},
    history: {
      loading: false,
      error: detail,
      rows: [],
      cursor: null,
      nextCursor: null,
      indexedRepair: 'not_needed',
    },
    recoverySnapshotEnabled: false,
    recoverySnapshotInFlight: false,
    recoverySnapshotStatus: detail,
    onRecoverySnapshot: () => {},
    onHistoryPage: () => {},
    onPin: () => {},
    onPreview: () => {},
    restoreEnabled: false,
    onRestore: () => {},
    service: {
      state: 'blocked',
      library: { available: false, version: null },
      repository: { ready: false, path: 'unavailable', revision: null },
      service: {
        healthy: false,
        healthUrl: 'unavailable',
        httpCode: null,
        unitName: 'unavailable',
        active: false,
        enabled: false,
        journalTail: [detail],
        restoreCommands: [],
      },
      stores: { snapshotRoot: 'unavailable', localBytes: 0, serverBytes: null },
      retention: {
        days: 60,
        nowMs: 0,
        lastPruneMs: null,
        nextPruneMs: null,
        immediatelyExpired: 0,
        localTombstones: 0,
        remotePendingTombstones: 0,
        logicallyRemovedEntries: 0,
        logicallyRemovedBytes: 0,
        physicallyReclaimedBytes: 0,
        remoteWatermark: null,
        legacyUnexpiredPending: 0,
        legacyCorruptPending: 0,
        legacyLayoutCutover: false,
        lastError: detail,
      },
      history: { pushed: 0, local: 0, unknown: 0 },
      probe: { lastCompletedMs: null, lastTransitionMs: null },
    },
  };
}

export default function Inspector(props: {
  state: EditorState;
  activeObject: WorldObject;
  activeAsset: Asset;
  onPane: (pane: RightPanelId) => void;
  onCollapse: () => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
  onModelBrush: (brush: Brush) => void;
  // Durable model identity (req_2620 S/T): the model card's editable name writes
  // through AppFrame's one rename path (manifest = disk truth); Save runs the same
  // 'save-snapshot' command as File → Save; onDisk feeds the save-state chip.
  onRenameModel: (id: string, name: string) => void;
  onSaveModel: () => void;
  /** Shoot the current viewport as this model's browser thumbnail (req_4044). */
  onStageThumbnail: () => void;
  /** Report an outcome on the shell status line (req_3894 — refusals must be seen). */
  onStatus: (message: string) => void;
  /** A real Remove happened: mint the capability that lets an emptied semantic
   *  table actually save (req_3898). */
  onSemanticRegionRemoved: () => void;
  modelOnDisk: boolean;
  // The RIG editor (req_2712/2713): pockets/placements/seats/cover/dynamics on
  // the open model; export compiles the draft into the manifest skeleton.
  onSetModelRig: (pkgId: string, rig: PropRig) => void;
  onSetModelTextureSlots: (pkgId: string, slots: ModelTextureSlot[]) => void;
  onSetModelLights: (pkgId: string, lights: LightRig[]) => void;
  onModelTextureMembershipChanged: (pkgId: string, message: string, dirty?: boolean) => void;
  /** Open the app-root live-material thumbnail picker for a texture slot (req_3401). */
  onOpenLiveMaterialPicker: (pkgId: string, slotIndex: number) => void;
  // World-piece focus-panel material edits — SELECTION-relative (req_3449):
  // the target piece resolves from live state at click time, never from a
  // render snapshot (the Pressable stale-closure law).
  onAssignSlot: (role: string) => void;
  onClearSlot: (role: string) => void;
  // World-piece instance edits (req_3442): the PIECE FOCUS placement/yaw/scale/
  // spin fields + verb row write through the same transaction commands as the
  // viewport gizmo and hotkeys — never a parallel mutation path.
  pieceEdit: PieceEditHandlers;
  // req_3446: the MATERIAL SLOTS `selected` row jumps the left panel to the
  // Materials library — the place the slot-bind material is actually picked.
  onBrowseMaterials: () => void;
  // Saved camera views (req_4168) — the world surface's VIEWS card.
  worldViews: WorldViewHandlers;
  // World-globals tuning (GLOBALS req_2770) — the playtest tab's focus panel.
  onSetGlobal: (field: string, value: number) => void;
  onResetGlobal: (field: string) => void;
  colorSpine: ColorSpineHandlers;
  outlinerHandlers: OutlinerHandlers;
  stagePartFocusEnabled: boolean;
  onToggleStagePartFocus: () => void;
  // The outliner multi-select set (req_2659) — row highlights + the UV '+N' header.
  // AppFrame owns it (shell-local, not EditorState); primary stays modelActivePartId.
  selectedPartIds: string[];
  characterRigApi: CharacterRigApi | null;
  characterRigSnapshot: CharacterRigSnapshot | null;
  onCharacterRigSnapshot: (snapshot: CharacterRigSnapshot) => void;
  onCharacterRigMutated: () => void;
  onSelectCharacterRigFaces: (indices: readonly number[]) => number;
  onAssignHumanoidSemantic: (membership: HumanoidSemanticMembership) => void;
  onAttachCharacterRig: (pkgId: string) => void;
  /** AppFrame-owned, already-parsed recovery state and explicit callbacks. */
  blobExplorer?: BlobExplorerSurfaceProps;
}) {
  // Subscribed unconditionally (hook order) — only the MODEL FOCUS branch reads it.
  const focusBridge = useModelFocusBridge();
  const [uvWorkspaceFocused, setUvWorkspaceFocused] = useState(false);
  const [uvPanelWidths, setUvPanelWidths] = useState({
    panel: REGIONS.focusPanel.atlasWidth,
    focus: REGIONS.focusPanel.atlasFocusWidth,
  });
  const [uvPanelResizing, setUvPanelResizing] = useState(false);
  const uvResizeGestureRef = useRef<null | { mode: 'panel' | 'focus'; startX: number; startWidth: number; viewportWidth: number }>(null);
  const pendingUvWidthRef = useRef<null | { mode: 'panel' | 'focus'; width: number }>(null);
  const uvResizeFramePendingRef = useRef(false);
  const uvResizeGenerationRef = useRef(0);
  const uvWidthMode = uvWorkspaceFocused ? 'focus' : 'panel';
  const uvWorkspace = uvWorkspaceLayout(uvWorkspaceFocused, uvPanelWidths[uvWidthMode]);
  const host = globalThis as any;
  const pointerX = (event: any): number => {
    const eventX = Number(event?.x);
    if (Number.isFinite(eventX)) return eventX;
    const hostX = Number(host.getMouseX?.());
    return Number.isFinite(hostX) ? hostX : 0;
  };
  const applyUvPanelWidth = (mode: 'panel' | 'focus', width: number) => {
    setUvPanelWidths((current) => current[mode] === width ? current : { ...current, [mode]: width });
  };
  const queueUvPanelWidth = (mode: 'panel' | 'focus', width: number) => {
    pendingUvWidthRef.current = { mode, width };
    if (uvResizeFramePendingRef.current) return;
    uvResizeFramePendingRef.current = true;
    const generation = uvResizeGenerationRef.current;
    const schedule: (callback: () => void) => unknown = typeof host.requestAnimationFrame === 'function'
      ? host.requestAnimationFrame.bind(host)
      : (callback) => setTimeout(callback, REGIONS.focusPanel.resizePreviewIntervalMs);
    schedule(() => {
      if (generation !== uvResizeGenerationRef.current) return;
      uvResizeFramePendingRef.current = false;
      const pending = pendingUvWidthRef.current;
      pendingUvWidthRef.current = null;
      if (pending) applyUvPanelWidth(pending.mode, pending.width);
    });
  };
  const beginUvPanelResize = (event: any) => {
    const reportedViewportWidth = Number(host.__viewport_width?.());
    const viewportWidth = Number.isFinite(reportedViewportWidth) && reportedViewportWidth > 0
      ? reportedViewportWidth
      : REGIONS.focusPanel.resizeMaxWidth + REGIONS.focusPanel.minimumOutsideWidth;
    uvResizeGestureRef.current = {
      mode: uvWidthMode,
      startX: pointerX(event),
      startWidth: uvWorkspace.panelWidth,
      viewportWidth,
    };
    setUvPanelResizing(true);
  };
  const moveUvPanelResize = (event: any) => {
    const gesture = uvResizeGestureRef.current;
    if (!gesture) return;
    queueUvPanelWidth(gesture.mode, uvPanelWidthFromDrag(
      gesture.startWidth,
      gesture.startX,
      pointerX(event),
      gesture.viewportWidth,
    ));
  };
  const finishUvPanelResize = (event: any) => {
    const gesture = uvResizeGestureRef.current;
    uvResizeGestureRef.current = null;
    uvResizeGenerationRef.current += 1;
    uvResizeFramePendingRef.current = false;
    pendingUvWidthRef.current = null;
    if (gesture) {
      applyUvPanelWidth(gesture.mode, uvPanelWidthFromDrag(
        gesture.startWidth,
        gesture.startX,
        pointerX(event),
        gesture.viewportWidth,
      ));
    }
    setUvPanelResizing(false);
  };
  useEffect(() => () => {
    uvResizeGenerationRef.current += 1;
    uvResizeGestureRef.current = null;
    pendingUvWidthRef.current = null;
  }, []);
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId);
  // EFFECTIVE package (req_2620 S): session renames + dupes resolve here, so the
  // card shows the name the next save writes — never a stale synthesized one.
  const activeModel = activeDocument?.kind === 'model'
    ? effectiveModelPackage(activeDocument.sourceId, props.state.modelOverrides, props.state.modelDupes)
    : null;
  const activeCommand = commandById(props.state.activeCommandId);
  const documentKind = activeDocument?.kind ?? 'world';
  const activePane = resolvedPanelId(rightPanelsFor(documentKind), props.state.rightPane);
  // Focus belongs to one model's Paint pane. Leaving that context makes the
  // next Paint visit predictable instead of reviving a workspace from another
  // document or panel.
  useEffect(() => {
    setUvWorkspaceFocused(false);
  }, [activeDocument?.id, activePane]);
  useEffect(() => {
    const publish = props.blobExplorer?.onViewportFaceSelection;
    if (!publish || activePane !== 'recovery' || !activeModel || !focusBridge) return;
    publish(blobViewportFaceSelection(
      focusBridge.readSelection(),
      props.state.modelParts[activeModel.id] ?? [],
    ));
  }, [focusBridge, activePane, activeModel?.id, props.state.modelParts, props.blobExplorer?.modelId]);
  // Collapse removes only the body. The rail remains at the stage edge so the
  // same active button can restore it without a separate hidden affordance.
  if (props.state.rightPanelCollapsed) {
    return <FocusRail documentKind={documentKind} activePane={activePane} collapsed onPane={props.onPane} />;
  }
  const pathRows = props.activeObject.kind === 'TILE'
    ? [
      ['walkable', '—'],
      ['surface preset', props.state.surfacePreset],
      ['floor', FLOORS[props.state.floorIndex]!],
    ]
    : props.activeObject.kind === 'PIECE' || props.activeObject.kind === 'PREFAB'
      ? [
        ['collision', 'solid'],
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['floor', FLOORS[props.state.floorIndex]!],
      ]
      : [
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['placement', props.activeObject.kind.toLowerCase()],
        ['floor', FLOORS[props.state.floorIndex]!],
      ];
  const visibilityRows = props.activeObject.kind === 'PROP'
    ? [
      ['occlusion', '—'],
      ['bake', '—'],
      ['channel', props.activeObject.kind.toLowerCase()],
    ]
    : [
      ['conceal', '—'],
      ['lightThru', '—'],
      ['soundOcc', '—'],
    ];
  // Playtest surface (GLOBALS req_2770): the focus panel IS the globals editor —
  // tune a field, the playtest viewport pushes it live, the micro-save locks it in.
  if (activeDocument?.kind === 'playtest') {
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>GLOBALS · PHYSICS</C.HW_Kicker>
            <C.HW_Spacer />
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <GlobalsSection
              physics={props.state.worldGlobals.physics}
              onSet={props.onSetGlobal}
              onReset={props.onResetGlobal}
            />
            <GcStressSection />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  // World surface (req_2563): the focus panel is PIECE-aware — the real placed
  // piece (Select/Focus) or the armed catalog piece (Build), NOT the phantom
  // `objects` mock. This is what retires the "AC & Vents" ghost header.
  if (activeDocument?.kind === 'world') {
    const selectedPiece = props.state.worldPieces.find((p) => p.id === props.state.selectedPieceId) ?? null;
    const resolveMaterial = (ref: MaterialRef) => resolveMaterialRef(ref, props.state.assetOverrides);
    const activeMaterialAsset = assetById(props.state.activeAssetId, props.state.assetOverrides);
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{selectedPiece ? 'PIECE FOCUS' : 'BUILD'}</C.HW_Kicker>
            <C.HW_Spacer />
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <PieceBody
              armedPieceId={props.state.armedPieceId}
              selected={selectedPiece}
              onAssignSlot={props.onAssignSlot}
              onClearSlot={props.onClearSlot}
              resolveMaterial={resolveMaterial}
              activeMaterial={{ name: activeMaterialAsset.name, color: activeMaterialAsset.color }}
              onBrowseMaterials={props.onBrowseMaterials}
              edit={props.pieceEdit}
              // Session renames/dupes resolve here so the model row names what
              // the library shows NOW, not a stale synthesized id.
              modelNameFor={(pkgId) => effectiveModelPackage(pkgId, props.state.modelOverrides, props.state.modelDupes)?.name ?? null}
            />
            <WorldViewsSection handlers={props.worldViews} />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  if (activeModel) {
    const blobExplorer = props.blobExplorer?.modelId === activeModel.id
      ? props.blobExplorer
      : unavailableBlobExplorerProps(activeModel.id);
    const quickRecoveryEnabled = blobExplorer.recoverySnapshotEnabled && !blobExplorer.recoverySnapshotInFlight;
    const quickRecoverySnapshot = () => blobExplorer.onRecoverySnapshot({
      kind: 'panic',
      label: 'Manual recovery snapshot',
      push: false,
    });
    const hasCharacterRig = hasCharacterRigCapability(activeModel);
    const residentHumanoidSemanticRoles = (focusBridge?.semantics.rows ?? [])
      .filter((row) => row.presence === 'resident' || row.presence === 'not-visible')
      .map((row) => row.role)
      .filter((role) => role.length > 0);
    const modelDirty = Boolean(props.state.modelDirty[activeModel.id]);
    // The ACTIVE outliner part labels the UV section header (req_2619 P): the UV read
    // is per-outliner even while the atlas storage stays whole-model.
    const modelParts = props.state.modelParts[activeModel.id];
    const activePart = modelParts?.find((p) => p.id === props.state.modelActivePartId) ?? null;
    const uvPartName = activePart?.name ?? activeModel.name;
    // Multi-select (req_2659): the set pruned to live rows; extras beyond the primary
    // surface as '+N' in the UV header, and every member's row highlights.
    const selectedSet = (props.selectedPartIds ?? []).filter((sid) => modelParts?.some((p) => p.id === sid));
    const uvExtraCount = activePart ? Math.max(0, selectedSet.filter((sid) => sid !== activePart.id).length) : 0;
    // Save-state chip (req_2620 T): loud until the model is a real directory on
    // disk AND clean since the last materialize. One line, fixed rows — the name
    // field and the save row sit on the region's standard control grid
    // (REGIONS.grid.labelWidth label + REGIONS.grid.verbColWidth verb).
    const saveChip = !props.modelOnDisk ? 'NOT ON DISK' : modelDirty ? 'UNSAVED EDITS' : 'ON DISK';
    const saveChipTone = props.modelOnDisk && !modelDirty ? 'success' : 'warning';
    const paneTitle = activePane === 'paint' ? uvWorkspace.panelTitle
      : activePane === 'rig' ? (hasCharacterRig ? 'CHARACTER · RIG' : 'MODEL · RIG')
        : activePane === 'names' ? 'MODEL · NAMES'
          : activePane === 'recovery' ? 'MODEL · RECOVERY'
            : 'MODEL FOCUS';
    return (
      <C.HW_RightPanel style={{ width: activePane === 'paint'
        ? uvWorkspace.panelWidth
        : activePane === 'rig' && hasCharacterRig
          ? REGIONS.focusPanel.characterRigWidth
          : activePane === 'recovery'
            ? blobExplorer.widthPreset === 'wide'
              ? REGIONS.focusPanel.blobWideWidth
              : REGIONS.focusPanel.blobCompactWidth
            : REGIONS.focusPanel.width }}>
        {activePane === 'paint' ? (
          <C.HW_RightResizeGrip
            tooltip="Drag to resize the UV workspace"
            onMouseDown={beginUvPanelResize}
            onMouseMove={moveUvPanelResize}
            onMouseUp={finishUvPanelResize}
            style={uvPanelResizing ? { backgroundColor: accentFor('segActiveBg') } : undefined}
          >
            <C.HW_RightResizeLine />
          </C.HW_RightResizeGrip>
        ) : null}
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{paneTitle}</C.HW_Kicker>
            <C.HW_Spacer />
            {activePane === 'paint' && uvWorkspace.focused ? (
              <>
                <C.HW_PanelHeadButton tooltip="Capture native-resident recovery snapshot (does not invoke Save)" onPress={quickRecoveryEnabled ? quickRecoverySnapshot : undefined}>
                  <Icon name="DatabaseBackup" size={12} color={accentFor(quickRecoveryEnabled ? 'warning' : 'textFaint')} />
                </C.HW_PanelHeadButton>
                <C.HW_PanelHeadButton tooltip={`Save ${activeModel.name}`} onPress={props.onSaveModel}>
                  <Icon name="Save" size={12} color={accentFor(modelDirty ? 'warning' : 'textFaint')} />
                </C.HW_PanelHeadButton>
              </>
            ) : null}
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          {/* Each model pane remains a fixed column of budgeted slices (req_2627).
              Lists carry their own bounded scrolling; switching panes replaces the
              body instead of stacking every authoring concern into one column. */}
          <C.HW_InspectorBodyFixed style={activePane === 'recovery'
            ? { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, gap: 0 }
            : {}}>
            {/* Identity + save state stay present across Model/Paint/Rig. UV Focus
                replaces the tall rows with the compact header save verb above. */}
            {activePane !== 'recovery' && (uvWorkspace.showIdentity || activePane !== 'paint') ? (
              <>
                <C.HW_RenameBar>
                  <C.HW_FormLabel>name</C.HW_FormLabel>
                  <C.HW_RenameInput value={activeModel.name} onChange={(name: string) => props.onRenameModel(activeModel.id, name)} />
                </C.HW_RenameBar>
                <C.HW_RenameBar>
                  <C.HW_Tag
                    tooltip={modelDirty ? 'Changes are not on disk yet. This is save state only; it does not disable editing.' : 'The model on disk matches the live editor.'}
                    style={{ backgroundColor: accentFor(saveChipTone) }}
                  >
                    <C.HW_TagText>{saveChip}</C.HW_TagText>
                  </C.HW_Tag>
                  <C.HW_Spacer />
                  <C.HW_VerbFixed tooltip="Capture the native-resident mesh without invoking Save" onPress={quickRecoveryEnabled ? quickRecoverySnapshot : undefined}>
                    <Icon name="DatabaseBackup" size={12} color={accentFor(quickRecoveryEnabled ? 'warning' : 'textFaint')} />
                    <C.HW_VerbText>Recover</C.HW_VerbText>
                  </C.HW_VerbFixed>
                  <C.HW_VerbFixed onPress={props.onSaveModel}>
                    <Icon name="Save" size={12} color={accentFor('textDim')} />
                    <C.HW_VerbText>Save</C.HW_VerbText>
                  </C.HW_VerbFixed>
                </C.HW_RenameBar>
              </>
            ) : null}
            {activePane === 'recovery' ? (
              <BlobExplorerSurface {...blobExplorer} />
            ) : activePane === 'inspector' ? (
              <>
                <ModelDetailBody
                  model={activeModel}
                  onStageThumbnail={props.modelOnDisk ? props.onStageThumbnail : undefined}
                />
                <SelectionSection
                  selection={focusBridge?.readSelection() ?? null}
                  semantics={focusBridge?.semantics ?? null}
                />
                <ShapeSection
                  shape={focusBridge?.shape ?? null}
                  onSelectAudit={(kind) => focusBridge?.selectAuditFaces(kind)}
                />
                {focusBridge ? (
                  <SemanticsSection
                    semantics={focusBridge.semantics}
                    onRefresh={focusBridge.refreshSemantics}
                    onOpenNames={() => props.onPane('names')}
                  />
                ) : null}
                {/* The OUTLINER is geometry/selection focus, not rig or paint state. */}
                {modelParts ? (
                  <ModelOutliner
                    parts={modelParts}
                    activeId={props.state.modelActivePartId}
                    selectedIds={selectedSet}
                    stageFocusEnabled={props.stagePartFocusEnabled}
                    onToggleStageFocus={props.onToggleStagePartFocus}
                    onSelect={props.outlinerHandlers.onSelectPart}
                    onFocusSelectionOwner={props.outlinerHandlers.onFocusSelectionOwner}
                    onRename={props.outlinerHandlers.onRenamePart}
                    onToggleVisible={props.outlinerHandlers.onToggleVisiblePart}
                    onDuplicate={props.outlinerHandlers.onDuplicatePart}
                    onDelete={props.outlinerHandlers.onDeletePart}
                    onSelectGroup={props.outlinerHandlers.onSelectPartGroup}
                    onRenameGroup={props.outlinerHandlers.onRenamePartGroup}
                    onToggleVisibleGroup={props.outlinerHandlers.onToggleVisiblePartGroup}
                    onDuplicateGroup={props.outlinerHandlers.onDuplicatePartGroup}
                    onDissolveGroup={props.outlinerHandlers.onDissolvePartGroup}
                    onGroupSelected={props.outlinerHandlers.onGroupSelectedParts}
                    onUngroupSelected={props.outlinerHandlers.onUngroupSelectedParts}
                    onMoveItem={props.outlinerHandlers.onMoveOutlinerItem}
                    onAdd={props.outlinerHandlers.onAddPart}
                    onImportModel={props.outlinerHandlers.onImportModel}
                    roleNamer={activeModel.kind === 'vehicle' ? props.outlinerHandlers.roleNamer : null}
                    onStartRoleNamer={activeModel.kind === 'vehicle' ? props.outlinerHandlers.onStartRoleNamer : undefined}
                    onSkipRole={props.outlinerHandlers.onSkipRole}
                    onCancelRoleNamer={props.outlinerHandlers.onCancelRoleNamer}
                  />
                ) : null}
                <ViewBookmarksSection bridge={focusBridge} />
              </>
            ) : activePane === 'paint' ? (
              <>
                <UvSection
                  bridge={focusBridge}
                  partName={uvPartName}
                  extraCount={uvExtraCount}
                  workspace={uvWorkspace}
                  onToggleFocus={() => setUvWorkspaceFocused((value) => !value)}
                />
                <ModelPaintVariants key={activeModel.id} model={activeModel} bridge={focusBridge} hidden={!uvWorkspace.showPaintVariants} />
              </>
            ) : activePane === 'names' ? (
              <NamesPanel
                semantics={focusBridge?.semantics ?? null}
                bridge={focusBridge}
                onRefresh={() => focusBridge?.refreshSemantics()}
                onStatus={props.onStatus}
                onRegionRemoved={props.onSemanticRegionRemoved}
              />
            ) : hasCharacterRig ? (
              <CharacterRigSection
                api={props.characterRigApi}
                snapshot={props.characterRigSnapshot}
                onSnapshot={props.onCharacterRigSnapshot}
                onStatus={props.onStatus}
                onMutated={props.onCharacterRigMutated}
                onSelectDetachedFaces={props.onSelectCharacterRigFaces}
                semanticRoleKeys={residentHumanoidSemanticRoles}
                onAssignSemanticRole={props.onAssignHumanoidSemantic}
              />
            ) : (
              <>
                <C.HW_RigSection>
                  <C.HW_SectionHead>
                    <C.HW_AccentBar style={{ backgroundColor: accentFor('active') }} />
                    <C.HW_SectionTitle>CHARACTER RIGGING</C.HW_SectionTitle>
                  </C.HW_SectionHead>
                  <C.HW_RigNotice>
                    <C.HW_RigNoticeLabel>OPTIONAL CAPABILITY</C.HW_RigNoticeLabel>
                    <C.HW_RigWrapText>
                      Attach the canonical humanoid skeleton to this model without replacing its geometry or changing its model category. Choose Player or NPC only when exporting.
                    </C.HW_RigWrapText>
                  </C.HW_RigNotice>
                  <C.HW_ButtonRow>
                    <C.HW_VerbPrimary tooltip="keep this mesh and add the independent humanoid bind skeleton" onPress={() => props.onAttachCharacterRig(activeModel.id)}>
                      <C.HW_VerbText>Add Humanoid Rig</C.HW_VerbText>
                    </C.HW_VerbPrimary>
                  </C.HW_ButtonRow>
                </C.HW_RigSection>
                <RigSection
                  rig={props.state.modelRigs[activeModel.id] ?? (activeModel.skeleton ? skeletonToPropRig(activeModel.skeleton) : {})}
                  onChange={(rig) => props.onSetModelRig(activeModel.id, rig)}
                  textureSlots={props.state.modelTextureSlots[activeModel.id] ?? activeModel.textureSlots ?? []}
                  onTextureSlotsChange={(slots) => props.onSetModelTextureSlots(activeModel.id, slots)}
                  onTextureMembershipChanged={(message, dirty) => props.onModelTextureMembershipChanged(activeModel.id, message, dirty)}
                  onPickLiveMaterial={(slotIndex) => props.onOpenLiveMaterialPicker(activeModel.id, slotIndex)}
                  lights={props.state.modelLights[activeModel.id] ?? activeModel.lights ?? []}
                  onLightsChange={(lights) => props.onSetModelLights(activeModel.id, lights)}
                />
              </>
            )}
          </C.HW_InspectorBodyFixed>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  return (
    <C.HW_RightPanel>
      <C.HW_Inspector>
        <C.HW_PanelHead>
          <C.HW_Kicker>{`${documentKind.toUpperCase()} FOCUS`}</C.HW_Kicker>
          <C.HW_Spacer />
          <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHeadButton>
        </C.HW_PanelHead>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>{props.activeObject.kind}</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>{props.activeObject.name}</C.HW_ObjectTitle>
          <C.HW_Spacer />
          <C.HW_Swatch style={{ backgroundColor: props.activeAsset.color }} />
        </C.HW_ObjectHead>
        <C.HW_MetricRow>
          {objectMetricRows(props.state, props.activeObject).map(([label, value]) => (
            <C.HW_Metric key={label}>
              <C.HW_MetricValue>{value}</C.HW_MetricValue>
              <C.HW_MetricLabel>{label}</C.HW_MetricLabel>
            </C.HW_Metric>
          ))}
        </C.HW_MetricRow>
        <ReadOnlySection title={`${props.activeObject.kind} FACTS`} color="primary" rows={[
          ['asset', props.activeAsset.name],
          ['tool', activeCommand.name],
          ['key', activeCommand.key],
        ]} />
        {props.activeObject.kind === 'TILE' ? (
          <PresetSection
            title="SURFACE DEFAULTS"
            color="warning"
            active={props.state.surfacePreset}
            options={PRESETS}
            open={props.state.presetMenuOpen}
            onPreset={props.onPreset}
            onOption={props.onPresetOption}
            rows={[
              ['actual friction', '—'],
              ['actual speed factor', '—'],
            ]}
          />
        ) : null}
        <ReadOnlySection title="PLACEMENT" color="primary" rows={pathRows} />
        <ReadOnlySection title="VISIBILITY" color="primary" rows={visibilityRows} />
      </C.HW_Inspector>
      <FocusRail documentKind={documentKind} activePane={activePane} collapsed={false} onPane={props.onPane} />
    </C.HW_RightPanel>
  );
}
