// editor/shell/PaintToolbar.tsx — the contextual paint bar that slides in UNDER the menu bar
// while painting a model (req_2466). It replaces the bottom-right Inspector brush dock: paint
// controls belong at the top, as icons — not a text-pill panel you reach into the corner for.
//
// Hybrid layout (the user's pick): controls you touch constantly are inline (size, flow); the
// rich pickers are one click away. The "ink" swatch is the headline fix — it unifies the color
// picker and the shader buckets into ONE popover, and shaders show as rendered <Effect>
// THUMBNAILS instead of a wall of text names. What's my brush dipped in = one swatch.
//
// Split in two: PaintToolbar is the in-flow bar (reserves layout, pushes the body down);
// PaintPopovers are the floating menus, which AppFrame renders LATE (this layout paints in tree
// order, so an overlay must be a late root child to sit over the body — same as DropdownMenu).
import { useState } from 'react';
import { Box, Row, Col, Text, Pressable, Slider, Effect } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { type Brush, type BrushTool } from '@reactjit/runtime/paint';
import { brushFromPreset, BRUSH_PRESETS } from '../../../runtime/paint/model';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import type { ColorSpineHandlers } from '../inspector/ModelBrushDock';
import { shaderGroups, defaultShaderData, shaderSpec, withPalette, type ShaderSpec } from '../textures/shaders';
import type { Rgb } from '../data/types';

const BAR = '#131519', LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', ACCENT = '#6ea8fe', TRACK = '#0d0f13', POP = '#17181b';

export type PaintPopover = 'ink' | 'brush' | null;

// The color/ink data + handlers both the bar and the popovers need.
type Ink = {
  brush: Brush;
  onBrush: (b: Brush) => void;
  current: OklchColor;
  palette: OklchColor[];
  scenePick: string | null;
  spine: ColorSpineHandlers;
  // Color Studio slot overrides for (specId, variant) — folded into a picked
  // shader ink's data[] so the brush deposits the USER'S palette.
  paletteFor?: (specId: string, variant: number) => Rgb[] | null;
  // Jump from the dipped shader ink to its Color Studio focus page.
  onEditMaterial?: (specId: string) => void;
};

type Tool = { id: BrushTool; icon: string; tip: string };
const TOOLS: Tool[] = [
  { id: 'fill', icon: 'PaintBucket', tip: 'Fill — flood a whole face' },
  { id: 'brush', icon: 'Brush', tip: 'Brush — free-form strokes' },
  { id: 'eyedropper', icon: 'Pipette', tip: 'Pick — sample a color off the model' },
];

// A live shader preview: the actual WGSL recipe rendered into a small quad — so you pick a
// material by SEEING it, not by reading its name. (Most fill materials share one pipeline, so
// a grid of these is cheap — same shader, different data[].) Exported: the map-paint texture
// picker uses the same thumbs.
export function ShaderThumb({ shader, data, size = 40 }: { shader: string; data: number[]; size?: number }) {
  return (
    <Box style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden' }}>
      <Effect shader={shader} data={data} style={{ width: size, height: size }} />
    </Box>
  );
}

function Divider() {
  return <Box style={{ width: 1, height: 20, backgroundColor: LINE }} />;
}

