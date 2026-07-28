// inspector/PieceBody.tsx — the world-surface focus panel (req_2563; editable
// req_3442).
//
// This is the "fold": the same panel serves two modes, mirroring how the last
// editor's per-instance panel worked —
//   • DEFINITION (Build mode): an armed catalog piece, nothing placed-selected.
//     Shows what the palette will drop — kind/material/size + the slot template.
//   • INSTANCE (Select/Focus mode): a selected PlacedPiece. Every value that IS
//     an authored fact on the instance — position, floor, yaw, prop height/
//     scale, spin, material slots — is a live control writing through the same
//     transaction commands as the viewport/hotkeys (req_2095 ruling: a field
//     either actually edits or reads clearly immutable).
//
// Density rule (req_3444): a row earns its place only by telling the user
// something about THIS piece they don't already have. Rows that restate the
// header tag, describe tool mechanics ("free (under cursor)", "click the map
// to place"), or hold filler values ("material slot", "plain (no
// capabilities)") are cut, not dimmed.
import { Row } from '@reactjit/runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { catalogRowFor, rowHex } from '../world/buildCatalog';
import {
  PIECE_MODULE_METERS,
  PIECE_SCALE_LIMITS,
  pieceFloorOf,
  pieceKindOf,
  pieceScaleOf,
  type MaterialRef,
  type PlacedPiece,
} from '../world/pieces';
import { WORLD_PIECE_EDIT_LIMITS } from '../world/pieceEditCommand';
import { METERS_PER_LEVEL } from '../world/isoStage';
import { pieceSlotEntries } from '../world/pieceSlots';
import { authoredPieceFor, isAuthoredPiece } from '../world/authoredRegistry';
import { authoredMeshBounds } from '../world/authoredMesh';
import { modelPackageById } from '../data/content';
import { skeletonToPropRig, describePropRig } from '../../../runtime/skeleton';
import ReadOnlySection from './ReadOnlySection';

function floorLabel(floor: number): string {
  return floor === 0 ? 'Ground' : floor > 0 ? `Floor ${floor}` : `Sub ${-floor}`;
}

/** Instance-edit handlers threaded from AppFrame — every control below lands in
 *  the world transaction commands (move/rotate/spin/delete), so panel edits get
 *  the identical undo, replacement policy, and live-world push as viewport ones. */
export type PieceEditHandlers = {
  onMovePiece: (id: string, destination: PlacedPiece) => void;
  onRotatePiece: (id: string, quarterTurns: -1 | 1) => void;
  onSpinPiece: (id: string, spinDegPerSec: number) => void;
  onDeletePiece: (id: string) => void;
  onDuplicatePiece: (id: string) => void;
  onOpenPieceModel: (pkgId: string) => void;
};

// One numeric field on the fixed control grid — the same [−] value [+] geometry
// as OverrideField, minus the inherit/override semantics (a placement is always
// a real authored value, never a kind default).
function StepRow(props: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  fmt: (v: number) => string;
  tip: string;
  onSet: (v: number) => void;
}) {
  const lo = props.min ?? -Infinity;
  const hi = props.max ?? Infinity;
  const clamp = (v: number) => Math.max(lo, Math.min(hi, Math.round(v * 100) / 100));
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <C.HW_OvBtn tooltip={props.tip} onPress={() => props.onSet(clamp(props.value - props.step))}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
      <C.HW_OvVal>{props.fmt(props.value)}</C.HW_OvVal>
      <C.HW_OvBtn tooltip={props.tip} onPress={() => props.onSet(clamp(props.value + props.step))}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
      <C.HW_OvResetIdle />
    </C.HW_ReadRow>
  );
}

