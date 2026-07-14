// SECTION G — Focus Panel (see shell/regions.ts SECTIONS): the right panel
// (inspector / layers / grid) + its pane-switch rail.
import { useEffect, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
// Fixed-region contract (req_2627): the UV preview sizes itself from the focus
// panel's CONSTANT inner width — imported, never measured.
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge, ModelFocusShape } from '../stage/ModelView';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, RIGHT_PANES, SNAP_MODES, effectiveModelPackage } from '../data/content';
import { objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, WorldObject } from '../data/types';
import type { MaterialRef } from '../world/pieces';
import { assetById, resolveMaterialRef } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import RigSection from './RigSection';
import { skeletonToPropRig, type PropRig } from '../../../runtime/skeleton';
import PieceBody from './PieceBody';
import GlobalsSection from './GlobalsSection';
import PresetSection from './PresetSection';
import ModelDetailBody from '../library/ModelDetailBody';
import ModelBrushDock, { type ColorSpineHandlers } from './ModelBrushDock';
import ModelOutliner from '../stage/ModelOutliner';
import type { OutlinerHandlers } from '../stage/ModelDocumentSurface';
import type { Brush } from '../../../runtime/paint/model';

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

// UV preview space inside the FIXED focus panel (req_2627: content imports its space):
// the section's 12px gutters come off the panel's constant inner width; height is
// BOUNDED so the non-scrolling model-focus body keeps its other slices on screen.
const UV_IMG_W = REGIONS.focusPanel.innerWidth - 24;
const UV_IMG_MAX_H = 170;

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
    </C.HW_Section>
  );
}

// UV — the atlas section relocated INTO the focus panel from the floating viewport
// card (req_2643 OO). The header carries the active OUTLINER part's name (req_2619 P:
// the UV read is per-outliner even while storage stays whole-model) plus the dims/
// density readout on one line; the refresh verb is a fallback, never REQUIRED (the
// viewer auto-refreshes off adoptMesh/applyTopo/stroke-end while paint is live).
// __model_atlas_read now emits per-island GROUP ids (req_2619 P), so the preview
// FILTERS to the active part: its islands full-strength, every other island dimmed
// (the viewer bakes the dim at read time from __modelActivePartRange). The scope row
// reads whichever state is actually shown — uv.scope is set by the same bake.
// extraCount is the multi-select overflow (req_2659d): 'CUBE 1 +2' = primary + 2 more.
function UvSection({ bridge, partName, extraCount }: { bridge: ModelFocusBridge | null; partName: string; extraCount: number }) {
  const uv = bridge?.uv ?? null;
  const scale = uv && uv.src ? Math.min(UV_IMG_W / Math.max(1, uv.w), UV_IMG_MAX_H / Math.max(1, uv.h)) : 0;
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>{`UV · ${partName.toUpperCase()}${extraCount > 0 ? ` +${extraCount}` : ''}`}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_ReadValue>{uv ? `${uv.w}×${uv.h} · ${uv.detail} x/m` : '—'}</C.HW_ReadValue>
        <C.HW_MiniVerb onPress={() => bridge?.refreshUv()} tooltip="Re-read the live paint atlas">
          <Icon name="RefreshCw" size={10} color={accentFor('textDim')} />
        </C.HW_MiniVerb>
      </C.HW_SectionHead>
      {uv && uv.src ? (
        <C.HW_UvFrame style={{ width: Math.max(24, Math.round(uv.w * scale)), height: Math.max(24, Math.round(uv.h * scale)) }}>
          <C.HW_UvImage src={uv.src} />
        </C.HW_UvFrame>
      ) : uv ? (
        <C.HW_ReadRow>
          <C.HW_UvNote>{uv.note ?? 'no atlas'}</C.HW_UvNote>
        </C.HW_ReadRow>
      ) : (
        <C.HW_ReadRow>
          <C.HW_FormLabel>atlas</C.HW_FormLabel>
          <C.HW_ReadValue>none — created on first Paint</C.HW_ReadValue>
        </C.HW_ReadRow>
      )}
      <C.HW_ReadRow>
        <C.HW_FormLabel>scope</C.HW_FormLabel>
        <C.HW_ReadValue>{uv?.scope ?? 'whole model'}</C.HW_ReadValue>
      </C.HW_ReadRow>
    </C.HW_Section>
  );
}

