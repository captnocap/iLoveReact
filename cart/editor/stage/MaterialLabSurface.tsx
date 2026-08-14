// editor/stage/MaterialLabSurface.tsx — the Material Lab STAGE (req_4395;
// rail-mounted layout req_4406).
//
// This surface is now ONLY the center viewport: the recipe's layer STACK lives
// in the left rail's Stack panel (shell/LabStackPanel.tsx) and the DIALS /
// PALETTE / FACTS inspector in the right rail (inspector/LabInspectorPanel.tsx)
// — the app's real gutters, not pseudo-columns in here. What remains:
//
//   · the material fills the measured viewport EDGE-TO-EDGE — the 1x/2x/4x/6x
//     HUD choice sets tile density inside the viewport (cell = short edge ÷
//     density, columns overflow-fill the long edge). No fixed-size swatch.
//   · the STAGES strip docks along the viewport's top edge: ≥96px live thumbs
//     (one packed-grid Effect), each labeled with its stage name, click solos.
//   · scale / seed / quality dock to the bottom edge as a compact HUD bar.
//
// Two-speed discipline in code: every shader string memoizes on
// recipeTopologyKey ONLY. Slider drags (now in the rail panel) ride the shared
// labDraft store into recipeData overrides — data-speed, zero recompiles.
import { useMemo, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { FILL_GRID_DATA } from '../render3d/shaders/index';
import { ATOMS, MATERIALS } from '../render3d/shaders/_generated/registry';
import {
  recipeData,
  recipeShader,
  recipeStageData,
  recipeStageShader,
  recipeTopologyKey,
  validateRecipe,
  type MaterialRecipe,
} from '../render3d/shaders/recipe';
import { FILL_GRADES } from '../textures/shaders';
import { useLabDraftParams } from '../material/labDraft';
import type { OklchColor } from '../../../runtime/paint/colors';
import type { EditorState } from '../data/types';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe';
const BAR_BG = 'rgba(13, 16, 21, 0.92)';

const STAGE_STRIP_CELL = 96;
const STAGE_STRIP_GAP = 4;
const STAGE_STRIP_LABEL = 15;
const TILE_CHOICES = [1, 2, 4, 6] as const;

/** Session recompose counter — the dev-facing proof surface for the two-speed
 *  contract: slider drags must not move it, topology edits move it by one. */
let g_labComposeCount = 0;

export function labComposeCount(): number {
  return g_labComposeCount;
}

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

/** Viewport tiling of ONE row: columns × rows of square cells, every cell
 *  offset pointing at the same data row. Cells overflow-fill the viewport so
 *  the material reaches every edge at any density. */
function packViewportTiles(row: readonly number[], columns: number, rows: number, cellSize: number): number[] {
  const count = columns * rows;
  const packed = [
    FILL_GRID_DATA.marker, count, columns, cellSize, 0, cellSize, 0, 0,
    ...Array.from({ length: count }, () => -1),
  ];
  const at = packed.length;
  packed.push(...row);
  for (let index = 0; index < count; index += 1) packed[FILL_GRID_DATA.offsetStartIndex + index] = at;
  return packed;
}

export default function MaterialLabSurface(props: {
  state: EditorState;
  recipe: MaterialRecipe;
  handlers: LabHandlers;
}) {
  const { state, recipe, handlers } = props;
  const draftParams = useLabDraftParams();
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

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
  const soloRow = state.labSoloStage === null ? baseRow : (stageRows[Math.min(state.labSoloStage, stageRows.length - 1)] ?? baseRow);
  const tiles = Math.max(1, state.labStageTiles);

  // Edge-to-edge tiling: square cells sized from the SHORT edge so density is
  // what the 1x/2x picker says; the long edge overflow-fills with more cells.
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  const cell = Math.max(1, Math.min(width, height) / tiles);
  const columns = Math.max(1, Math.ceil(width / cell));
  const rowCount = Math.max(1, Math.ceil(height / cell));
  const stageData = packViewportTiles(soloRow, columns, rowCount, cell);
  const stripData = packLabGrid(stageRows, stageRows.length, STAGE_STRIP_CELL, STAGE_STRIP_GAP);

  // Stage names: base, then each ENABLED layer (the stages the strip shader
  // actually composes, in composite order).
  const enabledLayers = recipe.layers.filter((layer) => layer.enabled !== false);
  const stageName = (stage: number): string => {
    if (stage === 0) return MATERIALS.find((m) => m.fn === recipe.base.fn)?.name ?? 'base';
    const layer = enabledLayers[stage - 1];
    if (!layer) return `stage ${stage}`;
    return MATERIALS.find((m) => m.fn === layer.atom)?.name
      ?? ATOMS.find((a) => a.fn === layer.atom)?.name
      ?? layer.atom;
  };
  const stripWidth = stageRows.length * (STAGE_STRIP_CELL + STAGE_STRIP_GAP);

  return (
    <Box
      onLayout={(r: any) => setViewport({ width: r.width, height: r.height })}
      style={{ flexGrow: 1, minHeight: 0, position: 'relative', overflow: 'hidden', borderRadius: 10, borderWidth: 1, borderColor: LINE, backgroundColor: '#0b0d10' }}
    >
      {/* the material, edge to edge */}
      {mainShader && viewport ? (
        <Effect shader={mainShader} data={stageData} style={{ position: 'absolute', left: 0, top: 0, width, height }} />
      ) : (
        <Col style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: FAINT, fontSize: 11 }}>{mainShader ? 'measuring the stage…' : 'recipe does not compose — see the warning above'}</Text>
        </Col>
      )}

      {/* ── STAGES strip — docked along the top edge, spanning the stage ── */}
      <Row style={{ position: 'absolute', left: 0, top: 0, right: 0, height: STAGE_STRIP_CELL + STAGE_STRIP_LABEL + 16, alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 12, backgroundColor: BAR_BG, borderBottomWidth: 1, borderBottomColor: LINE }}>
        <Text style={{ color: FAINT, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>STAGES</Text>
        <Box style={{ position: 'relative', width: stripWidth, height: STAGE_STRIP_CELL + STAGE_STRIP_LABEL, flexShrink: 1, overflow: 'hidden' }}>
          {stripShader ? (
            <Effect shader={stripShader} data={stripData} style={{ position: 'absolute', left: 0, top: 0, width: stripWidth, height: STAGE_STRIP_CELL }} />
          ) : null}
          <Row style={{ position: 'absolute', left: 0, top: 0, gap: STAGE_STRIP_GAP }}>
            {stageRows.map((_, stage) => {
              const selected = state.labSoloStage === stage;
              return (
                <Col key={stage} style={{ width: STAGE_STRIP_CELL, gap: 1 }}>
                  <Pressable
                    tooltip={stage === 0 ? 'base — click to solo' : `after layer ${stage} — click to solo`}
                    onPress={() => handlers.onSoloStage(selected ? null : stage)}
                    style={{ width: STAGE_STRIP_CELL, height: STAGE_STRIP_CELL, borderRadius: 6, borderWidth: 2, borderColor: selected ? ACCENT : 'transparent' }}
                  />
                  <Text numberOfLines={1} noWrap style={{ color: selected ? ACCENT : DIM, fontSize: 8, fontWeight: '700', textAlign: 'center', width: STAGE_STRIP_CELL }}>
                    {stageName(stage)}
                  </Text>
                </Col>
              );
            })}
          </Row>
        </Box>
      </Row>

      {/* ── invalid-recipe warning, under the strip ── */}
      {invalid ? (
        <Row style={{ position: 'absolute', left: 12, top: STAGE_STRIP_CELL + STAGE_STRIP_LABEL + 24, alignItems: 'center', gap: 7, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#7a3b3b', backgroundColor: '#1d1113' }}>
          <Icon name="TriangleAlert" size={13} color="#e0766f" />
          <Text style={{ color: '#e0a7a2', fontSize: 11 }}>{invalid}</Text>
        </Row>
      ) : null}

      {/* ── HUD bar — docked to the stage's bottom edge, never floating ── */}
      <Row style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 36, alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 12, backgroundColor: BAR_BG, borderTopWidth: 1, borderTopColor: LINE }}>
        <Row style={{ gap: 3 }}>
          {TILE_CHOICES.map((choice) => (
            <Pressable key={choice} tooltip={`${choice}×${choice} tile density`} onPress={() => handlers.onStageTiles(choice)}
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
        <Box style={{ flexGrow: 1 }} />
        {state.labSoloStage !== null ? (
          <Pressable onPress={() => handlers.onSoloStage(null)} style={{ paddingLeft: 8, paddingRight: 8, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: ACCENT }}>
            <Text style={{ color: ACCENT, fontSize: 9, fontWeight: '700' }}>soloing {stageName(state.labSoloStage)} — show final</Text>
          </Pressable>
        ) : null}
      </Row>
    </Box>
  );
}
