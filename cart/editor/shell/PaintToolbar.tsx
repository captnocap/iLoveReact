// editor/shell/PaintToolbar.tsx — the paint controls SEGMENT of the ACTION BAR
// (ToolOptions — the row where the Paint/Vertex/wireframe buttons live). That row is
// THE toolbar for tools (req_2466 → req_2547 → req_2552: first a floating bar in the
// viewport, then wrongly the chrome/menu row — the action bar was the one meant).
// ToolOptions renders this inline after the mesh tools while painting; it carries no
// panel skin of its own.
//
// Hybrid layout (the user's pick): controls you touch constantly are inline (size, flow); the
// rich pickers are one click away. The "ink" swatch unifies the color picker and the shader
// buckets into ONE popover, and shaders show as rendered <Effect> THUMBNAILS instead of a
// wall of text names. What's my brush dipped in = one swatch.
//
// Split in two: PaintToolbar is the inline action-bar segment; PaintPopovers are the floating
// menus, which AppFrame renders LATE (this layout paints in tree order, so an overlay must
// be a late root child to sit over the body — same as DropdownMenu). The popovers hang from
// the action bar's bottom edge, over the workspace column.
import { useState } from 'react';
import { Box, Row, Col, Text, TextInput, Pressable, Slider, Effect } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { type Brush, type BrushTool } from '@reactjit/runtime/paint';
import { brushFromPreset, BRUSH_PRESETS, type BrushShape } from '../../../runtime/paint/model';
import { BrushIcon, ToolIcon } from '../../../runtime/paint/controls';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import type { ColorSpineHandlers } from '../inspector/ModelBrushDock';
import { shaderGroups, shaderSpec, type ShaderSpec } from '../textures/shaders';
import { shaderVariantData, shaderVariantIndex } from '../textures/shaderPick';
import type { Rgb } from '../data/types';

const BAR = '#131519', LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', ACCENT = '#6ea8fe', TRACK = '#0d0f13', POP = '#17181b';

export type PaintPopover = 'ink' | 'brush' | null;
type ShaderInk = Extract<Brush['ink'], { kind: 'shader' }>;

// The color/ink data + handlers both the bar and the popovers need.
type Ink = {
  brush: Brush;
  onBrush: (b: Brush) => void;
  current: OklchColor;
  palette: OklchColor[];
  recents: OklchColor[];
  scenePick: string | null;
  spine: ColorSpineHandlers;
  // Color Studio slot overrides for (specId, variant) — folded into a picked
  // shader ink's data[] so the brush deposits the USER'S palette.
  paletteFor?: (specId: string, variant: number) => Rgb[] | null;
  // Jump from the dipped shader ink to its Color Studio focus page.
  onEditMaterial?: (specId: string) => void;
};

