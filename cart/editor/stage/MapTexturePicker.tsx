// stage/MapTexturePicker.tsx — "paint THIS texture" (req_2494, per-tile req_2693).
//
// The map-paint bar's tile channel arms a KIND (the semantic layer — pathing,
// cover, compile behavior). This popover arms the LOOK the brush deposits:
// picking a material find-or-appends a (material, variant) entry in the map's
// tile-binding table and arms its index — every stroke stamps that binding
// per CELL, so neighboring sidewalks can wear different materials and already-
// painted tiles never change under you. The table is pure DATA host-side
// (mapSetTileBindings); no pick ever rebuilds the ground shader. "default"
// re-arms the kind's curated look (binding -1).
//
// req_3401: the grid itself is the shared MaterialPickerPopover (one picker
// organ — the Rig panel's live-material binding rides the same component);
// this file keeps only the map-paint semantics: the binding table, the armed
// index, and the "default" chip.
import { Text, Pressable } from '../../../runtime/primitives';
import MaterialPickerPopover from '../shell/MaterialPickerPopover';
import { GROUND_MATERIALS, tileBindingFor, type TileMaterialBinding } from '../render3d/groundFormula';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import type { MapPaintState } from './mapPaint';

const LINE = '#242a33', DIM = '#8b93a3', ACCENT = '#6ea8fe';
const PICKER_LEFT = 410;
const PICKER_BOTTOM = 126; // above the viewport bottom paint/build dock

/** Find-or-append (fn, variant) in the binding table; returns the patch that arms it. */
function armBindingPatch(s: MapPaintState, fn: string, variant: number): Partial<MapPaintState> {
  const at = s.tileBindings.findIndex((b) => b.fn === fn && b.variant === variant);
  if (at !== -1) return { tileBindIdx: at, mode: 'paint' };
  const entry: TileMaterialBinding = { fn, variant };
  return { tileBindings: [...s.tileBindings, entry], tileBindIdx: s.tileBindings.length, mode: 'paint' };
}

export default function MapTexturePicker(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
}) {
  const s = props.state;
  const kind = TILE_KINDS[s.tileKindIdx] ?? 'sidewalk';
  const def = tileKindDefinition(kind);
  // What the brush deposits: the armed binding, or the kind's curated default.
  const armed = s.tileBindIdx >= 0 ? s.tileBindings[s.tileBindIdx] : undefined;
  const binding = armed ?? tileBindingFor(kind);
  const isDefault = armed === undefined;

  return (
    <MaterialPickerPopover
      title={`${def.label} brush paints:${isDefault ? ' (default)' : ''}`}
      boundFn={binding.fn}
      boundVariant={binding.variant}
      materials={GROUND_MATERIALS}
      onPick={(fn, variant) => props.onPatch(armBindingPatch(s, fn, variant))}
      onClose={() => props.onPatch({ texturePickerOpen: false })}
      anchor={{ left: PICKER_LEFT, bottom: PICKER_BOTTOM }}
      footerExtra={
        <Pressable
          tooltip="Arm the kind's curated default look — painted tiles keep what they wear"
          onPress={() => props.onPatch({ tileBindIdx: -1, mode: 'paint' })}
          style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, borderWidth: 1, borderColor: isDefault ? ACCENT : LINE }}
        >
          <Text style={{ color: isDefault ? ACCENT : DIM, fontSize: 10, fontWeight: '700' }}>default</Text>
        </Pressable>
      }
    />
  );
}
