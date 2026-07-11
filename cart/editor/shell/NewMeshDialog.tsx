// editor/shell/NewMeshDialog.tsx — the upfront "add a mesh at a chosen size" prompt.
//
// Picking File → New Mesh → <kind> opens this BEFORE the primitive drops in, exactly like
// the old studio mesh editor's add dialog: you set the dimensions + resolution first, so you
// get a properly-sized thing to paint on instead of a fixed unit cube. Fields are per-kind
// (a sphere has Diameter + Segments; a cube has Size + Height) — driven by PRIMITIVE_FIELDS,
// so this UI needs no per-kind code.
//
// UNITS (req_2624): dimensions are authored in u — 16 u = 1 tile = 1 m, the SAME basis the
// viewport's stage grid draws — as integer −/+ steppers (±1 fine, ±16 one tile) with a
// coarse slider scrubber under each row, plus a live "= X.XX tile" conversion readout.
// Add converts u → generator meters at the boundary (primitiveParamsFromU) and builds the
// mesh via primitivePartMesh. Rows sit on the shared control grid (REGIONS.grid, req_2626):
// fixed label column, fixed stepper/value columns, ONE right edge, labels never wrap.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Slider } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PRIMITIVE_MESHES } from '../data/commands';
import { PRIMITIVE_FIELDS, U_PER_TILE, defaultPrimitiveParamsU, primitiveParamsFromU, type PrimitiveField, type PrimitiveParams } from '../data/assetCatalog';
import { REGIONS } from './regions';
import type { PrimitiveKind } from '../data/types';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', TRACK = '#0f1012', BTN_BG = '#1f2126';
const G = REGIONS.grid;
/** Coarse ±16 (one tile) stepper button — two fine-button widths, no bespoke number. */
const COARSE_BTN = G.stepBtn * 2;
const MONO = 'ui-monospace';

function StepBtn({ label, width, onPress }: { label: string; width: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width, height: G.stepBtn, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: BTN_BG, borderWidth: 1, borderColor: BORDER }}
    >
      <Text style={{ color: TEXT, fontSize: 10, fontFamily: MONO, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export default function NewMeshDialog({ kind, mode, onCancel, onAdd }: { kind: PrimitiveKind; mode: 'new' | 'add'; onCancel: () => void; onAdd: (params: PrimitiveParams) => void }) {
  const meta = PRIMITIVE_MESHES.find((m) => m.kind === kind);
  const fields = PRIMITIVE_FIELDS[kind];
  // Dialog state lives in u space (integers); Add converts to generator meters once.
  const [p, setP] = useState<PrimitiveParams>(() => defaultPrimitiveParamsU(kind));
  const setField = (f: PrimitiveField, v: number) => {
    const clamped = Math.max(f.min, Math.min(f.max, Math.round(v)));
    setP((prev) => ({ ...prev, [f.key]: clamped }));
  };
  // 'new' spawns a fresh model document; 'add' appends this primitive as a part to the model in
  // view. The verb drives the title/button so the two never read as the same action (req_2542).
  const verb = mode === 'add' ? 'Add' : 'New';
  // Live tile conversion of every u dimension, in field order (⌀ for diameter kinds).
  const tileReadout = fields
    .filter((f) => f.unit === 'u')
    .map((f) => `${f.diameter ? '⌀' : ''}${(p[f.key] / U_PER_TILE).toFixed(2)} tile`)
    .join(' × ');

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 380, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name={meta?.icon ?? 'Box'} size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: '600' }}>{verb} {meta?.name ?? kind}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>
        <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>Units: {U_PER_TILE} u = 1 tile (1 m). Same basis as per-face UV.</Text>

        {fields.map((f) => (
          <Col key={f.label} style={{ gap: 4 }}>
            <Row style={{ minHeight: G.rowHeight, alignItems: 'center', gap: 4 }}>
              <Text noWrap numberOfLines={1} style={{ color: TEXT, fontSize: 11, minWidth: G.labelWidth }}>{f.label}</Text>
              <Box style={{ flexGrow: 1 }} />
              {/* Shared columns: [coarse][fine][value][fine][coarse] — count rows reserve the
                  coarse cells blank so every value cell + right edge lines up (req_2626). */}
              {f.unit === 'u'
                ? <StepBtn label={`−${U_PER_TILE}`} width={COARSE_BTN} onPress={() => setField(f, p[f.key] - U_PER_TILE)} />
                : <Box style={{ width: COARSE_BTN, height: G.stepBtn }} />}
              <StepBtn label="−" width={G.stepBtn} onPress={() => setField(f, p[f.key] - 1)} />
              <Text style={{ color: TEXT, fontSize: 10, fontFamily: MONO, fontWeight: '800', minWidth: G.valueWidth, textAlign: 'center' }}>
                {f.unit === 'u' ? `${Math.round(p[f.key])} u` : String(Math.round(p[f.key]))}
              </Text>
              <StepBtn label="+" width={G.stepBtn} onPress={() => setField(f, p[f.key] + 1)} />
              {f.unit === 'u'
                ? <StepBtn label={`+${U_PER_TILE}`} width={COARSE_BTN} onPress={() => setField(f, p[f.key] + U_PER_TILE)} />
                : <Box style={{ width: COARSE_BTN, height: G.stepBtn }} />}
            </Row>
            <Slider
              value={p[f.key]} min={f.min} max={f.max} step={1}
              onChange={(v: number) => setField(f, v)} onCommit={(v: number) => setField(f, v)}
              style={{ backgroundColor: TRACK, color: ACCENT, marginLeft: G.labelWidth + 4 }}
            />
          </Col>
        ))}

        <Row style={{ minHeight: G.rowHeight, alignItems: 'center', gap: 4 }}>
          <Text noWrap numberOfLines={1} style={{ color: DIM, fontSize: 10, fontFamily: MONO, minWidth: G.labelWidth }}>in tiles</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: ACCENT, fontSize: 10, fontFamily: MONO, fontWeight: '800' }}>= {tileReadout}</Text>
        </Row>

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => onAdd(primitiveParamsFromU(p))} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: ACCENT }}>
            <Text style={{ color: '#0d0e10', fontSize: 12, fontWeight: '700' }}>{verb} {meta?.name ?? kind}</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
