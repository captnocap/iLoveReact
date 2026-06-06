// ShaderLab — the art-layer authoring pane for a layered shader material.
//
//   ┌────────────────────────┬──────────────────┐
//   │  live 1-tile preview    │ variant picker    │
//   │  (asphalt base + the    │ ASPHALT (base)    │
//   │   selected overlay)     │   · sliders       │
//   │                         │ OVERLAY            │
//   │  ── materials library ──│   · sliders       │
//   │  [swatch][swatch]…      │ [ Materialize ]    │
//   └────────────────────────┴──────────────────┘
//
// The BASE (asphalt) lives in one shared value map — switch overlays and the
// asphalt stays put; drag the asphalt and every overlay's preview updates,
// because they all sit on the same base. "Materialize" freezes the current
// base+overlay into a named material (a frozen data[] snapshot) and drops it into
// the library strip as a live swatch — the art → material step.

import { useMemo, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, ScrollView, Text } from '@reactjit/primitives';
import { paramDefaults, type ShaderParam, type ShaderSpec } from '@game/textures/shaders';

interface Material { name: string; data: number[] }

function fmt(p: ShaderParam, v: number): string {
  const n = p.integer ? String(Math.round(v)) : v.toFixed(p.step < 0.05 ? 3 : 2);
  return p.unit ? `${n}${p.unit}` : n;
}

function snap(p: ShaderParam, v: number): number {
  const stepped = Math.round(v / p.step) * p.step;
  const clamped = Math.max(p.min, Math.min(p.max, stepped));
  return p.integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
}

// One labeled slider. Drag down/move/up all on the SAME node (pointer-capture
// rule); onLayout gives the track rect to map x → value.
function ParamSlider(props: { param: ShaderParam; value: number; onChange: (v: number) => void }) {
  const { param, value } = props;
  const [rect, setRect] = useState<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const range = param.max - param.min;
  const pct = range <= 0 ? 0 : Math.max(0, Math.min(1, (value - param.min) / range));
  const fromX = (sx: number) => {
    if (!rect || rect.width <= 0) return;
    const raw = (sx - rect.x) / rect.width;
    props.onChange(snap(param, param.min + Math.max(0, Math.min(1, raw)) * range));
  };
  return (
    <Col style={{ gap: 4 }}>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Text fontSize={9} color="#94a3b8" style={{ fontWeight: 800, letterSpacing: 1 }}>{param.label.toUpperCase()}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text fontSize={10} color="#e2e8f0" style={{ fontFamily: 'monospace', fontWeight: 800 }}>{fmt(param, value)}</Text>
      </Row>
      <Pressable
        onMouseDown={(p: any) => { setDragging(true); fromX(p.x); }}
        onMouseMove={(p: any) => { if (dragging) fromX(p.x); }}
        onMouseUp={() => setDragging(false)}
      >
        <Box onLayout={(r: any) => setRect({ x: r.x, width: r.width })} style={{ height: 20, borderRadius: 5, backgroundColor: '#0b1424', borderWidth: 1, borderColor: '#1e293b', position: 'relative', justifyContent: 'center' }}>
          <Box style={{ position: 'absolute', left: 6, right: 6, top: 9, height: 2, borderRadius: 1, backgroundColor: '#334155' }} />
          <Box style={{ position: 'absolute', left: 6, top: 9, width: Math.max(2, Math.round((rect ? rect.width - 12 : 100) * pct)), height: 2, borderRadius: 1, backgroundColor: '#38bdf8' }} />
          <Box style={{ position: 'absolute', left: 2 + Math.round((rect ? rect.width - 16 : 100) * pct), top: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: '#38bdf8', borderWidth: 2, borderColor: '#0a111d' }} />
        </Box>
      </Pressable>
    </Col>
  );
}

