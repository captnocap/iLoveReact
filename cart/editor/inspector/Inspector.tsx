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
import { assetById, resolveMaterialRef } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import RigSection from './RigSection';
import { skeletonToPropRig, type PropRig } from '../../../runtime/skeleton';
import PieceBody, { type PieceEditHandlers } from './PieceBody';
import GlobalsSection from './GlobalsSection';
import GcStressSection from './GcStressSection';
import PresetSection from './PresetSection';
import ModelDetailBody from '../library/ModelDetailBody';
import ModelPaintVariants from '../library/ModelPaintVariants';
import type { ColorSpineHandlers } from './ModelBrushDock';
import ModelOutliner from '../stage/ModelOutliner';
import type { OutlinerHandlers } from '../stage/ModelDocumentSurface';
import type { Brush } from '../../../runtime/paint/model';
import UvEditor from './UvEditor';
import { uvPanelWidthFromDrag, uvWorkspaceLayout, type UvWorkspaceLayout } from './uvWorkspace';
import type { LightRig } from '../model/editMesh';
import type { ModelFocusSemantics } from '../model/modelSemanticsFocus';

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

// SHAPE — the old studio's count strip (req_2618 G): verts/faces/edges/uv'd/mounts as
// five labeled numbers on ONE grid row, plus the bounds line. Everything shown is
// already real cart-side (surface-vs-mock ruling): verts/edges come from the host
// counts door and read '—' until it builds topology (vertex/edge mode) — never 0-faked;
// uv'd is faces-with-atlas (whole-model atlas covers all once it exists); mounts is an
// honest 0 until the rig slice lands.
function ShapeSection({ shape }: { shape: ModelFocusShape | null }) {
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
      />
      <GeometryFactRow
        label="unreachable"
        shape={shape}
        count={shape?.unreachable ?? 0}
        detail="tris no camera can see"
      />
    </C.HW_Section>
  );
}

// The two hard geometry facts, in the panel so a disaster is visible without going to
// look for it (req_3750). Tinted only when the count is real: an over-budget mesh reads
// "not measured", never a clean zero it did not earn.
function GeometryFactRow(
  { label, shape, count, detail }: { label: string; shape: ModelFocusShape | null; count: number; detail: string },
) {
  const value = !shape ? '—'
    : !shape.audited ? 'not measured'
      : count === 0 ? `0 · ${detail}`
        : `${fmtCount(count)} · ${detail}`;
  const tone = shape?.audited && count > 0 ? 'warning' : 'textDim';
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{label}</C.HW_FormLabel>
      <C.HW_ReadValue style={{ color: accentFor(tone) }}>{value}</C.HW_ReadValue>
    </C.HW_ReadRow>
  );
}

