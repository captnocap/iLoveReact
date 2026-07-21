// inspector/PieceBody.tsx — the world-surface focus panel (req_2563).
//
// This is the "fold": the same panel serves two modes, mirroring how the last
// editor's per-instance panel worked —
//   • DEFINITION (Build mode): an armed catalog piece, nothing placed-selected.
//     Shows what the palette will drop — kind/material/size + the slot template.
//   • INSTANCE (Select/Focus mode): a selected PlacedPiece. Shows THAT piece and
//     lets you edit its live material slots. Place blanks, come back, focus one,
//     edit — all in this panel.
import { C, accentFor } from '../workspace.cls';
import { catalogRowFor, rowHex } from '../world/buildCatalog';
import { pieceFloorOf, type MaterialRef, type PlacedPiece } from '../world/pieces';
import { pieceSlotEntries } from '../world/pieceSlots';
import { authoredPieceFor } from '../world/authoredRegistry';
import { authoredMeshBounds } from '../world/authoredMesh';
import { modelPackageById } from '../data/content';
import { skeletonToPropRig, describePropRig } from '../../../runtime/skeleton';
import ReadOnlySection from './ReadOnlySection';

function floorLabel(floor: number): string {
  return floor === 0 ? 'Ground' : floor > 0 ? `Floor ${floor}` : `Sub ${-floor}`;
}

export default function PieceBody(props: {
  armedPieceId: string | null;
  selected: PlacedPiece | null;
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
  const roleEntries = pieceId ? pieceSlotEntries(pieceId) : [];
  const roles = roleEntries.map((role) => role.id);

  // AUTHORED placeable (req_2577 pieces / req_2712 props): a `model:`/`prop:` id
  // never has a catalog row — show the real exported model: its label, measured
  // mesh size, and (for props) the rig its manifest skeleton carries.
  const authored = pieceId && !row ? authoredPieceFor(pieceId) : null;
  if (authored && pieceId) {
    const bounds = authoredMeshBounds(authored.modelId, authored.pkgId);
    const dims = bounds
      ? `${(bounds.maxX - bounds.minX).toFixed(1)}×${(bounds.maxZ - bounds.minZ).toFixed(1)}×${(bounds.maxY - bounds.minY).toFixed(1)}m`
      : 'mesh not resident';
    const skeleton = modelPackageById(authored.pkgId)?.skeleton;
    return (
      <>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>{authored.kind.toUpperCase()}</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>{authored.label}</C.HW_ObjectTitle>
          <C.HW_Spacer />
          <C.HW_Swatch style={{ backgroundColor: authored.hex }} />
        </C.HW_ObjectHead>
        <ReadOnlySection title={isInstance ? 'EXPORTED MODEL' : 'EXPORTED MODEL (armed)'} color="primary" rows={[
          ['model', authored.modelId],
          ['size', dims],
          ['places', authored.kind === 'prop' ? 'free (under cursor)' : `${authored.kind} snap`],
        ]} />
        {authored.kind === 'prop' ? (
          <ReadOnlySection title="RIG" color="warning" rows={[
            ['carries', skeleton ? describePropRig(skeletonToPropRig(skeleton)) : 'no rig on the manifest'],
          ]} />
        ) : null}
        {isInstance && sel ? (
          <ReadOnlySection title="PLACEMENT" color="primary" rows={[
            ['at', `${sel.x.toFixed(1)}, ${sel.z.toFixed(1)}`],
            ['floor', floorLabel(pieceFloorOf(sel))],
            ['yaw', `${sel.yawDegrees}°`],
          ]} />
        ) : (
          <ReadOnlySection title="PLACE" color="textDim" rows={[
            ['arm', 'click the map to place'],
          ]} />
        )}
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
          {roleEntries.map((role) => {
            const ref = sel.slots?.[role.id];
            const mat = ref ? props.resolveMaterial(ref) : null;
            return (
              <C.HW_ReadRow key={role.id}>
                <C.HW_FormLabel>{role.label}</C.HW_FormLabel>
                <C.HW_SelectControl tooltip={`bind the selected material to the ${role.label} slot`} onPress={() => props.onAssignSlot(sel.id, role.id)}>
                  <C.HW_BuildPieceChip style={{ width: 12, height: 12, backgroundColor: mat ? mat.color : '#0a1118' }} />
                  <C.HW_ReadValue>{mat ? mat.label : `+ ${props.activeMaterialName}`}</C.HW_ReadValue>
                </C.HW_SelectControl>
                {ref
                  ? <C.HW_OvReset tooltip="clear this slot" onPress={() => props.onClearSlot(sel.id, role.id)}><C.HW_OvResetText>↺</C.HW_OvResetText></C.HW_OvReset>
                  : <C.HW_OvResetIdle />}
              </C.HW_ReadRow>
            );
          })}
        </C.HW_Section>
      ) : (
        <ReadOnlySection title="SLOT TEMPLATE" color="accent" rows={roleEntries.map((role) => [role.label, 'material slot'])} />
      )}

    </>
  );
}
