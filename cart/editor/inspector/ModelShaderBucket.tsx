// editor/inspector/ModelShaderBucket.tsx — the "paint bucket": dip the brush into a SHADER
// instead of a flat color. Picking a bucket sets the brush's shader ink (a shader-spec id +
// its tuned params); ModelView bakes that recipe to pixels the host samples per dab, so the
// stroke deposits the material's LOOK onto the low-poly model (paint-with-a-shader, the
// __model_paint_material door). The sliders expose EVERY knob the spec declares — reshape any
// shader without touching WGSL — and only commit on release (the engine owns the thumb; the
// GPU re-bake never runs mid-drag). Sibling of the Color Studio in ModelBrushDock: picking a
// bucket switches to shader-paint, "Color" hands painting back to the studio's current color.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Slider } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { DARK_THEME, type Brush } from '@reactjit/runtime/paint';
import {
  shaderSpec, shaderGroups, paramDefaults, withPalette,
  type ShaderSpec, type ShaderParam,
} from '../textures/shaders';
import { shaderVariantData, shaderVariantIndex } from '../textures/shaderPick';
import ShaderThumb from '../shell/ShaderThumb';
import type { Rgb } from '../data/types';

// The live editing state for the active bucket: which spec, which variant (take), and every
// base/overlay param value. data[] is derived from these via spec.buildData on each commit.
type Editing = {
  spec: ShaderSpec;
  variant: number;
  base: Record<string, number>;
  overlay: Record<string, number>;
  tiles: number;
};

const PAGE_SIZE = 15;
const LINE = '#2a2c31';
const ACCENT = '#6ea8fe';

function seedEditing(spec: ShaderSpec, variantIndex = 0, tiles = 1): Editing {
  const idx = Math.max(0, Math.min(spec.variants.length - 1, variantIndex));
  const variant = spec.variants[idx] ?? spec.variants[0]!;
  return {
    spec,
    variant: idx,
    base: paramDefaults(spec.base),
    overlay: paramDefaults(variant.params),
    tiles,
  };
}

function fmt(p: ShaderParam, v: number): string {
  const s = p.integer ? String(Math.round(v)) : v.toFixed(2);
  return p.unit ? `${s}${p.unit}` : s;
}