type Tool = { id: BrushTool; tip: string };
const TOOLS: Tool[] = [
  { id: 'fill', tip: 'Fill — flood a whole face' },
  { id: 'brush', tip: 'Brush — free-form strokes' },
  { id: 'eraser', tip: 'Eraser — reveal the layer below' },
  { id: 'line', tip: 'Line — drag a straight stroke' },
  { id: 'rect', tip: 'Rectangle — drag an outline' },
  { id: 'ellipse', tip: 'Ellipse — drag an outline' },
  { id: 'eyedropper', tip: 'Pick — sample a color' },
  { id: 'marquee', tip: 'Marquee — rectangular paint selection' },
  { id: 'lasso', tip: 'Lasso — freehand paint selection' },
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

/** The current brush's analytic shape (presets and hand-tuned brushes alike). */
function brushShape(b: Brush): BrushShape {
  return b.stamp.kind === 'analytic' ? b.stamp.shape : 'round';
}

// ── The action-bar segment (ToolOptions renders this after the mesh tools) ────────────
export default function PaintToolbar(props: Ink & {
  brushTool: BrushTool;
  detail: number;
  onBrushTool: (t: BrushTool) => void;
  onCycleDetail: () => void;
  tools?: BrushTool[];
  popover: PaintPopover;
  onToggle: (which: 'ink' | 'brush') => void;
}) {
  const { brush } = props;
  const patch = (b: Partial<Brush>) => props.onBrush({ ...brush, ...b });
  const shaderInk = brush.ink.kind === 'shader' ? brush.ink : null;

  return (
    // Bare controls, no panel skin — this row lives INSIDE the action bar (req_2552).
    <Row style={{ alignItems: 'center', gap: 8 }}>
      <Pressable tooltip="Paint resolution — click to cycle" onPress={props.onCycleDetail} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 8, height: 26, borderRadius: 6, borderWidth: 1, borderColor: LINE }}>
        <Icon name="Grid3x3" size={12} color={DIM} />
        <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'ui-monospace' }}>{props.detail <= 1 ? 'fill' : `${props.detail}px`}</Text>
      </Pressable>

      <Divider />

      <Row style={{ gap: 3 }}>
        {TOOLS.filter((tool) => (props.tools ?? ['fill', 'brush', 'eyedropper']).includes(tool.id)).map((t) => {
          const on = props.brushTool === t.id;
          return (
            <Pressable key={t.id} tooltip={t.tip} onPress={() => props.onBrushTool(t.id)}
              style={{ width: 30, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ACCENT : 'transparent' }}>
              <ToolIcon tool={t.id} size={17} color={on ? '#0d0e10' : DIM} />
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

      <Pressable tooltip="Brush shape + dynamics" onPress={() => props.onToggle('brush')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingLeft: 6, paddingRight: 6, borderRadius: 6, borderWidth: 1, borderColor: props.popover === 'brush' ? ACCENT : LINE }}>
        {/* The CURRENT shape's own icon (the kit's stroke-look glyphs), not a generic dot. */}
        <BrushIcon shape={brushShape(brush)} size={16} color={TEXT} />
        <Text style={{ color: DIM, fontSize: 11 }}>{brushShape(brush)}</Text>
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

  const pickShader = (spec: ShaderSpec, variantIndex = 0) => {
    // Fold in the user's Color Studio slot overrides for the selected take.
    const data = shaderVariantData(spec, variantIndex, props.paletteFor);
    props.onBrush({ ...brush, ink: { kind: 'shader', surface: spec.id, data, tiles: shaderInk?.tiles ?? 1 } });
  };

  // Picking a color while a shader is dipped hands the brush back to color
  // paint — the pick means "paint with THIS", not "recolor the readout".
  const pickColor = (c: OklchColor) => {
    props.spine.onSetCurrent(c);
    if (shaderInk) props.onBrush({ ...brush, ink: { kind: 'color', hex: oklchToHex(c) } });
  };

  return (
    // Click-away scrim starting just below the ACTION BAR (chrome 37 + bar 36 — the row
    // the controls live in, req_2552); the panels hang from its bottom edge, over the
    // workspace column where the segment sits.
    <Box style={{ position: 'absolute', left: 0, top: 74, right: 0, bottom: 0 }}>
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
const SHADER_GRID_COLS = 5;

// The ink popover REMEMBERS where you were (req_3097: closing and reopening dropped
// you back at page 1 every time). Tab, page, and search survive close/reopen for the
// process lifetime — module scope, not hotstate: this is view memory, not a document.
let inkTabMemo: 'color' | 'shader' | null = null;
let shaderPageMemo = 0;
let shaderPageTouched = false;
let shaderQueryMemo = '';

function InkPanel(props: Ink & { pickShader: (s: ShaderSpec, variantIndex?: number) => void; pickColor: (c: OklchColor) => void; shaderInk: ShaderInk | null }) {
  // Which section is showing — remembered across opens, seeded from the current ink
  // the first time, and freely switchable so you can browse shaders while a color is
  // active (and back).
  const [tab, setTabState] = useState<'color' | 'shader'>(inkTabMemo ?? (props.shaderInk ? 'shader' : 'color'));
  const setTab = (t: 'color' | 'shader') => { inkTabMemo = t; setTabState(t); };
  const [query, setQueryState] = useState(shaderQueryMemo);
  const [shaderPage, setShaderPageState] = useState(() => {
    // Until you page by hand, opening with a shader dipped lands on ITS page —
    // never back at the front of the catalog.
    if (!shaderPageTouched && !shaderQueryMemo && props.shaderInk) {
      const at = shaderGroups().flatMap((g) => g.specs).findIndex((s) => s.id === props.shaderInk!.surface);
      if (at >= 0) return Math.floor(at / SHADER_PAGE_SIZE);
    }
    return shaderPageMemo;
  });
  const setShaderPage = (p: number) => { shaderPageMemo = p; shaderPageTouched = true; setShaderPageState(p); };
  const setQuery = (q: string) => {
    shaderQueryMemo = q;
    shaderPageMemo = 0;
    setShaderPageState(0);
    setQueryState(q);
  };
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
          current={props.current} palette={props.palette} recents={props.recents} scenePick={props.scenePick}
          onSetCurrent={props.pickColor} onAddToTray={props.spine.onAddToTray} onPickTray={props.pickColor}
          onScenePick={(c, css) => { props.spine.onScenePick(c, css); props.pickColor(c); }}
          onLoadLibrarySet={props.spine.onLoadLibrarySet}
        />
      ) : (
        (() => {
          // Flatten in shelf order, filter by the search, page the hits. The grid is
          // a FIXED 5-wide chunking of the page — group shelving used to restart the
          // wrap per group, so pages ran 4 rows or 8 depending on how the groups
          // split (req_3097). Group names now live in one caption line + tooltips.
          const flat = shaderGroups().flatMap((g) => g.specs.map((spec) => ({ group: g.group, spec })));
          const needle = query.trim().toLowerCase();
          const hits = needle
            ? flat.filter((item) => `${item.spec.label} ${item.spec.group} ${item.spec.id}`.toLowerCase().includes(needle))
            : flat;
          const maxPage = Math.max(0, Math.ceil(hits.length / SHADER_PAGE_SIZE) - 1);
          const page = Math.min(shaderPage, maxPage);
          const pageItems = hits.slice(page * SHADER_PAGE_SIZE, page * SHADER_PAGE_SIZE + SHADER_PAGE_SIZE);
          const first = hits.length === 0 ? 0 : page * SHADER_PAGE_SIZE + 1;
          const last = Math.min(hits.length, first + pageItems.length - 1);
          const groupsOnPage = pageItems
            .map((item) => item.group)
            .filter((group, index, all) => all.indexOf(group) === index)
            .join(' · ');
          const gridRows: Array<typeof pageItems> = [];
          for (let i = 0; i < pageItems.length; i += SHADER_GRID_COLS) {
            gridRows.push(pageItems.slice(i, i + SHADER_GRID_COLS));
          }
          const activeSpec = props.shaderInk ? shaderSpec(props.shaderInk.surface) : null;
          const activeVariant = activeSpec ? shaderVariantIndex(activeSpec, props.shaderInk?.data) : 0;
          return (
            <Col style={{ gap: 8 }}>
              {activeSpec ? (
                <Col style={{ gap: 5 }}>
                  <Row style={{ alignItems: 'center', gap: 7 }}>
                    <Text style={{ color: TEXT, fontSize: 11, fontWeight: '700' }}>{activeSpec.label}</Text>
                    <Text style={{ color: DIM, fontSize: 10 }}>{activeSpec.group}</Text>
                  </Row>
                  {activeSpec.variants.length > 1 ? (
                    <Row style={{ flexWrap: 'wrap', gap: 4 }}>
                      {activeSpec.variants.map((variant, index) => {
                        const on = index === activeVariant;
                        return (
                          <Pressable key={variant.id} onPress={() => props.pickShader(activeSpec, index)}
                            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: on ? '#e8e8ea' : '#141518' }}>
                            <Text style={{ color: on ? '#0d0e10' : DIM, fontSize: 10, fontWeight: '700' }}>{variant.label}</Text>
                          </Pressable>
                        );
                      })}
                    </Row>
                  ) : null}
                </Col>
              ) : null}
              {/* Search — 413 shaders were unfindable without one (req_3097). */}
              <Row style={{ alignItems: 'center', gap: 6 }}>
                <Icon name="Search" size={12} color={DIM} />
                <TextInput
                  value={query}
                  onChange={(value: string) => setQuery(value)}
                  style={{ flexGrow: 1, minWidth: 0, height: 24, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', color: TEXT, fontSize: 11 }}
                />
                {query ? (
                  <Pressable tooltip="Clear search" onPress={() => setQuery('')}
                    style={{ width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
                    <Icon name="X" size={11} color={DIM} />
                  </Pressable>
                ) : null}
              </Row>
              <Row style={{ alignItems: 'center', gap: 8 }}>
                <Pressable onPress={() => setShaderPage(Math.max(0, page - 1))}
                  style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
                  <Icon name="ChevronLeft" size={11} color={DIM} />
                </Pressable>
                <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{first}-{last} / {hits.length}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{page + 1}/{maxPage + 1}</Text>
                <Pressable onPress={() => setShaderPage(Math.min(maxPage, page + 1))}
                  style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
                  <Icon name="ChevronRight" size={11} color={DIM} />
                </Pressable>
              </Row>
              <Col style={{ gap: 6, minHeight: 290 }}>
                {groupsOnPage ? (
                  <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{groupsOnPage.toUpperCase()}</Text>
                ) : null}
                {gridRows.map((row, rowIndex) => (
                  <Row key={`${page}-${rowIndex}`} style={{ gap: 6 }}>
                    {row.map((item) => {
                      const on = item.spec.id === props.shaderInk?.surface;
                      const variantIndex = on ? activeVariant : 0;
                      return (
                        <Pressable key={item.spec.id} tooltip={`${item.spec.label} — ${item.group}`} onPress={() => props.pickShader(item.spec, variantIndex)}
                          style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: on ? ACCENT : 'transparent' }}>
                          <ShaderThumb shader={item.spec.shader} data={shaderVariantData(item.spec, variantIndex, props.paletteFor)} size={44} />
                        </Pressable>
                      );
                    })}
                  </Row>
                ))}
                {hits.length === 0 ? (
                  <Text style={{ color: DIM, fontSize: 11 }}>{`no shader matches "${query}"`}</Text>
                ) : null}
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
          const shape: BrushShape = preset.brush.stamp?.kind === 'analytic' ? preset.brush.stamp.shape : 'round';
          const on = brushShape(brush) === shape;
          return (
            <Pressable key={preset.id} tooltip={preset.label}
              onPress={() => onBrush({ ...brushFromPreset(preset), ink: brush.ink, size: brush.size, flow: brush.flow })}
              style={{ width: 34, height: 34, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? ACCENT : '#141518', borderWidth: 1, borderColor: on ? ACCENT : LINE }}>
              {/* Each preset wears ITS OWN stroke-look glyph (the kit's brushIconLayers,
                  req_1455) — a wall of identical Brush icons told you nothing (req_2547). */}
              <BrushIcon shape={shape} size={24} color={on ? '#0d0e10' : TEXT} />
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
