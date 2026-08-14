// editor/material/LabPickers.tsx — the Lab's picker popovers (req_4395),
// shared by the rail panels since req_4406: the STACK panel adds surfaces /
// filters / the base warp, the Lab inspector adds masks / layer warps. Each
// popover is a scrim overlay LOCAL to the panel that spawned it, so the card
// placement is panel-relative and fits the fixed rail-panel widths.
import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { fillShaderFor } from '../render3d/shaders/compose';
import { ATOMS, MATERIALS, type RegistryAtom, type RegistryMaterial } from '../render3d/shaders/_generated/registry';
import ShaderThumb from '../shell/ShaderThumb';
import { materialThumbData } from '../shell/MaterialPickerPopover';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe', PANEL = '#131519';

function Scrim({ onClose }: { onClose: () => void }) {
  return (
    <Pressable onPress={onClose} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
  );
}

// ── atom picker (fields/warps/colormods have no thumbnails — named rows) ──────
export function AtomPickerPopover(props: {
  title: string;
  kind: RegistryAtom['kind'];
  onPick: (fn: string) => void;
  onClear?: () => void;
  onClose: () => void;
  /** Panel-relative card placement — defaults fit the 350/326 rail panels. */
  top?: number;
  width?: number;
}) {
  const atoms = ATOMS.filter((atom) => atom.kind === props.kind);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Scrim onClose={props.onClose} />
      <Col style={{ position: 'absolute', left: 10, top: props.top ?? 52, width: props.width ?? 260, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 6 }}>
        <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{props.title}</Text>
        {atoms.map((atom) => (
          <Pressable key={atom.fn} onPress={() => { props.onPick(atom.fn); props.onClose(); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}>
            <Text style={{ color: TEXT, fontSize: 11, fontWeight: '700' }}>{atom.name}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text numberOfLines={1} noWrap style={{ color: FAINT, fontSize: 9 }}>{atom.tags.join(' · ')}</Text>
          </Pressable>
        ))}
        {props.onClear ? (
          <Pressable onPress={() => { props.onClear!(); props.onClose(); }}
            style={{ alignItems: 'center', height: 26, justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: LINE }}>
            <Text style={{ color: DIM, fontSize: 10, fontWeight: '700' }}>none</Text>
          </Pressable>
        ) : null}
      </Col>
    </Box>
  );
}

// ── surface material picker (by look, req_3401 — a paged live-thumbnail grid) ──
export function SurfacePickerPopover(props: {
  title: string;
  onPick: (fn: string) => void;
  onClose: () => void;
  top?: number;
}) {
  const PAGE = 15;
  const [page, setPage] = useState(0);
  const surfaces = useMemo(() => MATERIALS.filter((m) => m.kind === 'surface'), []);
  const maxPage = Math.max(0, Math.ceil(surfaces.length / PAGE) - 1);
  const p = Math.min(page, maxPage);
  const pageMats = surfaces.slice(p * PAGE, p * PAGE + PAGE);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Scrim onClose={props.onClose} />
      <Col style={{ position: 'absolute', left: 10, top: props.top ?? 52, width: 320, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 7 }}>
          <Icon name="SwatchBook" size={13} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{props.title}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{p + 1}/{maxPage + 1}</Text>
        </Row>
        <Row style={{ flexWrap: 'wrap', gap: 6, minHeight: 160 }}>
          {pageMats.map((m: RegistryMaterial) => (
            <Pressable key={m.fn} tooltip={`${m.name} (${m.board})`} onPress={() => { props.onPick(m.fn); props.onClose(); }}
              style={{ padding: 2, borderRadius: 8 }}>
              <ShaderThumb shader={fillShaderFor([m.fn])} data={materialThumbData(m.materialId, m.boardIndex, 0)} size={48} />
            </Pressable>
          ))}
        </Row>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setPage(Math.max(0, p - 1))} style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronLeft" size={11} color={DIM} />
          </Pressable>
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{surfaces.length} surfaces</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={() => setPage(Math.min(maxPage, p + 1))} style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronRight" size={11} color={DIM} />
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