export function ShaderLab(props: {
  spec: ShaderSpec;
  // When set, Materialize ALSO hands the frozen look out (suggested name + the
  // exact data[] snapshot) — the texture studio persists it as a stored material.
  // Without it the lab is self-contained (the in-memory strip only), unchanged.
  onMaterialize?: (suggestedName: string, data: number[]) => void;
}) {
  const { spec } = props;

  // Shared base values (asphalt) — persist across variant switches.
  const [base, setBase] = useState<Record<string, number>>(() => paramDefaults(spec.base));
  // Overlay values, kept per-variant so each child remembers its own tuning.
  const [overlays, setOverlays] = useState<Record<string, Record<string, number>>>(
    () => Object.fromEntries(spec.variants.map((v) => [v.id, paramDefaults(v.params)])),
  );
  const [variantId, setVariantId] = useState(spec.variants[0].id);
  const [library, setLibrary] = useState<Material[]>([]);
  const [activeSpec, setActiveSpec] = useState(spec.id);

  // Reset everything when the selected shader changes.
  if (activeSpec !== spec.id) {
    setActiveSpec(spec.id);
    setBase(paramDefaults(spec.base));
    setOverlays(Object.fromEntries(spec.variants.map((v) => [v.id, paramDefaults(v.params)])));
    setVariantId(spec.variants[0].id);
  }

  const variant = spec.variants.find((v) => v.id === variantId) ?? spec.variants[0];
  const overlay = overlays[variant.id] ?? {};
  const data = useMemo(() => spec.buildData(variant.value, base, overlay), [spec, variant, base, overlay]);

  const setOverlayVal = (k: string, val: number) =>
    setOverlays((s) => ({ ...s, [variant.id]: { ...s[variant.id], [k]: val } }));
  const reset = () => {
    setBase(paramDefaults(spec.base));
    setOverlays((s) => ({ ...s, [variant.id]: paramDefaults(variant.params) }));
  };
  const materialize = () => {
    const name = `${spec.id}/${variant.id}${library.length ? `-${library.length}` : ''}`;
    setLibrary((lib) => [...lib, { name, data: [...data] }]);
    props.onMaterialize?.(name, [...data]);
  };

  return (
    <Row style={{ width: '100%', height: '100%' }}>
      {/* Preview + materials library */}
      <Col style={{ flexGrow: 1, minWidth: 0, height: '100%', backgroundColor: '#05080f' }}>
        <Box style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 12, position: 'relative' }}>
          <Box style={{ width: '100%', height: '100%', borderWidth: 1, borderColor: '#16202f', overflow: 'hidden' }}>
            <Effect shader={spec.shader} data={data} style={{ width: '100%', height: '100%' }} />
          </Box>
          <Text fontSize={8} color="#3a4a63" style={{ fontFamily: 'monospace', position: 'absolute', left: 16, bottom: 16 }}>1 tile · {variant.label}</Text>
        </Box>
        {/* Materials library — each materialized swatch is a frozen-data live tile */}
        <Box style={{ height: 78, borderTopWidth: 1, borderTopColor: '#16202f', backgroundColor: '#0a111d' }}>
          <Text fontSize={9} color="#cbd5e1" style={{ fontWeight: 800, letterSpacing: 1, paddingLeft: 10, paddingTop: 6 }}>MATERIALS ({library.length})</Text>
          <ScrollView horizontal style={{ flexGrow: 1 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 8, alignItems: 'center' }}>
            {library.length === 0 ? (
              <Text fontSize={9} color="#3a4a63" style={{ fontFamily: 'monospace' }}>materialize a look to bank it →</Text>
            ) : library.map((m, i) => (
              <Col key={i} style={{ alignItems: 'center', gap: 3 }}>
                <Box style={{ width: 40, height: 40, borderRadius: 4, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' }}>
                  <Effect shader={spec.shader} data={m.data} style={{ width: '100%', height: '100%' }} />
                </Box>
                <Text fontSize={7} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{m.name}</Text>
              </Col>
            ))}
          </ScrollView>
        </Box>
      </Col>

      {/* Layer controls */}
      <Box style={{ width: 196, height: '100%', borderLeftWidth: 1, borderLeftColor: '#16202f', backgroundColor: '#0a111d' }}>
        <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ padding: 10, gap: 12 }}>
          {/* Variant picker */}
          <Col style={{ gap: 4 }}>
            <Text fontSize={9} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>OVERLAY</Text>
            <Row style={{ flexWrap: 'wrap', gap: 4 }}>
              {spec.variants.map((v) => (
                <Pressable key={v.id} onPress={() => setVariantId(v.id)} style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: v.id === variantId ? '#38bdf8' : '#334155', backgroundColor: v.id === variantId ? '#0b2233' : '#0b1424' }}>
                  <Text fontSize={9} color={v.id === variantId ? '#f8fafc' : '#94a3b8'} style={{ fontFamily: 'monospace' }}>{v.label}</Text>
                </Pressable>
              ))}
            </Row>
          </Col>

          {/* Shared base */}
          <Col style={{ gap: 8 }}>
            <Text fontSize={9} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>ASPHALT · BASE (shared)</Text>
            {spec.base.map((p) => (
              <ParamSlider key={p.key} param={p} value={base[p.key]} onChange={(v) => setBase((s) => ({ ...s, [p.key]: v }))} />
            ))}
          </Col>

          {/* This overlay's params */}
          {variant.params.length > 0 ? (
            <Col style={{ gap: 8 }}>
              <Text fontSize={9} color="#64748b" style={{ fontWeight: 800, letterSpacing: 1 }}>{variant.label.toUpperCase()} · LAYER</Text>
              {variant.params.map((p) => (
                <ParamSlider key={p.key} param={p} value={overlay[p.key]} onChange={(v) => setOverlayVal(p.key, v)} />
              ))}
            </Col>
          ) : (
            <Text fontSize={9} color="#3a4a63" style={{ fontFamily: 'monospace' }}>base only — no overlay to tune</Text>
          )}

          {/* Actions */}
          <Row style={{ gap: 6 }}>
            <Pressable onPress={materialize} style={{ flexGrow: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#0f3d2e' }}>
              <Text fontSize={10} color="#86efac" style={{ fontWeight: 800, letterSpacing: 1 }}>MATERIALIZE</Text>
            </Pressable>
            <Pressable onPress={reset} style={{ alignItems: 'center', justifyContent: 'center', paddingLeft: 9, paddingRight: 9, borderRadius: 5, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1424' }}>
              <Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>reset</Text>
            </Pressable>
          </Row>
        </ScrollView>
      </Box>
    </Row>
  );
}
