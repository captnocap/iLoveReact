// shell/MaterialPickerPopover.tsx — pick a surface material BY LOOK (req_3401).
//
// The ONE picker organ: a paged grid of live shader thumbnails + the bound
// material's variant chips + a click-away scrim. The user's ruling: materials
// are known "only by the way they look" — no surface may ever resolve a
// material from a typed string. MapTexturePicker (the tile brush look) and the
// Rig panel's live-material binding both ride this popover; grow it here, not
// as a sibling.
//
// Rendered at the APP ROOT (overlays are root-last-children — never inside a
// scrolling column). The anchor prop places the panel; the scrim closes it.
import { useState } from 'react';
import { Box, Row, Col, Text, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import ShaderThumb from './ShaderThumb';
import { fillShaderFor } from '../render3d/shaders/compose';
import type { RegistryMaterial } from '../render3d/shaders/_generated/registry';

const POP = '#17181b', LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', ACCENT = '#6ea8fe';
const PAGE_SIZE = 15; // live-Effect budget, same as the persistent Ink panel

// Thumb data for a registry material: the standard D[] tuple at Std grade.
// Seed 7 is arbitrary-but-fixed so thumbs are stable across opens.
export const materialThumbData = (materialId: number, boardIndex: number, variant: number) => [materialId, variant, 7, 3, boardIndex];

export default function MaterialPickerPopover(props: {
  /** header lead-in, e.g. "SIDEWALK brush paints:" or "Surface 1 wears:" */
  title: string;
  boundFn: string | null;
  boundVariant: number;
  materials: readonly RegistryMaterial[];
  onPick: (fn: string, variant: number) => void;
  onClose: () => void;
  /** absolute placement of the panel (the scrim always covers everything). */
  anchor: { left?: number; right?: number; top?: number; bottom?: number };
  /** optional extra footer control (MapTexturePicker's "default" chip). */
  footerExtra?: any;
}) {
  const bound = props.boundFn ? props.materials.find((m) => m.fn === props.boundFn) ?? null : null;
  const [page, setPage] = useState(() => {
    const at = props.boundFn ? props.materials.findIndex((m) => m.fn === props.boundFn) : -1;
    return at === -1 ? 0 : Math.floor(at / PAGE_SIZE);
  });
  const maxPage = Math.max(0, Math.ceil(props.materials.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageMats = props.materials.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  return (
    // Click-away scrim over the editor; the panel sits at the caller's anchor.
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Pressable onPress={props.onClose} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      <Col style={{ position: 'absolute', ...props.anchor, width: 320, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 7 }}>
          <Icon name="SwatchBook" size={13} color={ACCENT} />
          <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{props.title}</Text>
          <Text numberOfLines={1} noWrap style={{ color: ACCENT, fontSize: 12, fontWeight: '700' }}>{bound?.name ?? (props.boundFn ?? 'none')}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{p + 1}/{maxPage + 1}</Text>
        </Row>
        {/* The bound material's authored takes — each take is its own pick. */}
        {bound ? (
          <Row style={{ gap: 4 }}>
            {bound.variantLabels.map((label, v) => {
              const on = v === props.boundVariant;
              return (
                <Pressable key={label} onPress={() => props.onPick(bound.fn, v)}
                  style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: on ? '#e8e8ea' : '#141518' }}>
                  <Text style={{ color: on ? '#0d0e10' : DIM, fontSize: 10, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              );
            })}
          </Row>
        ) : null}
        <Row style={{ flexWrap: 'wrap', gap: 6, minHeight: 160 }}>
          {pageMats.map((m) => {
            const on = m.fn === props.boundFn;
            return (
              <Pressable key={m.fn} tooltip={`${m.name} (${m.board})`} onPress={() => props.onPick(m.fn, on ? props.boundVariant : 0)}
                style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: on ? ACCENT : 'transparent' }}>
                <ShaderThumb shader={fillShaderFor([m.fn])} data={materialThumbData(m.materialId, m.boardIndex, on ? props.boundVariant : 0)} size={48} />
              </Pressable>
            );
          })}
        </Row>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setPage(Math.max(0, p - 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronLeft" size={11} color={DIM} />
          </Pressable>
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{props.materials.length} materials</Text>
          <Box style={{ flexGrow: 1 }} />
          {props.footerExtra ?? null}
          <Pressable onPress={() => setPage(Math.min(maxPage, p + 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronRight" size={11} color={DIM} />
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