// The editable PLACEMENT card for a selected instance. Grid pieces step by the
// 3m module (module arithmetic keeps every step on its snap family — cell
// centres stay centres, edge lines stay lines); free-placing props step fine.
function PlacementSection(props: { sel: PlacedPiece; edit: PieceEditHandlers }) {
  const sel = props.sel;
  const kind = pieceKindOf(sel.pieceId);
  const isProp = kind === 'prop';
  const authored = isAuthoredPiece(sel.pieceId);
  const floor = pieceFloorOf(sel);
  const posStep = isProp ? 0.1 : PIECE_MODULE_METERS;
  const maxHeight = WORLD_PIECE_EDIT_LIMITS.maxFloor * METERS_PER_LEVEL;
  const move = (patch: Partial<PlacedPiece>) => props.edit.onMovePiece(sel.id, { ...sel, ...patch });
  const meters = (v: number) => `${v.toFixed(1)}m`;
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar />
        <C.HW_SectionTitle>PLACEMENT</C.HW_SectionTitle>
      </C.HW_SectionHead>
      <StepRow label="x" value={sel.x} step={posStep} fmt={meters} tip={isProp ? 'nudge 0.1m along x' : 'step one 3m cell along x'} onSet={(v) => move({ x: v })} />
      <StepRow label="z" value={sel.z} step={posStep} fmt={meters} tip={isProp ? 'nudge 0.1m along z' : 'step one 3m cell along z'} onSet={(v) => move({ z: v })} />
      {isProp ? (
        <StepRow label="height" value={sel.y} step={0.1} min={0} max={maxHeight} fmt={meters} tip="raise/lower the prop off its base" onSet={(v) => move({ y: v })} />
      ) : null}
      <StepRow
        label="floor"
        value={floor}
        step={1}
        min={0}
        max={WORLD_PIECE_EDIT_LIMITS.maxFloor}
        fmt={floorLabel}
        tip="move the piece one storey (3m) up/down"
        onSet={(v) => move({ floor: v, y: sel.y + (v - floor) * METERS_PER_LEVEL })}
      />
      {isProp ? (
        <StepRow
          label="yaw"
          value={sel.yawDegrees}
          step={15}
          fmt={(v) => `${Math.round(v)}°`}
          tip="turn the prop 15° (free-placed props rotate freely)"
          onSet={(v) => move({ yawDegrees: ((v % 360) + 360) % 360 })}
        />
      ) : (
        // Grid/edge pieces turn in quarter steps only — their footprint identity
        // (the placement slot) is quantised to 90°, same as the R hotkey.
        <C.HW_ReadRow>
          <C.HW_FormLabel>yaw</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_OvBtn tooltip="turn 90° counter-clockwise" onPress={() => props.edit.onRotatePiece(sel.id, -1)}><C.HW_OvBtnText>⟲</C.HW_OvBtnText></C.HW_OvBtn>
          <C.HW_OvVal>{`${Math.round(sel.yawDegrees)}°`}</C.HW_OvVal>
          <C.HW_OvBtn tooltip="turn 90° clockwise" onPress={() => props.edit.onRotatePiece(sel.id, 1)}><C.HW_OvBtnText>⟳</C.HW_OvBtnText></C.HW_OvBtn>
          <C.HW_OvResetIdle />
        </C.HW_ReadRow>
      )}
      {isProp ? (
        <StepRow
          label="scale"
          value={pieceScaleOf(sel)}
          step={0.1}
          min={PIECE_SCALE_LIMITS.min}
          max={PIECE_SCALE_LIMITS.max}
          fmt={(v) => `×${v.toFixed(2)}`}
          tip="uniform instance scale — same as the viewport gizmo's scale handle"
          onSet={(v) => move({ scale: v })}
        />
      ) : null}
      {authored ? (
        <StepRow
          label="spin"
          value={sel.spinDegPerSec ?? 0}
          step={15}
          min={-180}
          max={180}
          fmt={(v) => `${Math.round(v)}°/s`}
          tip="continuous visual spin — 0 is static, negative turns counter-clockwise"
          onSet={(v) => props.edit.onSpinPiece(sel.id, v)}
        />
      ) : null}
    </C.HW_Section>
  );
}

// The focused instance's verb row (control law: rows carry VERBS) — the same
// duplicate/delete the hotkeys and quick menu run, reachable from the panel.
function InstanceVerbs(props: { sel: PlacedPiece; edit: PieceEditHandlers }) {
  return (
    <Row style={{ alignItems: 'center', gap: 6, width: '100%' }}>
      <C.HW_VerbFixed tooltip="copy this piece — arms Place with its exact look" onPress={() => props.edit.onDuplicatePiece(props.sel.id)}>
        <Icon name="Copy" size={12} color={accentFor('textDim')} />
        <C.HW_VerbText>Copy</C.HW_VerbText>
      </C.HW_VerbFixed>
      <C.HW_VerbFixed tooltip="delete this placed piece (undoable)" onPress={() => props.edit.onDeletePiece(props.sel.id)}>
        <Icon name="Trash2" size={12} color={accentFor('warning')} />
        <C.HW_VerbText>Delete</C.HW_VerbText>
      </C.HW_VerbFixed>
      <C.HW_Spacer />
    </Row>
  );
}

