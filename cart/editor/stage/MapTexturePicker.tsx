// stage/MapTexturePicker.tsx — "paint THIS texture" (req_2494).
//
// The map-paint bar's tile channel arms a KIND (the semantic layer — pathing,
// cover, compile behavior). This popover binds the armed kind's LOOK to any
// surface material in the catalog: live ShaderThumb previews (the real WGSL,
// not name-guessing), paged on the ink-popover budget, plus the material's
// authored takes. Picking rebinds kind→(material, variant) in mapPaint state;
// mapPaint regenerates the ground formula and re-pushes it host-side.
import { useState } from 'react';
import { Box, Row, Col, Text, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { ShaderThumb } from '../shell/PaintToolbar';
import { FILL_SHADER } from '../render3d/shaders/index';
import { GROUND_MATERIALS, tileBindingFor, type TileMaterialOverrides } from '../render3d/groundFormula';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import type { MapPaintState } from './mapPaint';

const POP = '#17181b', LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', ACCENT = '#6ea8fe';
const PAGE_SIZE = 15; // live-Effect budget, same as the ink popover

// Thumb data for a registry material: the standard D[] tuple at Std grade.
// Seed 7 is arbitrary-but-fixed so thumbs are stable across opens.
const thumbData = (materialId: number, boardIndex: number, variant: number) => [materialId, variant, 7, 3, boardIndex];

export default function MapTexturePicker(props: {
  state: MapPaintState;
  onPatch: (patch: Partial<MapPaintState>) => void;
}) {
  const s = props.state;
  const kind = TILE_KINDS[s.tileKindIdx] ?? 'sidewalk';
  const def = tileKindDefinition(kind);
  const binding = tileBindingFor(kind, s.tileMaterialOverrides);
  const bound = GROUND_MATERIALS.find((m) => m.fn === binding.fn);
  const [page, setPage] = useState(() => {
    const at = GROUND_MATERIALS.findIndex((m) => m.fn === binding.fn);
    return at === -1 ? 0 : Math.floor(at / PAGE_SIZE);
  });
  const maxPage = Math.max(0, Math.ceil(GROUND_MATERIALS.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageMats = GROUND_MATERIALS.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const rebind = (fn: string, variant: number) => {
    props.onPatch({
      tileMaterialOverrides: { ...s.tileMaterialOverrides, [kind]: { fn, variant } },
      mode: 'paint',
    });
  };

  return (
    // Click-away scrim below the action bar; the panel drops from the bar.
    <Box style={{ position: 'absolute', left: 0, top: 122, right: 0, bottom: 0 }}>
      <Pressable onPress={() => props.onPatch({ texturePickerOpen: false })} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      <Col style={{ position: 'absolute', left: 410, top: 0, width: 320, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 7 }}>
          <Icon name="SwatchBook" size={13} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{def.label} paints:</Text>
          <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '700' }}>{bound?.name ?? binding.fn}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{p + 1}/{maxPage + 1}</Text>
        </Row>
        {/* The bound material's authored takes. */}
        {bound ? (
          <Row style={{ gap: 4 }}>
            {bound.variantLabels.map((label, v) => {
              const on = v === binding.variant;
              return (
                <Pressable key={label} onPress={() => rebind(bound.fn, v)}
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
              <Pressable key={m.fn} tooltip={`${m.name} (${m.board})`} onPress={() => rebind(m.fn, m.fn === binding.fn ? binding.variant : 0)}
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
            tooltip="Back to the curated default for this kind"
            onPress={() => {
              const next = { ...s.tileMaterialOverrides };
              delete next[kind];
              props.onPatch({ tileMaterialOverrides: next });
            }}
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, borderWidth: 1, borderColor: LINE }}
          >
            <Text style={{ color: DIM, fontSize: 10, fontWeight: '700' }}>reset kind</Text>
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
