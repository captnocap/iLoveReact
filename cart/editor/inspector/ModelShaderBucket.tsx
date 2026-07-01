// editor/inspector/ModelShaderBucket.tsx — the "paint bucket": dip the brush into a SHADER
// instead of a flat color. Picking a bucket sets the brush's shader ink (a shader-spec id +
// its tuned params); ModelView bakes that recipe to pixels the host samples per dab, so the
// stroke deposits the material's LOOK onto the low-poly model (paint-with-a-shader, the
// __model_paint_material door). The sliders expose EVERY knob the spec declares — reshape any
// shader without touching WGSL — and only commit on release (the engine owns the thumb; the
// GPU re-bake never runs mid-drag). Sibling of the Color Studio in ModelBrushDock: picking a
// bucket switches to shader-paint, "Color" hands painting back to the studio's current color.
import { useState } from 'react';
import { Col, Row, Text, Pressable, ScrollView, Slider } from '../../../runtime/primitives';
import { DARK_THEME, type Brush } from '@reactjit/runtime/paint';
import {
  shaderSpec, shaderGroups, paramDefaults,
  type ShaderSpec, type ShaderParam,
} from '../textures/shaders';

// The live editing state for the active bucket: which spec, which variant (take), and every
// base/overlay param value. data[] is derived from these via spec.buildData on each commit.
type Editing = {
  spec: ShaderSpec;
  variant: number;
  base: Record<string, number>;
  overlay: Record<string, number>;
  tiles: number;
};

function seedEditing(spec: ShaderSpec): Editing {
  return {
    spec,
    variant: 0,
    base: paramDefaults(spec.base),
    overlay: paramDefaults(spec.variants[0].params),
    tiles: 1,
  };
}

function fmt(p: ShaderParam, v: number): string {
  const s = p.integer ? String(Math.round(v)) : v.toFixed(2);
  return p.unit ? `${s}${p.unit}` : s;
}