function SemanticsSection({ semantics, onRefresh }: { semantics: ModelFocusSemantics; onRefresh: () => void }) {
  const statusLabel = semantics.status === 'healthy' ? 'RESIDENT'
    : semantics.status === 'visibility-filtered' ? 'HIDDEN PARTS'
    : semantics.status === 'mount-mismatch' ? 'MOUNT DROP'
    : semantics.status === 'load-mismatch' ? 'LOAD MISMATCH'
      : semantics.status === 'resident-only' ? 'LIVE ONLY'
        : 'NO NAMES';
  const statusTone = semantics.status === 'healthy' || semantics.status === 'visibility-filtered' ? 'success'
    : semantics.status === 'load-mismatch' || semantics.status === 'mount-mismatch' ? 'warning'
      : 'textFaint';
  const listHeight = Math.min(6, semantics.rows.length) * REGIONS.grid.rowHeight;
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
      <C.HW_ReadRow>
        <C.HW_FormLabel>saved blob</C.HW_FormLabel>
        <C.HW_ReadValue>{`${semantics.savedRegions} regions · ${semantics.savedNamedFaces}/${semantics.savedFaces} faces`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>{`mount ${semantics.mountSource ?? ''}`}</C.HW_FormLabel>
        <C.HW_ReadValue>{`${semantics.mountRegions} regions · ${semantics.mountNamedFaces}/${semantics.mountFaces} faces`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>resident</C.HW_FormLabel>
        <C.HW_ReadValue>{`${semantics.residentRegions} regions · ${semantics.residentNamedFaces}/${semantics.residentFaces} faces${semantics.residentHiddenFaces > 0 ? ` · ${semantics.residentHiddenNamedFaces}/${semantics.residentHiddenFaces} hidden` : ''}`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      {semantics.status === 'mount-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>saved names exist; viewport input dropped them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'load-mismatch' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>saved names exist; native hydration lost them</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : semantics.status === 'visibility-filtered' ? (
        <C.HW_ReadRow>
          <C.HW_FormLabel>diagnosis</C.HW_FormLabel>
          <C.HW_ReadValue>hidden parts are excluded from the viewport; saved semantics remain intact</C.HW_ReadValue>
        </C.HW_ReadRow>
      ) : null}
      {semantics.rows.length > 0 ? (
        <ScrollView style={{ width: '100%', height: listHeight }} showScrollbar>
          {semantics.rows.map((row) => (
            <C.HW_ReadRow key={`semantic-${row.id}`}>
              <C.HW_FormLabel>{row.presence === 'resident' ? `${row.faces}f · ${row.instances}x` : row.presence === 'not-visible' ? 'not visible' : row.presence === 'mount-only' ? 'mount only' : 'saved only'}</C.HW_FormLabel>
              <C.HW_ReadValue>{`${row.parent === null ? '' : '↳ '}${row.name}${row.role ? ` · ${row.role}` : ''}`}</C.HW_ReadValue>
            </C.HW_ReadRow>
          ))}
        </ScrollView>
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
    <C.HW_Section style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
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
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail documentKind={documentKind} activePane={activePane} collapsed={false} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  if (activeModel) {
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
    const paneTitle = activePane === 'paint' ? uvWorkspace.panelTitle : activePane === 'rig' ? 'MODEL · RIG' : 'MODEL FOCUS';
    return (
      <C.HW_RightPanel style={{ width: activePane === 'paint'
        ? uvWorkspace.panelWidth
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
              <C.HW_PanelHeadButton tooltip={`Save ${activeModel.name}`} onPress={props.onSaveModel}>
                <Icon name="Save" size={12} color={accentFor(modelDirty ? 'warning' : 'textFaint')} />
              </C.HW_PanelHeadButton>
            ) : null}
            <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
              <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
            </C.HW_PanelHeadButton>
          </C.HW_PanelHead>
          {/* Each model pane remains a fixed column of budgeted slices (req_2627).
              Lists carry their own bounded scrolling; switching panes replaces the
              body instead of stacking every authoring concern into one column. */}
          <C.HW_InspectorBodyFixed>
            {/* Identity + save state stay present across Model/Paint/Rig. UV Focus
                replaces the tall rows with the compact header save verb above. */}
            {uvWorkspace.showIdentity || activePane !== 'paint' ? (
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
                  <C.HW_VerbFixed onPress={props.onSaveModel}>
                    <Icon name="Save" size={12} color={accentFor('textDim')} />
                    <C.HW_VerbText>Save</C.HW_VerbText>
                  </C.HW_VerbFixed>
                </C.HW_RenameBar>
              </>
            ) : null}
            {activePane === 'inspector' ? (
              <>
                <ModelDetailBody model={activeModel} />
                <ShapeSection shape={focusBridge?.shape ?? null} />
                {focusBridge ? (
                  <SemanticsSection semantics={focusBridge.semantics} onRefresh={focusBridge.refreshSemantics} />
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
                    roleNamer={props.outlinerHandlers.roleNamer}
                    onStartRoleNamer={props.outlinerHandlers.onStartRoleNamer}
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
            ) : (
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
