// SECTION C — the persistent Paint workspace (req_3270/3271).
//
// Paint is a PEER of the source libraries in the left rail, not a mode that
// destroys them. One panel keeps its tools, layers, brush, blend, Color Library,
// and shader catalog together while the right side remains free for the model
// outliner. Everything projects the painter's existing state; this file owns no
// second brush, layer program, palette, or paint engine.
import { useState, type ReactNode } from 'react';
import { Box, Row, Col, Text, TextInput, Pressable, ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import {
  BLEND_MODES,
  BrushToolPicker,
  DARK_THEME,
  type BlendMode,
  type Brush,
  type BrushTool,
} from '@reactjit/runtime/paint';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from './regions';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import { BrushDials, type ColorSpineHandlers } from '../inspector/ModelBrushDock';
import { shaderGroups, shaderSpec, type ShaderSpec } from '../textures/shaders';
import { shaderVariantData, shaderVariantIndex } from '../textures/shaderPick';
import type { Rgb } from '../data/types';
import ShaderThumb from './ShaderThumb';

const LINE = '#242a33';
const TEXT = '#e8edf6';
const DIM = '#8b93a3';
const ACCENT = '#6ea8fe';

// Content-browser density: eight columns × six rows exposes 48 materials at
// once (3.2× the old popover-shaped 5×3 catalog) without shrinking hit targets
// below a dependable 36px cell.
const SHADER_PAGE_SIZE = 48;
const SHADER_GRID_COLS = 8;
const SHADER_THUMB_SIZE = 32;

type ShaderInk = Extract<Brush['ink'], { kind: 'shader' }>;

export type PaintInkControls = {
  brush: Brush;
  onBrush: (brush: Brush) => void;
  current: OklchColor;
  palette: OklchColor[];
  recents: OklchColor[];
  scenePick: string | null;
  spine: ColorSpineHandlers;
  /** Color Studio overrides folded into a selected shader variant. */
  paletteFor?: (specId: string, variant: number) => Rgb[] | null;
  onEditMaterial?: (specId: string) => void;
};

export type PaintPanelProps = PaintInkControls & {
  brushTool: BrushTool;
  tools: readonly BrushTool[];
  onBrushTool: (tool: BrushTool) => void;
  resolution: { label: string; value: string; onCycle: () => void };
  safety?: { value: string; onCycle: () => void };
  /** Model paint keeps face alpha meaningful, so erase-blend is facade-only. */
  supportsEraseBlend: boolean;
  /** The target adapter's shared PaintLayersPanel. Pinned above scrolling controls. */
  layers?: ReactNode;
};

const COLOR_BLEND_MODES = BLEND_MODES.filter((mode): mode is Exclude<BlendMode, 'erase'> => mode !== 'erase');
const BLEND_TOOLS = new Set<BrushTool>(['brush', 'eraser', 'line', 'rect', 'ellipse', 'pen']);

function PaintPanelShell(props: {
  icon: string;
  title: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <C.HW_SidePanel>
      <C.HW_LibHead>
        <Icon name={props.icon} size={14} color={accentFor('primary')} />
        <C.HW_LibTitle>{props.title}</C.HW_LibTitle>
        <C.HW_Spacer />
        {props.detail}
      </C.HW_LibHead>
      {props.children}
    </C.HW_SidePanel>
  );
}

// View memory, not document state: reopening Paint never throws away the user's
// Color/Shader choice, search, or catalog page.
let inkTabMemo: 'color' | 'shader' | null = null;
let shaderPageMemo = 0;
let shaderPageTouched = false;
let shaderQueryMemo = '';

export function PaintPanel(props: PaintPanelProps) {
  const shaderInk = props.brush.ink.kind === 'shader' ? props.brush.ink : null;
  const [tab, setTabState] = useState<'color' | 'shader'>(inkTabMemo ?? (shaderInk ? 'shader' : 'color'));
  const [query, setQueryState] = useState(shaderQueryMemo);
  const [shaderPage, setShaderPageState] = useState(() => {
    if (!shaderPageTouched && !shaderQueryMemo && shaderInk) {
      const at = shaderGroups().flatMap((group) => group.specs).findIndex((spec) => spec.id === shaderInk.surface);
      if (at >= 0) return Math.floor(at / SHADER_PAGE_SIZE);
    }
    return shaderPageMemo;
  });

  const setTab = (next: 'color' | 'shader') => {
    inkTabMemo = next;
    setTabState(next);
  };
  const setShaderPage = (page: number) => {
    shaderPageMemo = page;
    shaderPageTouched = true;
    setShaderPageState(page);
  };
  const setQuery = (next: string) => {
    shaderQueryMemo = next;
    shaderPageMemo = 0;
    setShaderPageState(0);
    setQueryState(next);
  };

  const pickShader = (spec: ShaderSpec, variantIndex = 0) => {
    const data = shaderVariantData(spec, variantIndex, props.paletteFor);
    props.onBrush({
      ...props.brush,
      ink: { kind: 'shader', surface: spec.id, data, tiles: shaderInk?.tiles ?? 1 },
    });
  };
  // Choosing a color means dip the brush back into color paint, even if a
  // shader was active when this page opened.
  const pickColor = (color: OklchColor) => {
    props.spine.onSetCurrent(color);
    if (shaderInk) props.onBrush({ ...props.brush, ink: { kind: 'color', hex: oklchToHex(color) } });
  };

  const activeShaderSpec = shaderInk ? shaderSpec(shaderInk.surface) : null;
  const inkPreview = activeShaderSpec && shaderInk ? (
    <ShaderThumb shader={activeShaderSpec.shader} data={shaderInk.data ?? []} size={22} />
  ) : (
    <Box style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: oklchToHex(props.current), borderWidth: 1, borderColor: LINE }} />
  );
  const blendModes = props.supportsEraseBlend ? BLEND_MODES : COLOR_BLEND_MODES;

  return (
    <PaintPanelShell icon="Paintbrush" title="Paint" detail={inkPreview}>
      {/* Tool choice and layers stay pinned. The source browser remains one rail
          click away, and the right Model pane can keep its outliner visible. */}
      <Col style={{ gap: 8, padding: REGIONS.contentBrowser.gutter, borderBottomWidth: 1, borderBottomColor: LINE }}>
        <Text style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>TOOLS</Text>
        <BrushToolPicker
          tool={props.brushTool}
          tools={props.tools}
          onToolChange={props.onBrushTool}
          theme={DARK_THEME}
        />
        <Row style={{ gap: 6 }}>
          <Pressable
            tooltip={`${props.resolution.label} — click to cycle`}
            onPress={props.resolution.onCycle}
            style={{ flexGrow: 1, minWidth: 0, height: 29, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#131519', flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="Grid3x3" size={12} color={DIM} />
            <Text style={{ color: DIM, fontSize: 9, fontWeight: '800' }}>{props.resolution.label.toUpperCase()}</Text>
            <Box style={{ flexGrow: 1 }} />
            <Text style={{ color: TEXT, fontSize: 10, fontFamily: 'ui-monospace' }}>{props.resolution.value}</Text>
          </Pressable>
          {props.safety ? (
            <Pressable
              tooltip="Face safety — Clip follows the face under each dab; Lock masks the stroke to its pressed face"
              onPress={props.safety.onCycle}
              style={{ width: 88, height: 29, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#131519', flexDirection: 'row', alignItems: 'center', gap: 5 }}
            >
              <Icon name="ShieldCheck" size={12} color={DIM} />
              <Text style={{ color: TEXT, fontSize: 10, fontWeight: '800' }}>{props.safety.value}</Text>
            </Pressable>
          ) : null}
        </Row>
        {props.layers}
      </Col>
      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
        <Col style={{ gap: 12, padding: REGIONS.contentBrowser.gutter }}>
          <BrushDials
            seed={props.brush}
            tool={props.brushTool}
            width={REGIONS.contentBrowser.innerWidth}
            showBlend={BLEND_TOOLS.has(props.brushTool)}
            blendModes={blendModes}
            onSync={props.onBrush}
          />
          <Col style={{ gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: '#131519' }}>
            <Row style={{ alignItems: 'center', gap: 7 }}>
              <Text style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>INK</Text>
              <Box style={{ flexGrow: 1 }} />
              {inkPreview}
            </Row>
            <Row style={{ gap: 5 }}>
              {(['color', 'shader'] as const).map((choice) => {
                const active = tab === choice;
                return (
                  <Pressable
                    key={choice}
                    onPress={() => setTab(choice)}
                    style={{ flexGrow: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: active ? '#e8e8ea' : '#141518', borderWidth: 1, borderColor: active ? '#e8e8ea' : LINE }}
                  >
                    <Text style={{ color: active ? '#0d0e10' : TEXT, fontSize: 11, fontWeight: '700' }}>{choice === 'color' ? 'Color' : 'Shader'}</Text>
                  </Pressable>
                );
              })}
            </Row>
          {tab === 'color' ? (
            <ColorLibraryPanel
              current={props.current}
              palette={props.palette}
              recents={props.recents}
              scenePick={props.scenePick}
              onSetCurrent={pickColor}
              onAddToTray={props.spine.onAddToTray}
              onPickTray={pickColor}
              onScenePick={(color, css) => { props.spine.onScenePick(color, css); pickColor(color); }}
              onLoadLibrarySet={props.spine.onLoadLibrarySet}
            />
          ) : (
            <ShaderLibrary
              query={query}
              page={shaderPage}
              shaderInk={shaderInk}
              paletteFor={props.paletteFor}
              onQuery={setQuery}
              onPage={setShaderPage}
              onPick={pickShader}
              onEditMaterial={props.onEditMaterial}
            />
          )}
          </Col>
        </Col>
      </ScrollView>
    </PaintPanelShell>
  );
}

function ShaderLibrary(props: {
  query: string;
  page: number;
  shaderInk: ShaderInk | null;
  paletteFor?: PaintInkControls['paletteFor'];
  onQuery: (query: string) => void;
  onPage: (page: number) => void;
  onPick: (spec: ShaderSpec, variantIndex?: number) => void;
  onEditMaterial?: (specId: string) => void;
}) {
  const flat = shaderGroups().flatMap((group) => group.specs.map((spec) => ({ group: group.group, spec })));
  const needle = props.query.trim().toLowerCase();
  const hits = needle
    ? flat.filter((item) => `${item.spec.label} ${item.spec.group} ${item.spec.id}`.toLowerCase().includes(needle))
    : flat;
  const maxPage = Math.max(0, Math.ceil(hits.length / SHADER_PAGE_SIZE) - 1);
  const page = Math.min(props.page, maxPage);
  const pageItems = hits.slice(page * SHADER_PAGE_SIZE, page * SHADER_PAGE_SIZE + SHADER_PAGE_SIZE);
  const first = hits.length === 0 ? 0 : page * SHADER_PAGE_SIZE + 1;
  const last = Math.min(hits.length, first + pageItems.length - 1);
  const groupsOnPage = pageItems
    .map((item) => item.group)
    .filter((group, index, all) => all.indexOf(group) === index)
    .join(' · ');
  const gridRows: Array<typeof pageItems> = [];
  for (let index = 0; index < pageItems.length; index += SHADER_GRID_COLS) {
    gridRows.push(pageItems.slice(index, index + SHADER_GRID_COLS));
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
                const active = index === activeVariant;
                return (
                  <Pressable
                    key={variant.id}
                    onPress={() => props.onPick(activeSpec, index)}
                    style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 7, backgroundColor: active ? '#e8e8ea' : '#141518' }}
                  >
                    <Text style={{ color: active ? '#0d0e10' : DIM, fontSize: 10, fontWeight: '700' }}>{variant.label}</Text>
                  </Pressable>
                );
              })}
            </Row>
          ) : null}
        </Col>
      ) : null}

      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Icon name="Search" size={12} color={DIM} />
        <TextInput
          value={props.query}
          onChange={props.onQuery}
          placeholder="Search shaders..."
          style={{ flexGrow: 1, minWidth: 0, height: 26, paddingLeft: 8, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', color: TEXT, fontSize: 11 }}
        />
        {props.query ? (
          <Pressable tooltip="Clear search" onPress={() => props.onQuery('')} style={{ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Icon name="X" size={11} color={DIM} />
          </Pressable>
        ) : null}
      </Row>

      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => props.onPage(Math.max(0, page - 1))} style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
          <Icon name="ChevronLeft" size={11} color={DIM} />
        </Pressable>
        <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{first}-{last} / {hits.length}</Text>
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{page + 1}/{maxPage + 1}</Text>
        <Pressable onPress={() => props.onPage(Math.min(maxPage, page + 1))} style={{ width: 24, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
          <Icon name="ChevronRight" size={11} color={DIM} />
        </Pressable>
      </Row>

      <Col style={{ gap: 4, minHeight: 224 }}>
        {groupsOnPage ? (
          <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{groupsOnPage.toUpperCase()}</Text>
        ) : null}
        {gridRows.map((row, rowIndex) => (
          <Row key={`${page}-${rowIndex}`} style={{ gap: 4 }}>
            {row.map((item) => {
              const active = item.spec.id === props.shaderInk?.surface;
              const variantIndex = active ? activeVariant : 0;
              return (
                <Pressable
                  key={item.spec.id}
                  tooltip={`${item.spec.label} — ${item.group}`}
                  onPress={() => props.onPick(item.spec, variantIndex)}
                  style={{ width: 36, height: 36, padding: 1, borderRadius: 6, borderWidth: 2, borderColor: active ? ACCENT : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                >
                  <ShaderThumb shader={item.spec.shader} data={shaderVariantData(item.spec, variantIndex, props.paletteFor)} size={SHADER_THUMB_SIZE} />
                </Pressable>
              );
            })}
          </Row>
        ))}
        {hits.length === 0 ? <Text style={{ color: DIM, fontSize: 11 }}>{`no shader matches "${props.query}"`}</Text> : null}
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
}