// ── The bar (in-flow, under the menu bar) ────────────────────────────────────────────
export default function PaintToolbar(props: Ink & {
  brushTool: BrushTool;
  detail: number;
  onBrushTool: (t: BrushTool) => void;
  onCycleDetail: () => void;
  popover: PaintPopover;
  onToggle: (which: 'ink' | 'brush') => void;
}) {
  const { brush } = props;
  const patch = (b: Partial<Brush>) => props.onBrush({ ...brush, ...b });
  const shaderInk = brush.ink.kind === 'shader' ? brush.ink : null;

  return (
    <Row style={{ height: 40, alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 10, backgroundColor: 'rgba(19,21,25,0.94)', borderWidth: 1, borderColor: LINE, borderRadius: 10 }}>
      <Pressable tooltip="Paint resolution — click to cycle" onPress={props.onCycleDetail} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, height: 26, borderRadius: 6, borderWidth: 1, borderColor: LINE }}>
        <Icon name="Grid3x3" size={12} color={DIM} />
        <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'ui-monospace' }}>{props.detail <= 1 ? 'fill' : `${props.detail}px`}</Text>
      </Pressable>

      <Divider />

      <Row style={{ gap: 3 }}>
        {TOOLS.map((t) => {
          const on = props.brushTool === t.id;
          return (
            <Pressable key={t.id} tooltip={t.tip} onPress={() => props.onBrushTool(t.id)}
              style={{ width: 30, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ACCENT : 'transparent' }}>
              <Icon name={t.icon} size={15} color={on ? '#0d0e10' : DIM} />
            </Pressable>
          );
        })}
      </Row>

      <Divider />

      <Pressable tooltip="Ink — color or shader material" onPress={() => props.onToggle('ink')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingRight: 6, borderRadius: 6, borderWidth: 1, borderColor: props.popover === 'ink' ? ACCENT : LINE }}>
        {shaderInk ? (
          <ShaderThumb shader={shaderSpec(shaderInk.surface)?.shader ?? ''} data={shaderInk.data ?? []} size={24} />
        ) : (
          <Box style={{ width: 24, height: 24, borderTopLeftRadius: 5, borderBottomLeftRadius: 5, backgroundColor: oklchToHex(props.current) }} />
        )}
        <Text style={{ color: DIM, fontSize: 11 }}>{shaderInk ? 'shader' : 'color'}</Text>
        <Icon name="ChevronDown" size={12} color={DIM} />
      </Pressable>

      <Divider />

      <Row style={{ alignItems: 'center', gap: 7 }}>
        <Icon name="Circle" size={13} color={DIM} />
        <Slider value={brush.size} min={1} max={128} step={1} onCommit={(v: number) => patch({ size: Math.round(v) })} style={{ width: 92, height: 30, backgroundColor: TRACK, color: ACCENT }} />
        <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'ui-monospace', width: 26 }}>{brush.size}</Text>
      </Row>

      <Row style={{ alignItems: 'center', gap: 7 }}>
        <Icon name="Waves" size={13} color={DIM} />
        <Slider value={brush.flow} min={0.02} max={1} step={0.01} onCommit={(v: number) => patch({ flow: v })} style={{ width: 80, height: 30, backgroundColor: TRACK, color: ACCENT }} />
        <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'ui-monospace', width: 34 }}>{Math.round(brush.flow * 100)}%</Text>
      </Row>

      <Divider />

      <Pressable tooltip="Brush shape + dynamics" onPress={() => props.onToggle('brush')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingLeft: 8, paddingRight: 6, borderRadius: 6, borderWidth: 1, borderColor: props.popover === 'brush' ? ACCENT : LINE }}>
        <Box style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: TEXT }} />
        <Text style={{ color: DIM, fontSize: 11 }}>{brush.stamp.kind === 'analytic' ? brush.stamp.shape : 'round'}</Text>
        <Icon name="ChevronDown" size={12} color={DIM} />
      </Pressable>
    </Row>
  );
}

