import { useEffect, useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
// Fixed-region contract (req_2627): the UV preview sizes itself from the focus
// panel's CONSTANT inner width — imported, never measured.
import { REGIONS } from '../shell/regions';
import type { ModelFocusBridge, ModelFocusShape } from '../stage/ModelView';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, RIGHT_PANES, SNAP_MODES, effectiveModelPackage } from '../data/content';
import { missionCounts, objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, WorldObject } from '../data/types';
import type { MaterialRef } from '../world/pieces';
import { assetById } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import PieceBody from './PieceBody';
import PresetSection from './PresetSection';
import MissionSection from './MissionSection';
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
// The VIEW still shows the whole-model atlas: __model_atlas_read emits island rects
// without their group ids, so the active part's islands cannot be told apart cart-side
// yet — the scope row reads the honest state.
function UvSection({ bridge, partName }: { bridge: ModelFocusBridge | null; partName: string }) {
  const uv = bridge?.uv ?? null;
  const scale = uv && uv.src ? Math.min(UV_IMG_W / Math.max(1, uv.w), UV_IMG_MAX_H / Math.max(1, uv.h)) : 0;
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>{`UV · ${partName.toUpperCase()}`}</C.HW_SectionTitle>
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
        <C.HW_ReadValue>whole model</C.HW_ReadValue>
      </C.HW_ReadRow>
    </C.HW_Section>
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
  onCommand: (id: string, source: string) => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
  onModelBrush: (brush: Brush) => void;
  // Durable model identity (req_2620 S/T): the model card's editable name writes
  // through AppFrame's one rename path (manifest = disk truth); Save runs the same
  // 'save-snapshot' command as File → Save; onDisk feeds the save-state chip.
  onRenameModel: (id: string, name: string) => void;
  onSaveModel: () => void;
  modelOnDisk: boolean;
  // World-piece focus-panel edits (req_2563 Phase 3/4).
  onSetPieceOverride: (id: string, path: string, value: number | boolean) => void;
  onClearPieceOverride: (id: string, path: string) => void;
  onAssignSlot: (id: string, role: string) => void;
  onClearSlot: (id: string, role: string) => void;
  colorSpine: ColorSpineHandlers;
  outlinerHandlers: OutlinerHandlers;
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
  const counts = missionCounts(props.state);
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
  const showMission = props.state.rightPane === 'mission' || activeCommand.menu === 'Story';
  // World surface (req_2563): the focus panel is PIECE-aware — the real placed
  // piece (Select/Focus) or the armed catalog piece (Build), NOT the phantom
  // `objects` mock. This is what retires the "AC & Vents" ghost header.
  if (activeDocument?.kind === 'world') {
    const selectedPiece = props.state.worldPieces.find((p) => p.id === props.state.selectedPieceId) ?? null;
    const resolveMaterial = (ref: MaterialRef) => {
      if ('assetId' in ref) {
        const a = assetById(ref.assetId, props.state.assetOverrides);
        return { label: a.name, color: a.color };
      }
      return { label: `${ref.fn}·${ref.variant}`, color: '#7d858d' };
    };
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
              onSetOverride={props.onSetPieceOverride}
              onClearOverride={props.onClearPieceOverride}
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
            {/* The OUTLINER — parts of this multi-part model (add / select / hide / delete).
                Only primitive-authored models carry parts state. */}
            {modelParts ? (
              <ModelOutliner
                parts={modelParts}
                activeId={props.state.modelActivePartId}
                onSelect={props.outlinerHandlers.onSelectPart}
                onToggleVisible={props.outlinerHandlers.onToggleVisiblePart}
                onDuplicate={props.outlinerHandlers.onDuplicatePart}
                onDelete={props.outlinerHandlers.onDeletePart}
                onAdd={props.outlinerHandlers.onAddPart}
                onImportModel={props.outlinerHandlers.onImportModel}
              />
            ) : null}
            {/* UV — the atlas panel relocated from the floating viewport card into this
                fixed panel (req_2643 OO), scoped-by-name to the active outliner part
                (req_2619 P). Sits below the outliner so a tall preview can never crowd
                the part list out of the non-scrolling body. */}
            <UvSection bridge={focusBridge} partName={uvPartName} />
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
        {showMission ? (
          <MissionSection
            rows={[
              ['in mission', 'editing'],
              ['trigger volumes', String(counts.triggers)],
              ['mission points', String(counts.points)],
              ['active sequence', '—'],
            ]}
            triggerCount={counts.triggers}
            pointCount={counts.points}
            onCommand={props.onCommand}
          />
        ) : null}
      </C.HW_Inspector>
      <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
    </C.HW_RightPanel>
  );
}
