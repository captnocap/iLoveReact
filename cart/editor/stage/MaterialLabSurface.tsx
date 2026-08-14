// editor/stage/MaterialLabSurface.tsx — the Material Lab bench (req_4395).
//
// Replaces the Color Studio's Material Palette view for catalog materials:
// left gutter = THE STACK (base at bottom, layers above, PaintLayersPanel's
// chevron-move idiom), center stage = the material BIG (tiled via the packed
// grid envelope — real tiling, not a floating swatch) with the INTERMEDIATES
// STRIP (one packed-grid Effect, stage prefixes dispatched by materialId),
// right gutter = the context inspector (DIALS-style param sliders live through
// mat_param — zero recompiles — plus per-layer palette slots opening the
// shared color picker inline; the Library-tab round trip is dead).
//
// Two-speed discipline in code: every shader string in this file memoizes on
// recipeTopologyKey ONLY. Slider drags mutate a local draft (rendered through
// recipeData overrides), commit on release into the recipe document — and the
// commit still never recomposes, because stored numbers are not topology.
import { useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { FILL_GRID_DATA } from '../render3d/shaders/index';
import { fillShaderFor } from '../render3d/shaders/compose';
import { ATOMS, MATERIALS, type RegistryAtom, type RegistryMaterial } from '../render3d/shaders/_generated/registry';
import {
  recipeData,
  recipeParams,
  recipeShader,
  recipeSlots,
  recipeStageData,
  recipeStageShader,
  recipeTopologyKey,
  validateRecipe,
  type MaterialRecipe,
  type RecipeParamEntry,
} from '../render3d/shaders/recipe';
import { FILL_GRADES } from '../textures/shaders';
import ColorLibraryPanel from './ColorLibraryPanel';
import ShaderThumb from '../shell/ShaderThumb';
import { materialThumbData } from '../shell/MaterialPickerPopover';
import { oklchToRgb01, rgb01ToHex, type OklchColor } from '../../../runtime/paint/colors';
import type { EditorState, Rgb } from '../data/types';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe', PANEL = '#131519';

const BLEND_LABELS = ['over', 'add', 'mult', 'screen'] as const;
const STAGE_STRIP_CELL = 56;
const TILE_CHOICES = [1, 2, 4, 6] as const;

/** Session recompose counter — the dev-facing proof surface for the two-speed
 *  contract: slider drags must not move it, topology edits move it by one. */
let g_labComposeCount = 0;

export type LabRecipeEdit = (recipe: MaterialRecipe) => MaterialRecipe | null;

export type LabHandlers = {
  /** Undoable document edit — AppFrame snapshots before/after into the lab history. */
  onEditRecipe: (label: string, edit: LabRecipeEdit) => void;
  onRenameRecipe: (name: string) => void;
  onSelectLayer: (layer: number | null) => void;
  onSoloStage: (stage: number | null) => void;
  onStageTiles: (tiles: number) => void;
  onVariant: (variant: number) => void;
  onSeed: () => void;
  onQuality: (quality: number) => void;
  /** the shared spine — colors picked in the inline popover record RECENT. */
  onSpineCurrent: (color: OklchColor) => void;
  onSpineAddToTray: () => void;
  onSpineLoadLibrarySet: (name: string, colors: OklchColor[]) => void;
  /** Promote this recipe to a real materials/*.wgsl + rerun the generator. */
  onSaveToCatalog: () => void;
  onDeleteRecipe: () => void;
};

// ── generic packed-grid packer (no Paint-tuning cap — the envelope is generic) ──
function packLabGrid(rows: readonly number[][], columns: number, cellSize: number, gap: number): number[] {
  const packed = [
    FILL_GRID_DATA.marker, rows.length, columns, cellSize, gap, cellSize, 0, 0,
    ...rows.map(() => -1),
  ];
  rows.forEach((row, index) => {
    packed[FILL_GRID_DATA.offsetStartIndex + index] = packed.length;
    packed.push(...row);
  });
  return packed;
}

/** N×N tiling of ONE row: every cell offset points at the same row. */
function packTiledPreview(row: readonly number[], tiles: number, cellSize: number): number[] {
  const count = tiles * tiles;
  const packed = [
    FILL_GRID_DATA.marker, count, tiles, cellSize, 0, cellSize, 0, 0,
    ...Array.from({ length: count }, () => -1),
  ];
  const at = packed.length;
  packed.push(...row);
  for (let index = 0; index < count; index += 1) packed[FILL_GRID_DATA.offsetStartIndex + index] = at;
  return packed;
}

// ── DIALS-style slider (drag pattern per req_1455; local draft per req_2365) ──
function DialRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [rect, setRect] = useState<{ x: number; width: number } | null>(null);
  const dragRef = useRef(false);
  const lastRef = useRef(props.value);
  const span = Math.max(1e-6, props.max - props.min);
  const t = Math.max(0, Math.min(1, (props.value - props.min) / span));
  const pick = (p: any) => {
    if (!rect) return;
    const x = Math.max(0, Math.min(1, (Number(p?.x) - rect.x) / Math.max(1, rect.width)));
    const value = props.min + x * span;
    lastRef.current = value;
    props.onPreview(value);
  };
  const end = () => {
    if (!dragRef.current) return;
    dragRef.current = false;
    props.onCommit(lastRef.current);
  };
  return (
    <Row style={{ alignItems: 'center', gap: 7 }}>
      <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontWeight: '700', width: 118 }}>{props.label.toUpperCase()}</Text>
      <Pressable
        onMouseDown={(p: any) => { dragRef.current = true; pick(p); }}
        onMouseMove={(p: any) => { if (dragRef.current) pick(p); }}
        onMouseUp={end}
        onMouseLeave={end}
        style={{ flexGrow: 1, minWidth: 0 }}
      >
        <Box onLayout={(r: any) => setRect({ x: r.x, width: r.width })}
          style={{ height: 14, borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', position: 'relative', overflow: 'hidden' }}>
          <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(t * 100)}%`, backgroundColor: '#2a3a52' }} />
        </Box>
      </Pressable>
      <Text style={{ color: TEXT, fontSize: 10, fontFamily: 'ui-monospace', width: 44 }}>{props.value.toFixed(2)}</Text>
    </Row>
  );
}

// ── atom picker popover (fields/warps/colormods have no thumbnails — named rows) ──
function AtomPickerPopover(props: {
  title: string;
  kind: RegistryAtom['kind'];
  onPick: (fn: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const atoms = ATOMS.filter((atom) => atom.kind === props.kind);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Pressable onPress={props.onClose} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      <Col style={{ position: 'absolute', left: 250, top: 80, width: 260, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 6 }}>
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
function SurfacePickerPopover(props: {
  title: string;
  onPick: (fn: string) => void;
  onClose: () => void;
}) {
  const PAGE = 15;
  const [page, setPage] = useState(0);
  const surfaces = useMemo(() => MATERIALS.filter((m) => m.kind === 'surface'), []);
  const maxPage = Math.max(0, Math.ceil(surfaces.length / PAGE) - 1);
  const p = Math.min(page, maxPage);
  const pageMats = surfaces.slice(p * PAGE, p * PAGE + PAGE);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Pressable onPress={props.onClose} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
      <Col style={{ position: 'absolute', left: 250, top: 60, width: 320, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 8 }}>
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

function SectionHead(props: { icon: string; children: unknown }) {
  return (
    <C.HW_GroupTitle>
      <Icon name={props.icon} size={12} color={accentFor('primary')} />
      <C.HW_GroupText>{props.children}</C.HW_GroupText>
    </C.HW_GroupTitle>
  );
}

type PopoverState =
  | { kind: 'add-surface' }
  | { kind: 'add-colormod' }
  | { kind: 'mask'; layer: number }
  | { kind: 'warp'; layer: number }
  | { kind: 'color'; slotIndex: number }
  | null;

export default function MaterialLabSurface(props: {
  state: EditorState;
  recipe: MaterialRecipe;
  usage: { world: number; models: number };
  handlers: LabHandlers;
}) {
  const { state, recipe, handlers } = props;
  const [popover, setPopover] = useState<PopoverState>(null);
  // Transient drag values (params keyed by entry key; palette by slot index) —
  // rendered through recipeData overrides, cleared on commit.
  const [draftParams, setDraftParams] = useState<Map<string, number>>(() => new Map());

  const topologyKey = recipeTopologyKey(recipe);
  const invalid = validateRecipe(recipe);

  // ── the two-speed seam: strings memo on TOPOLOGY, rows rebuild on data ──
  const mainShader = useMemo(() => {
    g_labComposeCount += 1;
    return state.labSoloStage === null ? recipeShader(recipe) : recipeStageShader(recipe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey, state.labSoloStage === null]);
  const stripShader = useMemo(() => {
    g_labComposeCount += 1;
    return recipeStageShader(recipe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  const dataOptions = {
    variant: state.colorStudioVariant,
    seed: state.colorStudioSeed,
    quality: state.colorStudioQuality,
    params: draftParams,
  };
  const baseRow = recipeData(recipe, dataOptions);
  const stageRows = recipeStageData(recipe, dataOptions);
  const enabledCount = recipe.layers.filter((layer) => layer.enabled !== false).length;

  const STAGE_SIZE = 440;
  const soloRow = state.labSoloStage === null ? baseRow : (stageRows[Math.min(state.labSoloStage, stageRows.length - 1)] ?? baseRow);
  const tiles = Math.max(1, state.labStageTiles);
  const stageData = tiles === 1 ? soloRow : packTiledPreview(soloRow, tiles, STAGE_SIZE / tiles);
  const stripData = packLabGrid(stageRows, stageRows.length, STAGE_STRIP_CELL, 4);

  const params = recipeParams(recipe);
  const slots = recipeSlots(recipe);
  const selected = state.labSelectedLayer;
  const visibleParams: RecipeParamEntry[] = selected === null ? params : params.filter((entry) => entry.layer === selected);
  const visibleSlots = selected === null ? slots : slots.filter((slot) => slot.layer === selected);

  const layerRows = recipe.layers.map((layer, index) => ({ layer, index })).reverse();

  const commitParam = (entry: RecipeParamEntry, value: number) => {
    setDraftParams(new Map());
    handlers.onEditRecipe(`${entry.label} → ${value.toFixed(2)}`, (r) => storeParam(r, entry.key, value));
  };
  const previewParam = (entry: RecipeParamEntry, value: number) => {
    const next = new Map(draftParams);
    next.set(entry.key, value);
    setDraftParams(next);
  };

  const applySlotColor = (slotIndex: number, rgb: Rgb) => {
    const slot = slots[slotIndex];
    if (!slot) return;
    handlers.onEditRecipe(`${slot.name} → ${rgb01ToHex(rgb[0], rgb[1], rgb[2])}`, (r) => storeSlot(r, slot.layer, slot.ordinal, rgb));
  };

  return (
    <Row style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
      {/* ── left gutter: THE STACK ─────────────────────────────────────────── */}
      <Col style={{ width: 236, borderRightWidth: 1, borderRightColor: LINE, padding: 10, gap: 8 }}>
        <SectionHead icon="Layers">THE STACK</SectionHead>
        <Row style={{ gap: 5 }}>
          <Pressable onPress={() => setPopover({ kind: 'add-surface' })}
            style={{ flexGrow: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}>
            <Text style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>+ SURFACE</Text>
          </Pressable>
          <Pressable onPress={() => setPopover({ kind: 'add-colormod' })}
            style={{ flexGrow: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}>
            <Text style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>+ FILTER</Text>
          </Pressable>
        </Row>
        <Col style={{ gap: 4, flexGrow: 1, minHeight: 0 }}>
          {layerRows.map(({ layer, index }) => {
            const isSurface = MATERIALS.some((m) => m.fn === layer.atom);
            const mat = MATERIALS.find((m) => m.fn === layer.atom);
            const active = selected === index;
            const disabled = layer.enabled === false;
            return (
              <Pressable key={index} onPress={() => handlers.onSelectLayer(active ? null : index)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 5, borderRadius: 8, borderWidth: 1, borderColor: active ? ACCENT : LINE, backgroundColor: PANEL, opacity: disabled ? 0.45 : 1 }}>
                {isSurface && mat ? (
                  <ShaderThumb shader={fillShaderFor([mat.fn])} data={materialThumbData(mat.materialId, mat.boardIndex, layer.variant ?? 0)} size={26} />
                ) : (
                  <Box style={{ width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: LINE, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="Wand2" size={13} color={ACCENT} />
                  </Box>
                )}
                <Col style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
                  <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>
                    {mat?.name ?? ATOMS.find((a) => a.fn === layer.atom)?.name ?? layer.atom}
                  </Text>
                  <Row style={{ gap: 4 }}>
                    {isSurface ? (
                      <Pressable tooltip="Blend mode — click cycles" onPress={() => handlers.onEditRecipe(`layer ${index + 1} blend → ${BLEND_LABELS[(((layer.blend ?? 0) + 1) % 4)]}`, (r) => mutateLayer(r, index, (l) => ({ ...l, blend: (((l.blend ?? 0) + 1) % 4) as 0 | 1 | 2 | 3 })))}>
                        <Text style={{ color: ACCENT, fontSize: 8, fontWeight: '800' }}>{BLEND_LABELS[layer.blend ?? 0]}</Text>
                      </Pressable>
                    ) : (
                      <Text style={{ color: FAINT, fontSize: 8, fontWeight: '800' }}>filter</Text>
                    )}
                    {layer.mask ? <Text style={{ color: DIM, fontSize: 8 }}>mask</Text> : null}
                    {layer.warp ? <Text style={{ color: DIM, fontSize: 8 }}>warp</Text> : null}
                    <Text style={{ color: FAINT, fontSize: 8, fontFamily: 'ui-monospace' }}>{Math.round((layer.opacity ?? 1) * 100)}%</Text>
                  </Row>
                </Col>
                <Col style={{ gap: 2 }}>
                  <Pressable tooltip="Move layer up (composites over)" onPress={() => handlers.onEditRecipe(`layer ${index + 1} up`, (r) => moveLayer(r, index, 1))}>
                    <Icon name="ChevronUp" size={11} color={DIM} />
                  </Pressable>
                  <Pressable tooltip="Move layer down" onPress={() => handlers.onEditRecipe(`layer ${index + 1} down`, (r) => moveLayer(r, index, -1))}>
                    <Icon name="ChevronDown" size={11} color={DIM} />
                  </Pressable>
                </Col>
                <Col style={{ gap: 2 }}>
                  <Pressable tooltip={disabled ? 'Enable layer' : 'Disable layer'} onPress={() => handlers.onEditRecipe(`layer ${index + 1} ${disabled ? 'on' : 'off'}`, (r) => mutateLayer(r, index, (l) => ({ ...l, enabled: disabled ? undefined : false })))}>
                    <Icon name={disabled ? 'EyeOff' : 'Eye'} size={11} color={disabled ? FAINT : DIM} />
                  </Pressable>
                  <Pressable tooltip="Delete layer" onPress={() => handlers.onEditRecipe(`delete layer ${index + 1}`, (r) => ({ ...r, layers: r.layers.filter((_, at) => at !== index) }))}>
                    <Icon name="X" size={11} color={DIM} />
                  </Pressable>
                </Col>
              </Pressable>
            );
          })}
          {/* the base — always at the bottom of the stack, like the ground floor */}
          <Pressable onPress={() => handlers.onSelectLayer(selected === -1 ? null : -1)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 5, borderRadius: 8, borderWidth: 1, borderColor: selected === -1 ? ACCENT : LINE, backgroundColor: '#0d1015' }}>
            {(() => {
              const mat = MATERIALS.find((m) => m.fn === recipe.base.fn);
              return mat ? <ShaderThumb shader={fillShaderFor([mat.fn])} data={materialThumbData(mat.materialId, mat.boardIndex, recipe.base.variant ?? 0)} size={26} /> : null;
            })()}
            <Col style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
              <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>
                {MATERIALS.find((m) => m.fn === recipe.base.fn)?.name ?? recipe.base.fn}
              </Text>
              <Row style={{ gap: 4 }}>
                <Text style={{ color: FAINT, fontSize: 8, fontWeight: '800' }}>BASE</Text>
                {recipe.base.warp ? <Text style={{ color: DIM, fontSize: 8 }}>warp</Text> : null}
              </Row>
            </Col>
            <Pressable tooltip={recipe.base.warp ? 'Change base warp' : 'Warp the base domain'} onPress={() => setPopover({ kind: 'warp', layer: -1 })}>
              <Icon name="Tornado" size={12} color={recipe.base.warp ? ACCENT : DIM} />
            </Pressable>
          </Pressable>
        </Col>
      </Col>

      {/* ── center: THE MATERIAL, BIG ──────────────────────────────────────── */}
      <Col style={{ flexGrow: 1, minWidth: 0, alignItems: 'center', padding: 12, gap: 10 }}>
        {invalid ? (
          <Row style={{ alignItems: 'center', gap: 7, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#7a3b3b', backgroundColor: '#1d1113' }}>
            <Icon name="TriangleAlert" size={13} color="#e0766f" />
            <Text style={{ color: '#e0a7a2', fontSize: 11 }}>{invalid}</Text>
          </Row>
        ) : null}
        <Box style={{ width: STAGE_SIZE, height: STAGE_SIZE, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: LINE, position: 'relative' }}>
          {mainShader ? (
            <Effect shader={mainShader} data={stageData} style={{ position: 'absolute', left: 0, top: 0, width: STAGE_SIZE, height: STAGE_SIZE }} />
          ) : (
            <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: FAINT, fontSize: 11 }}>recipe does not compose — see the warning above</Text>
            </Col>
          )}
        </Box>
        {/* the intermediates strip — the payoff: every stage live, click to solo */}
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ color: FAINT, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>STAGES</Text>
          <Box style={{ position: 'relative', width: stageRows.length * (STAGE_STRIP_CELL + 4), height: STAGE_STRIP_CELL }}>
            {stripShader ? (
              <Effect shader={stripShader} data={stripData} style={{ position: 'absolute', left: 0, top: 0, width: stageRows.length * (STAGE_STRIP_CELL + 4), height: STAGE_STRIP_CELL }} />
            ) : null}
            <Row style={{ position: 'absolute', left: 0, top: 0, gap: 4 }}>
              {stageRows.map((_, stage) => (
                <Pressable key={stage}
                  tooltip={stage === 0 ? 'base' : `after layer ${stage}`}
                  onPress={() => handlers.onSoloStage(state.labSoloStage === stage ? null : stage)}
                  style={{ width: STAGE_STRIP_CELL, height: STAGE_STRIP_CELL, borderRadius: 6, borderWidth: 2, borderColor: state.labSoloStage === stage ? ACCENT : 'transparent' }}
                />
              ))}
            </Row>
          </Box>
          {state.labSoloStage !== null ? (
            <Pressable onPress={() => handlers.onSoloStage(null)} style={{ paddingLeft: 8, paddingRight: 8, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: ACCENT }}>
              <Text style={{ color: ACCENT, fontSize: 9, fontWeight: '700' }}>show final</Text>
            </Pressable>
          ) : null}
        </Row>
        {/* variant / seed / quality — the retained segmented bar, D[]-speed */}
        <Row style={{ alignItems: 'center', gap: 10 }}>
          <Row style={{ gap: 3 }}>
            {TILE_CHOICES.map((choice) => (
              <Pressable key={choice} tooltip={`${choice}×${choice} tiles`} onPress={() => handlers.onStageTiles(choice)}
                style={{ width: 30, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: tiles === choice ? '#e8e8ea' : '#141518', borderWidth: 1, borderColor: tiles === choice ? '#e8e8ea' : LINE }}>
                <Text style={{ color: tiles === choice ? '#0d0e10' : DIM, fontSize: 9, fontWeight: '700' }}>{choice}×</Text>
              </Pressable>
            ))}
          </Row>
          <C.HW_ColorSeedButton onPress={handlers.onSeed}>
            <Icon name="Dices" size={12} color={accentFor('primary')} />
            <C.HW_FormValue>{state.colorStudioSeed}</C.HW_FormValue>
          </C.HW_ColorSeedButton>
          <Row style={{ gap: 3 }}>
            {FILL_GRADES.map((label, quality) => (
              <Pressable key={label} onPress={() => handlers.onQuality(quality)}
                style={{ paddingLeft: 8, paddingRight: 8, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: quality === state.colorStudioQuality ? '#e8e8ea' : '#141518', borderWidth: 1, borderColor: quality === state.colorStudioQuality ? '#e8e8ea' : LINE }}>
                <Text style={{ color: quality === state.colorStudioQuality ? '#0d0e10' : DIM, fontSize: 9, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            ))}
          </Row>
        </Row>
      </Col>

      {/* ── right gutter: the context inspector ────────────────────────────── */}
      <Col style={{ width: 268, borderLeftWidth: 1, borderLeftColor: LINE, padding: 10, gap: 9 }}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Icon name="FlaskConical" size={13} color={accentFor('primary')} />
          <TextInput
            value={recipe.name}
            onChange={(name: string) => handlers.onRenameRecipe(name)}
            style={{ flexGrow: 1, minWidth: 0, height: 24, paddingLeft: 6, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', color: TEXT, fontSize: 11, fontWeight: '700' }}
          />
        </Row>
        <Text style={{ color: FAINT, fontSize: 9 }}>
          {selected === null ? 'WHOLE RECIPE' : selected === -1 ? 'BASE' : `LAYER ${selected + 1}`} · auto-saved · composed {g_labComposeCount}× this session
        </Text>

        {selected !== null && selected >= 0 && recipe.layers[selected] ? (
          <Col style={{ gap: 5 }}>
            <SectionHead icon="Blend">LAYER TOOLS</SectionHead>
            <Row style={{ gap: 5 }}>
              <Pressable onPress={() => setPopover({ kind: 'mask', layer: selected })}
                style={{ flexGrow: 1, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: recipe.layers[selected]!.mask ? ACCENT : LINE }}>
                <Text style={{ color: recipe.layers[selected]!.mask ? ACCENT : DIM, fontSize: 9, fontWeight: '700' }}>
                  {recipe.layers[selected]!.mask ? `MASK · ${ATOMS.find((a) => a.fn === recipe.layers[selected]!.mask!.field)?.name ?? ''}` : 'ADD MASK'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setPopover({ kind: 'warp', layer: selected })}
                style={{ flexGrow: 1, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: recipe.layers[selected]!.warp ? ACCENT : LINE }}>
                <Text style={{ color: recipe.layers[selected]!.warp ? ACCENT : DIM, fontSize: 9, fontWeight: '700' }}>
                  {recipe.layers[selected]!.warp ? `WARP · ${ATOMS.find((a) => a.fn === recipe.layers[selected]!.warp!.atom)?.name ?? ''}` : 'ADD WARP'}
                </Text>
              </Pressable>
            </Row>
            {recipe.layers[selected]!.mask ? (
              <Pressable onPress={() => handlers.onEditRecipe(`layer ${selected + 1} mask ${recipe.layers[selected]!.mask!.invert ? 'normal' : 'inverted'}`, (r) => mutateLayer(r, selected, (l) => ({ ...l, mask: { ...l.mask!, invert: !l.mask!.invert } })))}
                style={{ height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: LINE }}>
                <Text style={{ color: DIM, fontSize: 9, fontWeight: '700' }}>{recipe.layers[selected]!.mask!.invert ? 'MASK INVERTED' : 'INVERT MASK'}</Text>
              </Pressable>
            ) : null}
          </Col>
        ) : null}

        <Col style={{ gap: 6 }}>
          <SectionHead icon="SlidersHorizontal">DIALS</SectionHead>
          {visibleParams.length === 0 ? (
            <Text style={{ color: FAINT, fontSize: 10 }}>nothing tunable here yet</Text>
          ) : visibleParams.map((entry) => (
            <DialRow
              key={entry.key}
              label={entry.label}
              value={draftParams.get(entry.key) ?? entry.default}
              min={entry.min}
              max={entry.max}
              onPreview={(value) => previewParam(entry, value)}
              onCommit={(value) => commitParam(entry, value)}
            />
          ))}
        </Col>

        <Col style={{ gap: 5 }}>
          <SectionHead icon="Pipette">PALETTE</SectionHead>
          {visibleSlots.length === 0 ? (
            <Text style={{ color: FAINT, fontSize: 10 }}>no color slots in this selection</Text>
          ) : (() => {
            // A slot is LIVE when the take its call site samples with actually
            // reads it (req_4405 — the "why does blue change nothing" fix).
            // The base follows the variant bar unless pinned; layers pin at 0.
            const effectiveVariant = (layer: number): number => layer === -1
              ? (recipe.base.variant ?? state.colorStudioVariant)
              : (recipe.layers[layer]?.variant ?? 0);
            const live = visibleSlots.filter((slot) => !slot.takes || slot.takes.includes(effectiveVariant(slot.layer)));
            const offTake = visibleSlots.filter((slot) => slot.takes && !slot.takes.includes(effectiveVariant(slot.layer)));
            const swatch = (slot: typeof visibleSlots[number], dimmed: boolean) => {
              const slotIndex = slots.indexOf(slot);
              const owned = slot.rgb[0] !== slot.baked[0] || slot.rgb[1] !== slot.baked[1] || slot.rgb[2] !== slot.baked[2];
              const where = slot.layer === -1 ? 'base' : `layer ${slot.layer + 1}`;
              const takeNote = dimmed && slot.takes ? ` · read by take ${slot.takes.map((t) => t + 1).join('/')} — switch VARIANT to see it` : '';
              return (
                <Pressable key={slotIndex} tooltip={`${slot.name} — ${where}${owned ? ' · owned' : ' · baked'}${takeNote}`}
                  onPress={() => setPopover({ kind: 'color', slotIndex })} style={{ opacity: dimmed ? 0.35 : 1 }}>
                  <Box style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: rgb01ToHex(slot.rgb[0], slot.rgb[1], slot.rgb[2]), borderWidth: owned ? 2 : 1, borderColor: owned ? '#ffffff' : LINE }} />
                </Pressable>
              );
            };
            return (
              <>
                <Row style={{ flexWrap: 'wrap', gap: 5 }}>{live.map((slot) => swatch(slot, false))}</Row>
                {offTake.length > 0 ? (
                  <>
                    <Text style={{ color: FAINT, fontSize: 8, fontWeight: '800', letterSpacing: 1 }}>OTHER TAKES</Text>
                    <Row style={{ flexWrap: 'wrap', gap: 5 }}>{offTake.map((slot) => swatch(slot, true))}</Row>
                  </>
                ) : null}
              </>
            );
          })()}
          <Pressable onPress={() => handlers.onEditRecipe('reset colors to baked', (r) => resetPalettes(r, selected))}
            style={{ height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: LINE }}>
            <Text style={{ color: DIM, fontSize: 9, fontWeight: '700' }}>RESET TO BAKED</Text>
          </Pressable>
        </Col>

        <Col style={{ gap: 3 }}>
          <SectionHead icon="Info">RECIPE FACTS</SectionHead>
          <Text style={{ color: DIM, fontSize: 9 }}>base {recipe.base.fn} · {enabledCount} layer{enabledCount === 1 ? '' : 's'} · {params.length} params · {slots.length} slots</Text>
          <Text style={{ color: DIM, fontSize: 9 }}>used by {props.usage.world} world slots · {props.usage.models} model slots</Text>
          {(() => {
            const promotedFn = recipe.id.replace(/-/g, '_');
            const promoted = MATERIALS.some((m) => m.fn === promotedFn && m.author === 'lab');
            return <Text style={{ color: promoted ? '#7fbf7f' : FAINT, fontSize: 9, fontWeight: '700' }}>{promoted ? `IN CATALOG as ${promotedFn}` : 'NOT IN CATALOG'}</Text>;
          })()}
        </Col>

        <Row style={{ gap: 5 }}>
          <Pressable tooltip="Emit a real materials/*.wgsl and rerun the generator — the material joins every picker with a stable id" onPress={handlers.onSaveToCatalog}
            style={{ flexGrow: 1, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: ACCENT, backgroundColor: PANEL }}>
            <Text style={{ color: ACCENT, fontSize: 10, fontWeight: '800' }}>SAVE TO CATALOG</Text>
          </Pressable>
          <Pressable tooltip="Delete this experiment (the catalog copy, if saved, stays)" onPress={handlers.onDeleteRecipe}
            style={{ width: 30, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: LINE }}>
            <Icon name="Trash2" size={12} color={DIM} />
          </Pressable>
        </Row>
      </Col>

      {/* ── popovers (scrim overlays, root-last within the surface) ────────── */}
      {popover?.kind === 'add-surface' ? (
        <SurfacePickerPopover title="Add surface layer" onClose={() => setPopover(null)}
          onPick={(fn) => handlers.onEditRecipe(`+ layer ${fn}`, (r) => ({ ...r, layers: [...r.layers, { atom: fn, blend: 0, opacity: 1 }] }))} />
      ) : null}
      {popover?.kind === 'add-colormod' ? (
        <AtomPickerPopover title="Add filter layer" kind="colormod" onClose={() => setPopover(null)}
          onPick={(fn) => handlers.onEditRecipe(`+ filter ${fn}`, (r) => ({ ...r, layers: [...r.layers, { atom: fn, opacity: 1, amount: 1 }] }))} />
      ) : null}
      {popover?.kind === 'mask' ? (
        <AtomPickerPopover title="Mask field" kind="field" onClose={() => setPopover(null)}
          onPick={(fn) => handlers.onEditRecipe(`layer ${popover.layer + 1} mask → ${fn}`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, mask: { field: fn, threshold: l.mask?.threshold ?? 0.5, softness: l.mask?.softness ?? 0.25, invert: l.mask?.invert } })))}
          onClear={() => handlers.onEditRecipe(`layer ${popover.layer + 1} mask off`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, mask: undefined })))} />
      ) : null}
      {popover?.kind === 'warp' ? (
        <AtomPickerPopover title={popover.layer === -1 ? 'Base warp' : 'Layer warp'} kind="warp" onClose={() => setPopover(null)}
          onPick={(fn) => popover.layer === -1
            ? handlers.onEditRecipe(`base warp → ${fn}`, (r) => ({ ...r, base: { ...r.base, warp: { atom: fn, amount: r.base.warp?.amount ?? 0.6 } } }))
            : handlers.onEditRecipe(`layer ${popover.layer + 1} warp → ${fn}`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, warp: { atom: fn, amount: l.warp?.amount ?? 0.6 } })))}
          onClear={() => popover.layer === -1
            ? handlers.onEditRecipe('base warp off', (r) => ({ ...r, base: { ...r.base, warp: undefined } }))
            : handlers.onEditRecipe(`layer ${popover.layer + 1} warp off`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, warp: undefined })))} />
      ) : null}
      {popover?.kind === 'color' ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
          <Pressable onPress={() => setPopover(null)} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
          <Col style={{ position: 'absolute', right: 280, top: 40, width: 268, maxHeight: 560, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 6 }}>
            <Text style={{ color: TEXT, fontSize: 11, fontWeight: '700' }}>
              {slots[popover.slotIndex]?.name ?? 'slot'} — pick lands on the slot
            </Text>
            <ColorLibraryPanel
              current={state.colorSpineCurrent}
              palette={state.colorSpinePalette}
              recents={state.colorSpineRecents}
              scenePick={state.colorSpineScenePick}
              sets={state.colorSpineSets}
              onSetCurrent={(color) => {
                handlers.onSpineCurrent(color);
                applySlotColor(popover.slotIndex, oklchToRgb01(color) as Rgb);
              }}
              onAddToTray={handlers.onSpineAddToTray}
              onPickTray={(color) => {
                handlers.onSpineCurrent(color);
                applySlotColor(popover.slotIndex, oklchToRgb01(color) as Rgb);
              }}
              onScenePick={(color) => {
                handlers.onSpineCurrent(color);
                applySlotColor(popover.slotIndex, oklchToRgb01(color) as Rgb);
              }}
              onLoadLibrarySet={handlers.onSpineLoadLibrarySet}
            />
          </Col>
        </Box>
      ) : null}
    </Row>
  );
}

// ── pure recipe mutations (the edit vocabulary onEditRecipe applies) ─────────
function mutateLayer(recipe: MaterialRecipe, index: number, mutate: (layer: MaterialRecipe['layers'][number]) => MaterialRecipe['layers'][number]): MaterialRecipe | null {
  const layer = recipe.layers[index];
  if (!layer) return null;
  const layers = [...recipe.layers];
  layers[index] = mutate(layer);
  return { ...recipe, layers };
}

function moveLayer(recipe: MaterialRecipe, index: number, direction: 1 | -1): MaterialRecipe | null {
  const to = index + direction;
  if (to < 0 || to >= recipe.layers.length) return null;
  const layers = [...recipe.layers];
  const [layer] = layers.splice(index, 1);
  layers.splice(to, 0, layer!);
  // Stored atom-knob keys are layer-indexed; remap the two swapped positions.
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(recipe.params ?? {})) {
    const remapped = key
      .replace(new RegExp(`^layer\\.${index}\\.`), `layer.__swap__.`)
      .replace(new RegExp(`^layer\\.${to}\\.`), `layer.${index}.`)
      .replace(/^layer\.__swap__\./, `layer.${to}.`);
    params[remapped] = value;
  }
  return { ...recipe, layers, params };
}

function storeParam(recipe: MaterialRecipe, key: string, value: number): MaterialRecipe {
  // Structural tunables live on their layer fields; atom knobs in recipe.params.
  const structural = /^(base\.warp\.amount|layer\.(\d+)\.(opacity|amount|warp\.amount|mask\.threshold|mask\.softness))$/.exec(key);
  if (!structural) {
    return { ...recipe, params: { ...(recipe.params ?? {}), [key]: value } };
  }
  if (key === 'base.warp.amount') {
    return recipe.base.warp ? { ...recipe, base: { ...recipe.base, warp: { ...recipe.base.warp, amount: value } } } : recipe;
  }
  const layerIndex = Number(structural[2]);
  const field = structural[3]!;
  const mutated = mutateLayer(recipe, layerIndex, (layer) => {
    if (field === 'opacity') return { ...layer, opacity: value };
    if (field === 'amount') return { ...layer, amount: value };
    if (field === 'warp.amount') return layer.warp ? { ...layer, warp: { ...layer.warp, amount: value } } : layer;
    if (field === 'mask.threshold') return layer.mask ? { ...layer, mask: { ...layer.mask, threshold: value } } : layer;
    return layer.mask ? { ...layer, mask: { ...layer.mask, softness: value } } : layer;
  });
  return mutated ?? recipe;
}

function storeSlot(recipe: MaterialRecipe, layer: number, ordinal: number, rgb: Rgb): MaterialRecipe {
  const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  if (layer === -1) {
    const palette = [...(recipe.base.palette ?? [])];
    while (palette.length <= ordinal) palette.push(null);
    palette[ordinal] = next;
    return { ...recipe, base: { ...recipe.base, palette } };
  }
  const mutated = mutateLayer(recipe, layer, (l) => {
    const palette = [...(l.palette ?? [])];
    while (palette.length <= ordinal) palette.push(null);
    palette[ordinal] = next;
    return { ...l, palette };
  });
  return mutated ?? recipe;
}

function resetPalettes(recipe: MaterialRecipe, selected: number | null): MaterialRecipe | null {
  if (selected === -1) {
    if (!recipe.base.palette) return null;
    return { ...recipe, base: { ...recipe.base, palette: undefined } };
  }
  if (selected !== null) {
    return mutateLayer(recipe, selected, (l) => ({ ...l, palette: undefined }));
  }
  const anyOwned = recipe.base.palette || recipe.layers.some((l) => l.palette);
  if (!anyOwned) return null;
  return {
    ...recipe,
    base: { ...recipe.base, palette: undefined },
    layers: recipe.layers.map((l) => ({ ...l, palette: undefined })),
  };
}

// Re-exported for AppFrame's parity with the surface's edit vocabulary.
export { mutateLayer as labMutateLayer };