export default function ModelShaderBucket(props: { brush: Brush; onBrush: (b: Brush) => void; colorHex: string }) {
  const ink = props.brush.ink;
  const activeSurface = ink.kind === 'shader' ? ink.surface : null;
  const [editing, setEditing] = useState<Editing | null>(() => {
    if (ink.kind !== 'shader') return null;
    const spec = shaderSpec(ink.surface);
    return spec ? seedEditing(spec) : null;
  });
  const [showList, setShowList] = useState(activeSurface == null);

  // Derive data[] from the editing state and push it onto the brush ink → ModelView's sync
  // effect bakes it. Called ONLY on release / discrete picks, never per slider move.
  const commit = (e: Editing) => {
    const variant = e.spec.variants[e.variant] ?? e.spec.variants[0];
    const data = e.spec.buildData(variant.value, e.base, e.overlay);
    props.onBrush({ ...props.brush, ink: { kind: 'shader', surface: e.spec.id, data, tiles: e.tiles } });
  };

  const pickBucket = (spec: ShaderSpec) => {
    const e = seedEditing(spec);
    setEditing(e);
    setShowList(false);
    commit(e);
  };

  const backToColor = () => {
    setEditing(null);
    setShowList(true);
    props.onBrush({ ...props.brush, ink: { kind: 'color', hex: props.colorHex } });
  };

  const setVariant = (idx: number) => {
    if (!editing) return;
    const v = editing.spec.variants[idx] ?? editing.spec.variants[0];
    const e = { ...editing, variant: idx, overlay: paramDefaults(v.params) };
    setEditing(e);
    commit(e);
  };
  const setBase = (key: string, v: number) => {
    if (!editing) return;
    const e = { ...editing, base: { ...editing.base, [key]: v } };
    setEditing(e);
    commit(e);
  };
  const setOverlay = (key: string, v: number) => {
    if (!editing) return;
    const e = { ...editing, overlay: { ...editing.overlay, [key]: v } };
    setEditing(e);
    commit(e);
  };
  const setTiles = (v: number) => {
    if (!editing) return;
    const e = { ...editing, tiles: v };
    setEditing(e);
    commit(e);
  };

  const label = (t: string) => (
    <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{t}</Text>
  );

  const paramSlider = (p: ShaderParam, val: number, onCommit: (v: number) => void) => (
    <Col key={p.key} style={{ gap: 3 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: DARK_THEME.text, fontSize: 10 }}>{p.label}</Text>
        <Text style={{ color: DARK_THEME.dim, fontSize: 10, fontFamily: 'ui-monospace' }}>{fmt(p, val)}</Text>
      </Row>
      <Slider
        value={val} min={p.min} max={p.max} step={p.step || (p.integer ? 1 : 0.01)}
        onCommit={onCommit}
        style={{ backgroundColor: '#0f1012', color: '#6ea8fe' }}
      />
    </Col>
  );

  // ── The bucket browser (grouped catalog) ───────────────────────────────────────────
  if (showList || !editing) {
    return (
      <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {label('PAINT BUCKET · SHADER')}
          {editing ? (
            <Pressable onPress={() => setShowList(false)}>
              <Text style={{ color: '#6ea8fe', fontSize: 10 }}>done</Text>
            </Pressable>
          ) : null}
        </Row>
        <Text style={{ color: DARK_THEME.dim, fontSize: 10 }}>Dip the brush into a shader and paint it onto the model.</Text>
        <ScrollView style={{ height: 210 }}>
          <Col style={{ gap: 8 }}>
            {shaderGroups().map((g) => (
              <Col key={g.group} style={{ gap: 4 }}>
                {label(g.group.toUpperCase())}
                <Row style={{ flexWrap: 'wrap', gap: 4 }}>
                  {g.specs.map((spec) => {
                    const on = spec.id === activeSurface;
                    return (
                      <Pressable key={spec.id} onPress={() => pickBucket(spec)}>
                        <Text style={{
                          color: on ? '#0d0e10' : DARK_THEME.text, backgroundColor: on ? '#e8e8ea' : '#141518',
                          fontSize: 10, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                          borderRadius: 7, borderWidth: 1, borderColor: on ? '#e8e8ea' : '#2a2c31',
                        }}>{spec.label}</Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </Col>
            ))}
          </Col>
        </ScrollView>
      </Col>
    );
  }

  // ── The active bucket: variant + every param knob + tiling ──────────────────────────
  const spec = editing.spec;
  const variant = spec.variants[editing.variant] ?? spec.variants[0];
  return (
    <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {label('PAINT BUCKET · SHADER')}
        <Row style={{ gap: 10 }}>
          <Pressable onPress={() => setShowList(true)}>
            <Text style={{ color: '#6ea8fe', fontSize: 10 }}>change</Text>
          </Pressable>
          <Pressable onPress={backToColor}>
            <Text style={{ color: DARK_THEME.dim, fontSize: 10 }}>color</Text>
          </Pressable>
        </Row>
      </Row>
      <Text style={{ color: DARK_THEME.text, fontSize: 13, fontWeight: '600' }}>{spec.label}</Text>
      {spec.blurb ? <Text style={{ color: DARK_THEME.dim, fontSize: 10 }}>{spec.blurb}</Text> : null}

      {spec.variants.length > 1 ? (
        <Col style={{ gap: 4 }}>
          {label('TAKE')}
          <Row style={{ flexWrap: 'wrap', gap: 4 }}>
            {spec.variants.map((v, i) => {
              const on = i === editing.variant;
              return (
                <Pressable key={v.id} onPress={() => setVariant(i)}>
                  <Text style={{
                    color: on ? '#0d0e10' : DARK_THEME.text, backgroundColor: on ? '#e8e8ea' : '#141518',
                    fontSize: 10, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                    borderRadius: 6, borderWidth: 1, borderColor: on ? '#e8e8ea' : '#2a2c31',
                  }}>{v.label}</Text>
                </Pressable>
              );
            })}
          </Row>
        </Col>
      ) : null}

      {spec.base.length ? (
        <Col style={{ gap: 6 }}>
          {label('SHADER')}
          {spec.base.map((p) => paramSlider(p, editing.base[p.key] ?? p.default, (v) => setBase(p.key, v)))}
        </Col>
      ) : null}

      {variant.params.length ? (
        <Col style={{ gap: 6 }}>
          {label(variant.label.toUpperCase())}
          {variant.params.map((p) => paramSlider(p, editing.overlay[p.key] ?? p.default, (v) => setOverlay(p.key, v)))}
        </Col>
      ) : null}

      <Col style={{ gap: 3 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: DARK_THEME.text, fontSize: 10 }}>Tiles per face</Text>
          <Text style={{ color: DARK_THEME.dim, fontSize: 10, fontFamily: 'ui-monospace' }}>{editing.tiles.toFixed(1)}×</Text>
        </Row>
        <Slider
          value={editing.tiles} min={0.25} max={8} step={0.25}
          onCommit={setTiles}
          style={{ backgroundColor: '#0f1012', color: '#6ee7a8' }}
        />
      </Col>
    </Col>
  );
}
