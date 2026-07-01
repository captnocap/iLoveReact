// editor/shell/NewMeshDialog.tsx — the upfront "add a mesh at a chosen size" prompt.
//
// Picking File → New Mesh → <kind> opens this BEFORE the primitive drops in, exactly like
// the old studio mesh editor's add dialog: you set the dimensions + resolution first, so you
// get a properly-sized thing to paint on instead of a fixed unit cube. Fields are per-kind
// (a sphere has Diameter + Segments; a cube has Size + Height) — driven by PRIMITIVE_FIELDS,
// so this UI needs no per-kind code. Sliders settle on release; Add builds the mesh at the
// chosen params via primitivePartMesh.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Slider } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PRIMITIVE_MESHES } from '../data/commands';
import { PRIMITIVE_FIELDS, defaultPrimitiveParams, type PrimitiveParams } from '../data/hmscAssetCatalog';
import type { PrimitiveKind } from '../data/types';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', TRACK = '#0f1012';

export default function NewMeshDialog({ kind, onCancel, onAdd }: { kind: PrimitiveKind; onCancel: () => void; onAdd: (params: PrimitiveParams) => void }) {
  const meta = PRIMITIVE_MESHES.find((m) => m.kind === kind);
  const fields = PRIMITIVE_FIELDS[kind];
  const [p, setP] = useState<PrimitiveParams>(() => defaultPrimitiveParams(kind));
  const set = (key: keyof PrimitiveParams, v: number) => setP((prev) => ({ ...prev, [key]: v }));

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 380, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 14 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name={meta?.icon ?? 'Box'} size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: '600' }}>Add {meta?.name ?? kind}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>
        <Text style={{ color: DIM, fontSize: 11 }}>Set the dimensions before it drops in — bigger + higher resolution means more surface to paint on.</Text>

        {fields.map((f) => (
          <Col key={f.label} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: TEXT, fontSize: 11 }}>{f.label}</Text>
              <Text style={{ color: DIM, fontSize: 11, fontFamily: 'ui-monospace' }}>{f.step >= 1 ? String(Math.round(p[f.key])) : p[f.key].toFixed(1)}</Text>
            </Row>
            <Slider
              value={p[f.key]} min={f.min} max={f.max} step={f.step}
              onChange={(v: number) => set(f.key, v)} onCommit={(v: number) => set(f.key, v)}
              style={{ backgroundColor: TRACK, color: ACCENT }}
            />
          </Col>
        ))}

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => onAdd(p)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: ACCENT }}>
            <Text style={{ color: '#0d0e10', fontSize: 12, fontWeight: '700' }}>Add {meta?.name ?? kind}</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
