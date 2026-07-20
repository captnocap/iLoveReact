// SECTION C — persistent paint controls (req_3270).
//
// Paint is a center-stage context, so the left rail swaps the asset library for
// two stable pages while a model/facade painter is active:
//   • Tool Options — the canonical BrushKit controls, including every Brush dial.
//   • Ink          — the existing Color Library / live shader catalog.
//
// These are projections of the SAME Brush + color-spine state the painter uses.
// Nothing here owns a second brush, palette, or paint engine. Slider drag state
// remains isolated inside BrushDials so a scrub does not repaint AppFrame.
import { useState, type ReactNode } from 'react';
import { Box, Row, Col, Text, TextInput, Pressable, ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { type Brush, type BrushTool } from '@reactjit/runtime/paint';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import { ToolIcon } from '../../../runtime/paint/controls';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from './regions';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import { BrushDials, type ColorSpineHandlers } from '../inspector/ModelBrushDock';
import { shaderGroups, shaderSpec, type ShaderSpec } from '../textures/shaders';
import { shaderVariantData, shaderVariantIndex } from '../textures/shaderPick';
import type { Rgb } from '../data/types';
import { ShaderThumb } from './PaintToolbar';

const LINE = '#242a33';
const TEXT = '#e8edf6';
const DIM = '#8b93a3';
const ACCENT = '#6ea8fe';

const SHADER_PAGE_SIZE = 15;
const SHADER_GRID_COLS = 5;

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

const TOOL_LABEL: Record<BrushTool, string> = {
  brush: 'Brush',
  eraser: 'Eraser',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  fill: 'Fill',
  eyedropper: 'Eyedropper',
  smudge: 'Smudge',
  blur: 'Blur',
  text: 'Text',
  marquee: 'Marquee',
  lasso: 'Lasso',
};

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

export function PaintToolOptionsPanel(props: {
  brush: Brush;
  brushTool: BrushTool;
  detail: number;
  onBrush: (brush: Brush) => void;
  onInk: () => void;
}) {
  const shaderInk = props.brush.ink.kind === 'shader' ? props.brush.ink : null;
  const inkSpec = shaderInk ? shaderSpec(shaderInk.surface) : null;
  const inkPreview = inkSpec && shaderInk
    ? <ShaderThumb shader={inkSpec.shader} data={shaderInk.data ?? []} size={26} />
    : <Box style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: props.brush.ink.kind === 'color' ? props.brush.ink.hex : '#ffffff', borderWidth: 1, borderColor: LINE }} />;
  return (
    <PaintPanelShell
      icon="SlidersHorizontal"
      title="Tool Options"
      detail={<Text style={{ color: DIM, fontSize: 9, fontFamily: 'ui-monospace' }}>{props.detail <= 1 ? 'fill' : `${props.detail}px`}</Text>}
    >
      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
        <Col style={{ gap: 10, padding: REGIONS.contentBrowser.gutter }}>
          <Row style={{ minHeight: 46, alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: '#131519' }}>
            <Box style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: ACCENT }}>
              <ToolIcon tool={props.brushTool} size={20} color="#0d0e10" />
            </Box>
            <Col style={{ gap: 2 }}>
              <Text style={{ color: TEXT, fontSize: 12, fontWeight: '800' }}>{TOOL_LABEL[props.brushTool]}</Text>
              <Text style={{ color: DIM, fontSize: 9 }}>settings stay open while you paint</Text>
            </Col>
          </Row>
          <Pressable
            tooltip="Open the persistent Color / Shader ink page"
            onPress={props.onInk}
            style={{ height: 40, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: LINE, backgroundColor: '#131519' }}
          >
            {inkPreview}
            <Col style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
              <Text style={{ color: TEXT, fontSize: 10, fontWeight: '800' }}>Ink</Text>
              <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontFamily: 'ui-monospace' }}>
                {shaderInk ? inkSpec?.label ?? shaderInk.surface : props.brush.ink.kind === 'color' ? props.brush.ink.hex.toUpperCase() : props.brush.ink.kind}
              </Text>
            </Col>
            <Icon name="ChevronRight" size={12} color={DIM} />
          </Pressable>
          <BrushDials
            seed={props.brush}
            tool={props.brushTool}
            width={REGIONS.contentBrowser.innerWidth}
            onSync={props.onBrush}
          />
        </Col>
      </ScrollView>
    </PaintPanelShell>
  );
}

// View memory, not document state: switching rail pages never throws away the
// user's Color/Shader tab, search, or catalog page.
let inkTabMemo: 'color' | 'shader' | null = null;
let shaderPageMemo = 0;
let shaderPageTouched = false;
let shaderQueryMemo = '';

export function PaintInkPanel(props: PaintInkControls) {
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

  return (
    <PaintPanelShell icon="Palette" title="Ink" detail={inkPreview}>
      <Row style={{ gap: 5, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: LINE }}>
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
      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
        <Col style={{ gap: 8, padding: 12 }}>
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

      <Col style={{ gap: 6, minHeight: 290 }}>
        {groupsOnPage ? (
          <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{groupsOnPage.toUpperCase()}</Text>
        ) : null}
        {gridRows.map((row, rowIndex) => (
          <Row key={`${page}-${rowIndex}`} style={{ gap: 6 }}>
            {row.map((item) => {
              const active = item.spec.id === props.shaderInk?.surface;
              const variantIndex = active ? activeVariant : 0;
              return (
                <Pressable
                  key={item.spec.id}
                  tooltip={`${item.spec.label} — ${item.group}`}
                  onPress={() => props.onPick(item.spec, variantIndex)}
                  style={{ padding: 2, borderRadius: 8, borderWidth: 2, borderColor: active ? ACCENT : 'transparent' }}
                >
                  <ShaderThumb shader={item.spec.shader} data={shaderVariantData(item.spec, variantIndex, props.paletteFor)} size={44} />
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