export default function ModelShaderBucket(props: {
  brush: Brush;
  onBrush: (b: Brush) => void;
  colorHex: string;
  // Color Studio slot overrides for (specId, variant) — appended to the ink's
  // data[] so the brush deposits the USER'S palette, not just the baked one.
  paletteFor?: (specId: string, variant: number) => Rgb[] | null;
}) {
  const ink = props.brush.ink;
  const activeSurface = ink.kind === 'shader' ? ink.surface : null;
  const [editing, setEditing] = useState<Editing | null>(() => {
    if (ink.kind !== 'shader') return null;
    const spec = shaderSpec(ink.surface);
    return spec ? seedEditing(spec, shaderVariantIndex(spec, ink.data), ink.tiles ?? 1) : null;
  });
  const [page, setPage] = useState(() => {
    const flat = shaderGroups().flatMap((g) => g.specs);
    const at = activeSurface ? flat.findIndex((spec) => spec.id === activeSurface) : -1;
    return at === -1 ? 0 : Math.floor(at / PAGE_SIZE);
  });
  const [showList, setShowList] = useState(activeSurface == null);

  // Derive data[] from the editing state and push it onto the brush ink → ModelView's sync
  // effect bakes it. Called ONLY on release / discrete picks, never per slider move.
  const commit = (e: Editing) => {
    const variant = e.spec.variants[e.variant] ?? e.spec.variants[0];
    const data = withPalette(
      e.spec.buildData(variant.value, e.base, e.overlay),
      props.paletteFor?.(e.spec.id, e.variant) ?? null,
    );
    props.onBrush({ ...props.brush, ink: { kind: 'shader', surface: e.spec.id, data, tiles: e.tiles } });
  };

  const pickBucket = (spec: ShaderSpec, variantIndex = 0) => {
    const e = seedEditing(spec, variantIndex, editing?.tiles ?? 1);
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
        style={{ height: 24, backgroundColor: '#0f1012', color: '#6ea8fe' }}
      />
    </Col>
  );

  // ── The bucket browser (grouped catalog) ───────────────────────────────────────────
  if (showList || !editing) {
    const flat = shaderGroups().flatMap((g) => g.specs.map((spec) => ({ group: g.group, spec })));
    const maxPage = Math.max(0, Math.ceil(flat.length / PAGE_SIZE) - 1);
    const p = Math.min(page, maxPage);
    const pageItems = flat.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
    const shelves = pageItems.reduce<Array<{ group: string; specs: ShaderSpec[] }>>((out, item) => {
      const tail = out[out.length - 1];
      if (tail && tail.group === item.group) tail.specs.push(item.spec);
      else out.push({ group: item.group, specs: [item.spec] });
      return out;
    }, []);
    return (
      <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {label('PAINT BUCKET · MATERIAL')}
          {editing ? (
            <Pressable onPress={() => setShowList(false)}>
              <Text style={{ color: '#6ea8fe', fontSize: 10 }}>done</Text>
            </Pressable>
          ) : null}
        </Row>
        <Text style={{ color: DARK_THEME.dim, fontSize: 10 }}>Paint with reusable imported art or a retained procedural material.</Text>
        {editing ? (
          <Col style={{ gap: 5 }}>
            <Row style={{ alignItems: 'center', gap: 7 }}>
              <Text style={{ color: DARK_THEME.text, fontSize: 11, fontWeight: '700' }}>{editing.spec.label}</Text>
              <Text style={{ color: DARK_THEME.dim, fontSize: 10 }}>{editing.spec.group}</Text>
            </Row>
            {editing.spec.variants.length > 1 ? (
              <Row style={{ flexWrap: 'wrap', gap: 4 }}>
                {editing.spec.variants.map((variant, index) => {
                  const on = index === editing.variant;
                  return (
                    <Pressable key={variant.id} onPress={() => pickBucket(editing.spec, index)}
                      style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: on ? '#e8e8ea' : '#141518' }}>
                      <Text style={{ color: on ? '#0d0e10' : DARK_THEME.dim, fontSize: 10, fontWeight: '700' }}>{variant.label}</Text>
                    </Pressable>
                  );
                })}
              </Row>
            ) : null}
          </Col>
        ) : null}
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setPage(Math.max(0, p - 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronLeft" size={11} color={DARK_THEME.dim} />
          </Pressable>
          <Text style={{ color: DARK_THEME.dim, fontSize: 10, fontFamily: 'ui-monospace' }}>{p + 1}/{maxPage + 1}</Text>
          <Text style={{ color: DARK_THEME.dim, fontSize: 10, fontFamily: 'ui-monospace' }}>{flat.length} shaders</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={() => setPage(Math.min(maxPage, p + 1))}
            style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="ChevronRight" size={11} color={DARK_THEME.dim} />
          </Pressable>
        </Row>
        <Col style={{ gap: 8, minHeight: 204 }}>
          {shelves.map((shelf) => (
            <Col key={shelf.group} style={{ gap: 5 }}>
              {label(shelf.group.toUpperCase())}
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {shelf.specs.map((spec) => {
                  const on = spec.id === editing?.spec.id;
                  const variantIndex = on ? editing?.variant ?? 0 : 0;
                  return (
                    <Pressable key={spec.id} tooltip={`${spec.label} (${spec.group})`} onPress={() => pickBucket(spec, variantIndex)}
                      style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: on ? ACCENT : 'transparent' }}>
                      <ShaderThumb shader={spec.shader} data={shaderVariantData(spec, variantIndex, props.paletteFor)} size={44} />
                    </Pressable>
                  );
                })}
              </Row>
            </Col>
          ))}
        </Col>
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
          style={{ height: 24, backgroundColor: '#0f1012', color: '#6ee7a8' }}
        />
      </Col>
    </Col>
  );
}
