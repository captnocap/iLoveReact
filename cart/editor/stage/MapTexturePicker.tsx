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
import { useState } from 'react';
import { Box, Row, Col, Text, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import ShaderThumb from '../shell/ShaderThumb';
import { FILL_SHADER } from '../render3d/shaders/index';
import { GROUND_MATERIALS, tileBindingFor, type TileMaterialBinding } from '../render3d/groundFormula';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import type { MapPaintState } from './mapPaint';

const POP = '#17181b', LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', ACCENT = '#6ea8fe';
const PAGE_SIZE = 15; // live-Effect budget, same as the persistent Ink panel
const PICKER_LEFT = 410;
const PICKER_BOTTOM = 126; // above the viewport bottom paint/build dock

// Thumb data for a registry material: the standard D[] tuple at Std grade.
// Seed 7 is arbitrary-but-fixed so thumbs are stable across opens.
const thumbData = (materialId: number, boardIndex: number, variant: number) => [materialId, variant, 7, 3, boardIndex];

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
  const bound = GROUND_MATERIALS.find((m) => m.fn === binding.fn);
  const [page, setPage] = useState(() => {
    const at = GROUND_MATERIALS.findIndex((m) => m.fn === binding.fn);
    return at === -1 ? 0 : Math.floor(at / PAGE_SIZE);
  });
  const maxPage = Math.max(0, Math.ceil(GROUND_MATERIALS.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageMats = GROUND_MATERIALS.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const arm = (fn: string, variant: number) => props.onPatch(armBindingPatch(s, fn, variant));

  return (
    // Click-away scrim over the editor; the panel rises from the bottom paint dock.
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Pressable onPress={() => props.onPatch({ texturePickerOpen: false })} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      <Col style={{ position: 'absolute', left: PICKER_LEFT, bottom: PICKER_BOTTOM, width: 320, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 7 }}>
          <Icon name="SwatchBook" size={13} color={ACCENT} />
          <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{def.label} brush paints:</Text>
          <Text numberOfLines={1} noWrap style={{ color: ACCENT, fontSize: 12, fontWeight: '700' }}>{bound?.name ?? binding.fn}{isDefault ? ' (default)' : ''}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{p + 1}/{maxPage + 1}</Text>
        </Row>
        {/* The armed material's authored takes — each take is its own binding. */}
        {bound ? (
          <Row style={{ gap: 4 }}>
            {bound.variantLabels.map((label, v) => {
              const on = v === binding.variant;
              return (
                <Pressable key={label} onPress={() => arm(bound.fn, v)}
                  style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: on ? '#e8e8ea' : '#141518' }}>
                  <Text style={{ color: on ? '#0d0e10' : DIM, fontSize: 10, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              );
            })}
          </Row>
        ) : null}
        <Row style={{ flexWrap: 'wrap', gap: 6, minHeight: 160 }}>
          {pageMats.map((m) => {
            const on = m.fn === binding.fn;
            return (
              <Pressable key={m.fn} tooltip={`${m.name} (${m.board})`} onPress={() => arm(m.fn, m.fn === binding.fn ? binding.variant : 0)}
                style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: on ? ACCENT : 'transparent' }}>
                <ShaderThumb shader={FILL_SHADER} data={thumbData(m.materialId, m.boardIndex, m.fn === binding.fn ? binding.variant : 0)} size={48} />
              </Pressable>
            );
          })}
        </Row>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setPage(Math.max(0, p - 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronLeft" size={11} color={DIM} />
          </Pressable>
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{GROUND_MATERIALS.length} materials</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            tooltip="Arm the kind's curated default look — painted tiles keep what they wear"
            onPress={() => props.onPatch({ tileBindIdx: -1, mode: 'paint' })}
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, borderWidth: 1, borderColor: isDefault ? ACCENT : LINE }}
          >
            <Text style={{ color: isDefault ? ACCENT : DIM, fontSize: 10, fontWeight: '700' }}>default</Text>
          </Pressable>
          <Pressable onPress={() => setPage(Math.min(maxPage, p + 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronRight" size={11} color={DIM} />
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