export default function PieceBody(props: {
  armedPieceId: string | null;
  selected: PlacedPiece | null;
  onAssignSlot: (id: string, role: string) => void;
  onClearSlot: (id: string, role: string) => void;
  /** resolve a slot's MaterialRef to a display label + swatch colour. */
  resolveMaterial: (ref: MaterialRef) => { label: string; color: string };
  /** the content browser's currently selected material (the one a slot click binds). */
  activeMaterial: { name: string; color: string };
  /** open the left panel on the Materials library — where the selection is made
   *  (req_3446: the panel must POINT AT the picker, not just name its result). */
  onBrowseMaterials: () => void;
  /** the instance-edit handler bundle (move/rotate/spin/delete/duplicate/open). */
  edit: PieceEditHandlers;
  /** resolve a model PACKAGE id to its current (session-renamed) display name. */
  modelNameFor: (pkgId: string) => string | null;
}) {
  const pieceId = props.selected?.pieceId ?? props.armedPieceId;
  const row = pieceId ? catalogRowFor(pieceId) : null;
  const sel = props.selected;
  const isInstance = !!sel;
  const roleEntries = pieceId ? pieceSlotEntries(pieceId) : [];
  const roles = roleEntries.map((role) => role.id);

  // AUTHORED placeable (req_2577 pieces / req_2712 props): a `model:`/`prop:` id
  // never has a catalog row — show the real exported model: its label, measured
  // mesh size, and (for props) the rig its manifest skeleton carries.
  const authored = pieceId && !row ? authoredPieceFor(pieceId) : null;
  if (authored && pieceId) {
    const bounds = authoredMeshBounds(authored.modelId, authored.pkgId);
    // A scaled instance reports its EFFECTIVE size — the mesh × the live scale
    // control below, the box actually standing in the world.
    const scale = sel ? pieceScaleOf(sel) : 1;
    const dims = bounds
      ? `${((bounds.maxX - bounds.minX) * scale).toFixed(1)}×${((bounds.maxZ - bounds.minZ) * scale).toFixed(1)}×${((bounds.maxY - bounds.minY) * scale).toFixed(1)}m`
      : 'mesh not resident';
    const skeleton = modelPackageById(authored.pkgId)?.skeleton;
    // RIG shows only when the manifest actually carries capabilities — an empty
    // projected rig ({}) would only render the 'plain (no capabilities)' filler.
    const rig = skeleton ? skeletonToPropRig(skeleton) : null;
    const rigSummary = rig && Object.keys(rig).length > 0 ? describePropRig(rig) : null;
    // The source model by its human name — the internal mesh key (e.g.
    // `primitive:cube:56::dup-…`) identified nothing a person recognises.
    const modelName = props.modelNameFor(authored.pkgId) ?? authored.label;
    return (
      <>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>{authored.kind.toUpperCase()}</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>{authored.label}</C.HW_ObjectTitle>
          <C.HW_Spacer />
          <C.HW_Swatch style={{ backgroundColor: authored.hex }} />
        </C.HW_ObjectHead>
        {isInstance && sel ? <InstanceVerbs sel={sel} edit={props.edit} /> : null}
        <C.HW_Section>
          <C.HW_SectionHead>
            <C.HW_AccentBar />
            <C.HW_SectionTitle>{isInstance ? 'EXPORTED MODEL' : 'EXPORTED MODEL (armed)'}</C.HW_SectionTitle>
            <C.HW_Spacer />
            <C.HW_KeyText>2</C.HW_KeyText>
          </C.HW_SectionHead>
          <C.HW_ReadRow>
            <C.HW_FormLabel>model</C.HW_FormLabel>
            <C.HW_SelectControl tooltip="open this model in Studio to edit its mesh/paint/rig" onPress={() => props.edit.onOpenPieceModel(authored.pkgId)}>
              <C.HW_ReadValue>{modelName}</C.HW_ReadValue>
              <C.HW_Spacer />
              <Icon name="ExternalLink" size={10} color={accentFor('textDim')} />
            </C.HW_SelectControl>
            <C.HW_OvResetIdle />
          </C.HW_ReadRow>
          <C.HW_ReadRow>
            <C.HW_FormLabel>size</C.HW_FormLabel>
            <C.HW_Spacer />
            <C.HW_ReadValue>{scale !== 1 ? `${dims} (×${scale.toFixed(2)})` : dims}</C.HW_ReadValue>
            <C.HW_OvResetIdle />
          </C.HW_ReadRow>
        </C.HW_Section>
        {authored.kind === 'prop' && rigSummary ? (
          <ReadOnlySection title="RIG" color="warning" rows={[['carries', rigSummary]]} />
        ) : null}
        {isInstance && sel ? <PlacementSection sel={sel} edit={props.edit} /> : null}
      </>
    );
  }

  if (!row || !pieceId) {
    return (
      <>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>WORLD</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>No piece</C.HW_ObjectTitle>
        </C.HW_ObjectHead>
        <ReadOnlySection title="BUILD" color="textDim" rows={[
          ['pick', 'a piece from the build bar'],
          ['or', 'select a placed piece'],
        ]} />
      </>
    );
  }

  const dims = `${row.w}×${row.d}×${row.h}m`;
  return (
    <>
      <C.HW_ObjectHead>
        <C.HW_Tag><C.HW_TagText>{row.kind.toUpperCase()}</C.HW_TagText></C.HW_Tag>
        <C.HW_ObjectTitle>{row.label}</C.HW_ObjectTitle>
        <C.HW_Spacer />
        <C.HW_Swatch style={{ backgroundColor: rowHex(row) }} />
      </C.HW_ObjectHead>
      {isInstance && sel ? <InstanceVerbs sel={sel} edit={props.edit} /> : null}
      <C.HW_MetricRow>
        <C.HW_Metric>
          <C.HW_MetricValue>{row.material}</C.HW_MetricValue>
          <C.HW_MetricLabel>material</C.HW_MetricLabel>
        </C.HW_Metric>
        <C.HW_Metric>
          <C.HW_MetricValue>{row.theme}</C.HW_MetricValue>
          <C.HW_MetricLabel>theme</C.HW_MetricLabel>
        </C.HW_Metric>
        <C.HW_Metric>
          <C.HW_MetricValue>{dims}</C.HW_MetricValue>
          <C.HW_MetricLabel>size</C.HW_MetricLabel>
        </C.HW_Metric>
      </C.HW_MetricRow>

      {isInstance && sel ? <PlacementSection sel={sel} edit={props.edit} /> : null}

      {/* MATERIAL SLOTS — the "texture slots" the user asked for. Editable on a
          placed instance (click a slot to bind the browser's active material);
          armed definitions show nothing here (a template row per slot only
          restated the word "material slot" — req_3444 density rule). The
          `selected` row closes the loop the slot rows open (req_3446): it shows
          WHICH material a slot click binds and pressing it opens the Materials
          library — the place that selection is actually made. */}
      {isInstance && sel ? (
        <C.HW_Section>
          <C.HW_SectionHead>
            <C.HW_AccentBar style={{ backgroundColor: accentFor('accent') }} />
            <C.HW_SectionTitle style={{ color: accentFor('accent') }}>MATERIAL SLOTS</C.HW_SectionTitle>
            <C.HW_Spacer />
            <C.HW_KeyText>{roles.length}</C.HW_KeyText>
          </C.HW_SectionHead>
          <C.HW_ReadRow>
            <C.HW_FormLabel>selected</C.HW_FormLabel>
            <C.HW_SelectControl tooltip="the material a slot click binds — press to pick a different one in the Materials library" onPress={props.onBrowseMaterials}>
              <C.HW_BuildPieceChip style={{ width: 12, height: 12, backgroundColor: props.activeMaterial.color }} />
              <C.HW_ReadValue>{props.activeMaterial.name}</C.HW_ReadValue>
              <C.HW_Spacer />
              <Icon name="ExternalLink" size={10} color={accentFor('textDim')} />
            </C.HW_SelectControl>
            <C.HW_OvResetIdle />
          </C.HW_ReadRow>
          {roleEntries.map((role) => {
            const ref = sel.slots?.[role.id];
            const mat = ref ? props.resolveMaterial(ref) : null;
            return (
              <C.HW_ReadRow key={role.id}>
                <C.HW_FormLabel>{role.label}</C.HW_FormLabel>
                <C.HW_SelectControl tooltip={`bind ${props.activeMaterial.name} to the ${role.label} slot`} onPress={() => props.onAssignSlot(sel.id, role.id)}>
                  <C.HW_BuildPieceChip style={{ width: 12, height: 12, backgroundColor: mat ? mat.color : '#0a1118' }} />
                  <C.HW_ReadValue>{mat ? mat.label : `+ ${props.activeMaterial.name}`}</C.HW_ReadValue>
                </C.HW_SelectControl>
                {ref
                  ? <C.HW_OvReset tooltip="clear this slot" onPress={() => props.onClearSlot(sel.id, role.id)}><C.HW_OvResetText>↺</C.HW_OvResetText></C.HW_OvReset>
                  : <C.HW_OvResetIdle />}
              </C.HW_ReadRow>
            );
          })}
        </C.HW_Section>
      ) : null}

    </>
  );
}