// ── The floating popovers (rendered LATE by AppFrame so they sit over the body) ───────
export function PaintPopovers(props: Ink & { popover: PaintPopover; onClose: () => void }) {
  if (!props.popover) return null;
  const { brush } = props;
  const patch = (b: Partial<Brush>) => props.onBrush({ ...brush, ...b });
  const shaderInk = brush.ink.kind === 'shader' ? brush.ink : null;

  const pickShader = (spec: ShaderSpec) => {
    // Fold in the user's Color Studio slot overrides (variant 0 = the default take).
    const data = withPalette(defaultShaderData(spec), props.paletteFor?.(spec.id, 0) ?? null);
    props.onBrush({ ...brush, ink: { kind: 'shader', surface: spec.id, data, tiles: shaderInk?.tiles ?? 1 } });
  };

  // Picking a color while a shader is dipped hands the brush back to color
  // paint — the pick means "paint with THIS", not "recolor the readout".
  const pickColor = (c: OklchColor) => {
    props.spine.onSetCurrent(c);
    if (shaderInk) props.onBrush({ ...brush, ink: { kind: 'color', hex: oklchToHex(c) } });
  };

  return (
    // Click-away scrim starting just below the floating bar; the panel drops from the bar.
    <Box style={{ position: 'absolute', left: 0, top: 122, right: 0, bottom: 0 }}>
      <Pressable onPress={props.onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      {props.popover === 'ink' ? <InkPanel {...props} pickShader={pickShader} pickColor={pickColor} shaderInk={shaderInk} /> : null}
      {props.popover === 'brush' ? <BrushPanel brush={brush} patch={patch} onBrush={props.onBrush} /> : null}
    </Box>
  );
}

// One page of shader thumbnails. Every thumb is a LIVE <Effect> quad, so the page size is
// the live-shader budget: rendering the whole catalog at once (136 quads) dropped the editor
// 240fps → ~50fps. The library panel's pager is the proven answer — same move here.
const SHADER_PAGE_SIZE = 15;

function InkPanel(props: Ink & { pickShader: (s: ShaderSpec) => void; pickColor: (c: OklchColor) => void; shaderInk: { surface: string } | null }) {
  // Which section is showing — seeded from the current ink, but freely switchable so you can
  // browse shaders even while a color is active (and back).
  const [tab, setTab] = useState<'color' | 'shader'>(props.shaderInk ? 'shader' : 'color');
  const [shaderPage, setShaderPage] = useState(0);
  return (
    <Box style={{ position: 'absolute', left: 410, top: 0, width: 300, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12 }}>
      <Row style={{ gap: 4, marginBottom: 10 }}>
        {(['color', 'shader'] as const).map((t) => {
          const on = tab === t;
          return (
            <Pressable key={t} onPress={() => setTab(t)} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5, borderRadius: 7, backgroundColor: on ? '#e8e8ea' : '#141518' }}>
              <Text style={{ color: on ? '#0d0e10' : TEXT, fontSize: 11, fontWeight: '700' }}>{t === 'color' ? 'Color' : 'Shader'}</Text>
            </Pressable>
          );
        })}
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: DIM, fontSize: 10 }}>{tab === 'color' ? 'a color swatch' : 'a live shader'}</Text>
      </Row>
      {tab === 'color' ? (
        <ColorLibraryPanel
          current={props.current} palette={props.palette} scenePick={props.scenePick}
          onSetCurrent={props.pickColor} onAddToTray={props.spine.onAddToTray} onPickTray={props.pickColor}
          onScenePick={(c, css) => { props.spine.onScenePick(c, css); props.pickColor(c); }}
          onLoadLibrarySet={props.spine.onLoadLibrarySet}
        />
      ) : (
        (() => {
          // Flatten in shelf order, page, then re-shelve the page: a group caption
          // renders wherever the page crosses into a new group.
          const flat = shaderGroups().flatMap((g) => g.specs.map((spec) => ({ group: g.group, spec })));
          const maxPage = Math.max(0, Math.ceil(flat.length / SHADER_PAGE_SIZE) - 1);
          const page = Math.min(shaderPage, maxPage);
          const pageItems = flat.slice(page * SHADER_PAGE_SIZE, page * SHADER_PAGE_SIZE + SHADER_PAGE_SIZE);
          const first = flat.length === 0 ? 0 : page * SHADER_PAGE_SIZE + 1;
          const last = Math.min(flat.length, first + pageItems.length - 1);
          return (
            <Col style={{ gap: 8 }}>
              <Row style={{ alignItems: 'center', gap: 8 }}>
                <Pressable onPress={() => setShaderPage(Math.max(0, page - 1))}
                  style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
                  <Icon name="ChevronLeft" size={11} color={DIM} />
                </Pressable>
                <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{first}-{last} / {flat.length}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{page + 1}/{maxPage + 1}</Text>
                <Pressable onPress={() => setShaderPage(Math.min(maxPage, page + 1))}
                  style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
                  <Icon name="ChevronRight" size={11} color={DIM} />
                </Pressable>
              </Row>
              <Col style={{ gap: 8, minHeight: 290 }}>
                {pageItems.reduce<Array<{ group: string; specs: ShaderSpec[] }>>((shelves, item) => {
                  const tail = shelves[shelves.length - 1];
                  if (tail && tail.group === item.group) tail.specs.push(item.spec);
                  else shelves.push({ group: item.group, specs: [item.spec] });
                  return shelves;
                }, []).map((shelf) => (
                  <Col key={shelf.group} style={{ gap: 5 }}>
                    <Text style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{shelf.group.toUpperCase()}</Text>
                    <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                      {shelf.specs.map((spec) => {
                        const on = spec.id === props.shaderInk?.surface;
                        return (
                          <Pressable key={spec.id} tooltip={spec.label} onPress={() => props.pickShader(spec)}
                            style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: on ? ACCENT : 'transparent' }}>
                            <ShaderThumb shader={spec.shader} data={defaultShaderData(spec)} size={44} />
                          </Pressable>
                        );
                      })}
                    </Row>
                  </Col>
                ))}
              </Col>
              {props.shaderInk && props.onEditMaterial ? (
                <Pressable
                  onPress={() => props.onEditMaterial!(props.shaderInk!.surface)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 30, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: '#141518' }}
                >
                  <Icon name="Palette" size={12} color={ACCENT} />
                  <Text style={{ color: TEXT, fontSize: 11, fontWeight: '700' }}>open in Color Studio</Text>
                </Pressable>
              ) : null}
            </Col>
          );
        })()
      )}
    </Box>
  );
}