// ── PAINT LAYERS (req_2672) ─────────────────────────────────────────────────────────
// The stroke program's LAYER table (host truth: __mesh_paint_layers). A layer is an
// ordered stroke GROUP — visibility/reorder/delete/merge are program edits + one host
// replay, never a pixel compositor. Shown whenever the doc HAS paint (the host reports
// layers once anything recorded), not only during paint mode. Rows sit on the regions
// grid: fixed height, eye column, flexing name (the ACTIVE row's name is the rename
// input — the existing rename-input pattern), fixed verb columns at the right edge.
// The list is a bounded nested scroll capped at LAYER_ROWS_VISIBLE rows (req_2627).
const LAYER_ROW_HEIGHT = 27;
const LAYER_ROWS_VISIBLE = 5;

const LAYER_ROW_CONTROL = {
  width: REGIONS.grid.stepBtn, height: LAYER_ROW_HEIGHT,
  alignItems: 'center', justifyContent: 'center',
} as const;

type PaintLayerRow = { id: number; name: string; visible: number; strokes: number };
type PaintLayersSnap = { active: number; layers: PaintLayerRow[] };

function readPaintLayers(): PaintLayersSnap | null {
  try {
    const j = (globalThis as any).__mesh_paint_layers?.();
    if (typeof j !== 'string' || !j) return null;
    const o = JSON.parse(j);
    if (o?.ok !== 1 || !Array.isArray(o.layers)) return null;
    return { active: (o.active ?? 0) | 0, layers: o.layers as PaintLayerRow[] };
  } catch { return null; }
}

