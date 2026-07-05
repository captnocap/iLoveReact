// inspector/PieceBody.tsx — the world-surface focus panel (req_2563).
//
// This is the "fold": the same panel serves two modes, mirroring how the last
// editor's per-instance panel worked —
//   • DEFINITION (Build mode): an armed catalog piece, nothing placed-selected.
//     Shows what the palette will drop — kind/material/size + the slot template.
//   • INSTANCE (Select/Focus mode): a selected PlacedPiece. Shows THAT piece and
//     lets you edit its material slots (Phase 4) + per-instance overrides
//     (Phase 3). Place blanks, come back, focus one, edit — all in this panel.
import { C, accentFor } from '../workspace.cls';
import { catalogRowFor, rowHex } from '../world/buildCatalog';
import { pieceFloorOf, type MaterialRef, type PlacedPiece } from '../world/pieces';
import { pieceSlotRoles } from '../world/pieceSlots';
import { overridableGroups } from './overridables';
import OverrideField from './OverrideField';
import ReadOnlySection from './ReadOnlySection';

function floorLabel(floor: number): string {
  return floor === 0 ? 'Ground' : floor > 0 ? `Floor ${floor}` : `Sub ${-floor}`;
}

export default function PieceBody(props: {
  armedPieceId: string | null;
  selected: PlacedPiece | null;
  onSetOverride: (id: string, path: string, value: number | boolean) => void;
  onClearOverride: (id: string, path: string) => void;
  onAssignSlot: (id: string, role: string) => void;
  onClearSlot: (id: string, role: string) => void;
  /** resolve a slot's MaterialRef to a display label + swatch colour. */
  resolveMaterial: (ref: MaterialRef) => { label: string; color: string };
  /** the content browser's currently selected material (the one a slot click binds). */
  activeMaterialName: string;
}) {
  const pieceId = props.selected?.pieceId ?? props.armedPieceId;
  const row = pieceId ? catalogRowFor(pieceId) : null;
  const sel = props.selected;
  const isInstance = !!sel;
  const roles = pieceId ? pieceSlotRoles(pieceId) : [];

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

      <ReadOnlySection title={isInstance ? 'PIECE' : 'PIECE (armed)'} color="primary" rows={[
        ['id', row.id],
        ['kind', row.kind],
        ['catalog', isInstance ? 'placed instance' : 'palette definition'],
      ]} />

      {isInstance && sel ? (
        <ReadOnlySection title="PLACEMENT" color="primary" rows={[
          ['cell', `${sel.x.toFixed(1)}, ${sel.z.toFixed(1)}`],
          ['floor', floorLabel(pieceFloorOf(sel))],
          ['yaw', `${sel.yawDegrees}°`],
        ]} />
      ) : (
        <C.HW_Section>
          <C.HW_SectionHead>
            <C.HW_AccentBar style={{ backgroundColor: accentFor('textDim') }} />
            <C.HW_SectionTitle style={{ color: accentFor('textDim') }}>PLACE</C.HW_SectionTitle>
          </C.HW_SectionHead>
          <C.HW_ReadRow>
            <C.HW_FormLabel>arm</C.HW_FormLabel>
            <C.HW_Spacer />
            {/* Sized to its fixed column (req_2626 II) — the row reserves space,
                the readout fits it; no squeezing, no wrap. */}
            <C.HW_ReadValue>click the map to place</C.HW_ReadValue>
          </C.HW_ReadRow>
        </C.HW_Section>
      )}

      {/* MATERIAL SLOTS — the "texture slots" the user asked for. Editable on a
          placed instance (click a slot to bind the browser's active material);
          a read-only template preview on the armed definition. */}
      {isInstance && sel ? (
        <C.HW_Section>
          <C.HW_SectionHead>
            <C.HW_AccentBar style={{ backgroundColor: accentFor('accent') }} />
            <C.HW_SectionTitle style={{ color: accentFor('accent') }}>MATERIAL SLOTS</C.HW_SectionTitle>
            <C.HW_Spacer />
            <C.HW_KeyText>{roles.length}</C.HW_KeyText>
          </C.HW_SectionHead>
          {roles.map((role) => {
            const ref = sel.slots?.[role];
            const mat = ref ? props.resolveMaterial(ref) : null;
            return (
              <C.HW_ReadRow key={role}>
                <C.HW_FormLabel>{role}</C.HW_FormLabel>
                <C.HW_SelectControl tooltip={`bind the selected material to the ${role} slot`} onPress={() => props.onAssignSlot(sel.id, role)}>
                  <C.HW_BuildPieceChip style={{ width: 12, height: 12, backgroundColor: mat ? mat.color : '#0a1118' }} />
                  <C.HW_ReadValue>{mat ? mat.label : `+ ${props.activeMaterialName}`}</C.HW_ReadValue>
                </C.HW_SelectControl>
                {ref
                  ? <C.HW_OvReset tooltip="clear this slot" onPress={() => props.onClearSlot(sel.id, role)}><C.HW_OvResetText>↺</C.HW_OvResetText></C.HW_OvReset>
                  : <C.HW_OvResetIdle />}
              </C.HW_ReadRow>
            );
          })}
        </C.HW_Section>
      ) : (
        <ReadOnlySection title="SLOT TEMPLATE" color="accent" rows={roles.map((r) => [r, 'material slot'])} />
      )}

      {/* PER-INSTANCE OVERRIDES — the folded-in editor (Phase 3). Instance only. */}
      {isInstance && sel ? overridableGroups().map((g) => (
        <C.HW_Section key={g.group}>
          <C.HW_SectionHead>
            <C.HW_AccentBar style={{ backgroundColor: accentFor('info') }} />
            <C.HW_SectionTitle style={{ color: accentFor('info') }}>{g.group}</C.HW_SectionTitle>
          </C.HW_SectionHead>
          {g.props.map((p) => (
            <OverrideField
              key={p.path}
              prop={p}
              value={sel.overrides?.[p.path]}
              onSet={(path, v) => props.onSetOverride(sel.id, path, v)}
              onClear={(path) => props.onClearOverride(sel.id, path)}
            />
          ))}
        </C.HW_Section>
      )) : null}
    </>
  );
}