function BrushPanel({ brush, patch, onBrush }: { brush: Brush; patch: (b: Partial<Brush>) => void; onBrush: (b: Brush) => void }) {
  return (
    <Box style={{ position: 'absolute', left: 410, top: 0, width: 260, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 10 }}>
      <Text style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SHAPE</Text>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {BRUSH_PRESETS.map((preset) => {
          const on = brush.stamp.kind === 'analytic' && preset.brush.stamp?.kind === 'analytic' && brush.stamp.shape === preset.brush.stamp.shape;
          return (
            <Pressable key={preset.id} tooltip={preset.label}
              onPress={() => onBrush({ ...brushFromPreset(preset), ink: brush.ink, size: brush.size, flow: brush.flow })}
              style={{ width: 34, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ACCENT : '#141518', borderWidth: 1, borderColor: on ? ACCENT : LINE }}>
              <Icon name="Brush" size={15} color={on ? '#0d0e10' : DIM} />
            </Pressable>
          );
        })}
      </Row>
      <ScalarRow label="Hardness" value={brush.hardness} min={0} max={1} step={0.01} pct onCommit={(v) => patch({ hardness: v })} />
      <ScalarRow label="Scatter" value={brush.scatter} min={0} max={3} step={0.05} onCommit={(v) => patch({ scatter: v })} />
    </Box>
  );
}

function ScalarRow({ label, value, min, max, step, pct, onCommit }: { label: string; value: number; min: number; max: number; step: number; pct?: boolean; onCommit: (v: number) => void }) {
  return (
    <Col style={{ gap: 3 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: TEXT, fontSize: 10 }}>{label}</Text>
        <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{pct ? `${Math.round(value * 100)}%` : value.toFixed(2)}</Text>
      </Row>
      <Slider value={value} min={min} max={max} step={step} onCommit={onCommit} style={{ height: 24, backgroundColor: TRACK, color: ACCENT }} />
    </Col>
  );
}