function PaintLayersSection({ bridge, onDocumentMutated }: { bridge: ModelFocusBridge | null; onDocumentMutated: () => void }) {
  const [snap, setSnap] = useState<PaintLayersSnap | null>(() => readPaintLayers());
  const [hint, setHint] = useState<string | null>(null);
  // Host-driven state (strokes/undo land without a React render) — poll at 1Hz like the
  // dock's journal badge, plus a re-read on every focus-bridge ping (stroke end).
  useEffect(() => {
    const read = () => {
      const next = readPaintLayers();
      setSnap((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [bridge]);
  // One door for every verb; the op returns the refreshed table so the panel updates in
  // the same call. A refused op re-reads (honest state, never a stale optimistic row).
  const runOp = (op: string, id: number, arg?: string | number): boolean => {
    try {
      const j = (globalThis as any).__mesh_paint_layer_op?.(op, id, arg ?? 0);
      if (typeof j === 'string' && j) {
        const o = JSON.parse(j);
        if (o?.ok === 1 && Array.isArray(o.layers)) {
          setSnap({ active: (o.active ?? 0) | 0, layers: o.layers as PaintLayerRow[] });
          if (op !== 'active' && op !== 'visible') onDocumentMutated();
          return true;
        }
      }
    } catch { /* fall through to the honest re-read */ }
    setSnap(readPaintLayers());
    return false;
  };
  if (!snap || snap.layers.length === 0) return null; // no paint yet — honest-empty, no section
  // Host order is bottom→top (composite order); the panel draws top layer FIRST, the
  // convention every layer panel shares.
  const rows = [...snap.layers].reverse();
  const listHeight = Math.min(rows.length, LAYER_ROWS_VISIBLE) * LAYER_ROW_HEIGHT;
  return (
    <Col
      style={{
        width: '100%', marginTop: 10,
        backgroundColor: 'rgba(12,14,20,0.55)', borderWidth: 1, borderColor: '#1d2330',
        borderRadius: 8, overflow: 'hidden',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, height: 30, backgroundColor: 'rgba(20,24,34,0.9)', borderBottomWidth: 1, borderColor: '#1d2330' }}>
        <Icon name="Layers" size={13} color="#8fb6c9" />
        <Text noWrap numberOfLines={1} style={{ color: '#cfe0f5', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>PAINT LAYERS</Text>
        <Box style={{ flexGrow: 1 }} />
        <Pressable
          onPress={() => { if (runOp('add', 0)) setHint('New layer added on top — new strokes land on it.'); }}
          tooltip="Add a layer on top (new strokes land on it)"
          style={{ height: 20, paddingLeft: 7, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 5, backgroundColor: '#16233aee', borderWidth: 1, borderColor: '#2c4a6a' }}
        >
          <Icon name="Plus" size={11} color="#cfe0f5" />
          <Text noWrap style={{ color: '#cfe0f5', fontSize: 10, fontWeight: 700 }}>layer</Text>
        </Pressable>
      </Row>
      <ScrollView style={{ height: listHeight }} contentContainerStyle={{ flexDirection: 'column' }}>
        {rows.map((layer) => {
          const active = layer.id === snap.active;
          return (
            <Row
              key={layer.id}
              style={{
                alignItems: 'center', gap: 4, paddingLeft: 5, paddingRight: 5, height: LAYER_ROW_HEIGHT,
                backgroundColor: active ? '#2a466e' : 'transparent',
                borderBottomWidth: 1, borderColor: '#161b26',
              }}
            >
              <Pressable
                style={LAYER_ROW_CONTROL}
                onPress={() => runOp('visible', layer.id, layer.visible ? 0 : 1)}
                tooltip={layer.visible ? 'Hide this layer\'s strokes' : 'Show this layer\'s strokes'}
              >
                <Icon name={layer.visible ? 'Eye' : 'EyeOff'} size={13} color={layer.visible ? '#9db4d0' : '#4a5464'} />
              </Pressable>
              {active ? (
                // The ACTIVE layer renames in place — the rename-input pattern (req_2620 S).
                <C.HW_RenameInput value={layer.name} onChange={(name: string) => runOp('rename', layer.id, name)} />
              ) : (
                <Pressable onPress={() => runOp('active', layer.id)} tooltip="Make this the active layer (new strokes land here)" style={{ flexGrow: 1, minWidth: 0, height: LAYER_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} noWrap style={{ color: layer.visible ? '#cfe0f5' : '#6b7686', fontSize: 12, fontWeight: 500 }}>{layer.name}</Text>
                </Pressable>
              )}
              <Text noWrap style={{ color: '#5d6878', fontSize: 10, fontFamily: 'monospace' }}>{String(layer.strokes)}</Text>
              <Pressable style={LAYER_ROW_CONTROL} onPress={() => runOp('up', layer.id)} tooltip="Move layer up (composites over)">
                <Icon name="ChevronUp" size={12} color="#6f8296" />
              </Pressable>
              <Pressable style={LAYER_ROW_CONTROL} onPress={() => runOp('down', layer.id)} tooltip="Move layer down (composites under)">
                <Icon name="ChevronDown" size={12} color="#6f8296" />
              </Pressable>
              <Pressable
                style={LAYER_ROW_CONTROL}
                onPress={() => { if (runOp('mergedown', layer.id)) setHint(`Merged ${layer.name} into the layer below (one undo step).`); else setHint('Nothing below to merge into.'); }}
                tooltip="Merge this layer's strokes into the layer below (undoable)"
              >
                <Icon name="GitMerge" size={12} color="#6f8296" />
              </Pressable>
              <Pressable
                style={LAYER_ROW_CONTROL}
                onPress={() => { if (runOp('delete', layer.id)) setHint(`Deleted ${layer.name} (${layer.strokes} strokes) — Ctrl+Z in paint restores it.`); }}
                tooltip="Delete this layer AND its strokes (one undoable step)"
              >
                <Icon name="Trash2" size={12} color="#7d5a5a" />
              </Pressable>
            </Row>
          );
        })}
      </ScrollView>
      {hint ? (
        <Row style={{ alignItems: 'center', paddingLeft: 10, paddingRight: 10, paddingTop: 3, paddingBottom: 3, backgroundColor: 'rgba(18,22,31,0.9)', borderTopWidth: 1, borderColor: '#1d2330' }}>
          <Text numberOfLines={1} noWrap style={{ color: '#8b97a8', fontSize: 9, fontFamily: 'monospace' }}>{hint}</Text>
        </Row>
      ) : null}
    </Col>
  );
}

// The FOCUS PANEL's pane-switch rail — the fixed 40px icon column on the
// panel's right edge (REGIONS.focusPanel.railWidth). One component, every
// branch: the rail is part of the region, not of any one panel mode.
function FocusRail(props: { activePane: string; onPane: (pane: string) => void }) {
  return (
    <C.HW_RightRail>
      {RIGHT_PANES.map(([pane, icon]) => {
        const Btn = props.activePane === pane ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn key={pane} onPress={() => props.onPane(pane)}>
            <Icon name={icon} size={14} color={accentFor(props.activePane === pane ? 'primary' : 'textDim')} />
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
  onPane: (pane: string) => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
  onModelBrush: (brush: Brush) => void;
  // Durable model identity (req_2620 S/T): the model card's editable name writes
  // through AppFrame's one rename path (manifest = disk truth); Save runs the same
  // 'save-snapshot' command as File → Save; onDisk feeds the save-state chip.
  onRenameModel: (id: string, name: string) => void;
  onSaveModel: () => void;
  onModelDocumentMutated: () => void;
  modelOnDisk: boolean;
  // The RIG editor (req_2712/2713): pockets/placements/seats/cover/dynamics on
  // the open model; export compiles the draft into the manifest skeleton.
  onSetModelRig: (pkgId: string, rig: PropRig) => void;
  // World-piece focus-panel material edits.
  onAssignSlot: (id: string, role: string) => void;
  onClearSlot: (id: string, role: string) => void;
  // World-globals tuning (GLOBALS req_2770) — the playtest tab's focus panel.
  onSetGlobal: (field: string, value: number) => void;
  onResetGlobal: (field: string) => void;
  colorSpine: ColorSpineHandlers;
  outlinerHandlers: OutlinerHandlers;
  // The outliner multi-select set (req_2659) — row highlights + the UV '+N' header.
  // AppFrame owns it (shell-local, not EditorState); primary stays modelActivePartId.
  selectedPartIds: string[];
}) {
  // Subscribed unconditionally (hook order) — only the MODEL FOCUS branch reads it.
  const focusBridge = useModelFocusBridge();
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId);
  // EFFECTIVE package (req_2620 S): session renames + dupes resolve here, so the
  // card shows the name the next save writes — never a stale synthesized one.
  const activeModel = activeDocument?.kind === 'model'
    ? effectiveModelPackage(activeDocument.sourceId, props.state.modelOverrides, props.state.modelDupes)
    : null;
  const activeCommand = commandById(props.state.activeCommandId);
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
            <Icon name="Gauge" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <GlobalsSection
              physics={props.state.worldGlobals.physics}
              onSet={props.onSetGlobal}
              onReset={props.onResetGlobal}
            />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  // World surface (req_2563): the focus panel is PIECE-aware — the real placed
  // piece (Select/Focus) or the armed catalog piece (Build), NOT the phantom
  // `objects` mock. This is what retires the "AC & Vents" ghost header.
  if (activeDocument?.kind === 'world') {
    const selectedPiece = props.state.worldPieces.find((p) => p.id === props.state.selectedPieceId) ?? null;
    const resolveMaterial = (ref: MaterialRef) => resolveMaterialRef(ref, props.state.assetOverrides);
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{selectedPiece ? 'PIECE FOCUS' : 'BUILD'}</C.HW_Kicker>
            <C.HW_Spacer />
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <PieceBody
              armedPieceId={props.state.armedPieceId}
              selected={selectedPiece}
              onAssignSlot={props.onAssignSlot}
              onClearSlot={props.onClearSlot}
              resolveMaterial={resolveMaterial}
              activeMaterialName={assetById(props.state.activeAssetId, props.state.assetOverrides).name}
            />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
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
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>MODEL FOCUS</C.HW_Kicker>
            <C.HW_Spacer />
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          {/* NO whole-panel scrolling (req_2627): the model focus body is a fixed
              column of budgeted slices — the outliner and paint-variant lists carry
              their OWN bounded nested scrolls. */}
          <C.HW_InspectorBodyFixed>
            {/* The model's NAME, editable in place (req_2620 S — the old studio's
                name field). Typing renames through the ONE write-through path:
                manifest for on-disk models, pending-until-first-save otherwise. */}
            <C.HW_RenameBar>
              <C.HW_FormLabel>name</C.HW_FormLabel>
              <C.HW_RenameInput value={activeModel.name} onChange={(name: string) => props.onRenameModel(activeModel.id, name)} />
            </C.HW_RenameBar>
            <C.HW_RenameBar>
              <C.HW_Tag style={{ backgroundColor: accentFor(saveChipTone) }}>
                <C.HW_TagText>{saveChip}</C.HW_TagText>
              </C.HW_Tag>
              <C.HW_Spacer />
              <C.HW_VerbFixed onPress={props.onSaveModel}>
                <Icon name="Save" size={12} color={accentFor('textDim')} />
                <C.HW_VerbText>Save</C.HW_VerbText>
              </C.HW_VerbFixed>
            </C.HW_RenameBar>
            <ModelDetailBody model={activeModel} />
            {/* SHAPE — the studio count strip + bounds line (req_2618 G), fed by the
                model-focus bridge; honest-empty until the viewer publishes. */}
            <ShapeSection shape={focusBridge?.shape ?? null} />
            {/* RIG (req_2712/2713) — what this model's bones MEAN when exported:
                searchable pockets, placement surfaces, seats, cover, dynamics.
                The draft edits live; Export → Prop / Save compile it into the
                package manifest's skeleton (disk truth, req_2718). */}
            <RigSection
              rig={props.state.modelRigs[activeModel.id] ?? (activeModel.skeleton ? skeletonToPropRig(activeModel.skeleton) : {})}
              onChange={(rig) => props.onSetModelRig(activeModel.id, rig)}
            />
            {/* The OUTLINER — parts of this multi-part model (add / select / hide / delete).
                Only primitive-authored models carry parts state. */}
            {modelParts ? (
              <ModelOutliner
                parts={modelParts}
                activeId={props.state.modelActivePartId}
                selectedIds={selectedSet}
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
                onAdd={props.outlinerHandlers.onAddPart}
                onImportModel={props.outlinerHandlers.onImportModel}
              />
            ) : null}
            {/* UV — the atlas panel relocated from the floating viewport card into this
                fixed panel (req_2643 OO), scoped-by-name to the active outliner part
                (req_2619 P). Sits below the outliner so a tall preview can never crowd
                the part list out of the non-scrolling body. */}
            <UvSection bridge={focusBridge} partName={uvPartName} extraCount={uvExtraCount} />
            {/* PAINT LAYERS (req_2672) — the stroke program's layer table, live whenever
                the doc has paint (host truth; hidden honest-empty before any painting). */}
              <PaintLayersSection bridge={focusBridge} onDocumentMutated={props.onModelDocumentMutated} />
            {/* Brush controls moved OUT of this corner dock to the top PaintToolbar (req_2466):
                paint controls belong at the top as icons, not a bottom-right text-pill panel.
                The Inspector now stays focused on selection/material inspection. */}
          </C.HW_InspectorBodyFixed>
        </C.HW_Inspector>
        <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  return (
    <C.HW_RightPanel>
      <C.HW_Inspector>
        <C.HW_PanelHead>
          <C.HW_Kicker>{props.state.rightPane.toUpperCase()}</C.HW_Kicker>
          <C.HW_Spacer />
          <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
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
      <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
    </C.HW_RightPanel>
  );
}
