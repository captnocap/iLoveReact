// SECTION G — the Material Lab's inspector body (req_4406). Mounted by
// Inspector.tsx while a Lab document is focused: DIALS and PALETTE read from
// the top, RECIPE FACTS + SAVE TO CATALOG pin to the bottom, with the tunable
// middle scrolling between them. Slider drags write the shared labDraft store
// (the stage previews them live); commits land through LabHandlers.onEditRecipe
// — the same undo-tracked vocabulary the STACK panel uses.
import { useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { MATERIALS, ATOMS } from '../render3d/shaders/_generated/registry';
import {
  recipeParams,
  recipeSlots,
  type MaterialRecipe,
  type RecipeParamEntry,
} from '../render3d/shaders/recipe';
import { oklchToRgb01, rgb01ToHex } from '../../../runtime/paint/colors';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import { AtomPickerPopover } from '../material/LabPickers';
import { mutateLayer, storeParam, storeSlot, resetPalettes } from '../material/labRecipeEdits';
import { clearLabDraftParams, setLabDraftParam, useLabDraftParams } from '../material/labDraft';
import { labComposeCount, type LabHandlers } from '../stage/MaterialLabSurface';
import type { EditorState, Rgb } from '../data/types';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe', PANEL = '#131519';

// ── DIALS-style slider (drag pattern per req_1455; shared draft per req_4406) ──
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
      <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontWeight: '700', width: 108 }}>{props.label.toUpperCase()}</Text>
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

function SectionHead(props: { icon: string; children: unknown }) {
  return (
    <C.HW_GroupTitle>
      <Icon name={props.icon} size={12} color={accentFor('primary')} />
      <C.HW_GroupText>{props.children}</C.HW_GroupText>
    </C.HW_GroupTitle>
  );
}

type PopoverState =
  | { kind: 'mask'; layer: number }
  | { kind: 'warp'; layer: number }
  | { kind: 'color'; slotIndex: number }
  | null;

export default function LabInspectorPanel(props: {
  state: EditorState;
  recipe: MaterialRecipe;
  usage: { world: number; models: number };
  handlers: LabHandlers;
  onCollapse: () => void;
}) {
  const { state, recipe, handlers } = props;
  const [popover, setPopover] = useState<PopoverState>(null);
  const draftParams = useLabDraftParams();

  const params = recipeParams(recipe);
  const slots = recipeSlots(recipe);
  const selected = state.labSelectedLayer;
  const visibleParams: RecipeParamEntry[] = selected === null ? params : params.filter((entry) => entry.layer === selected);
  const visibleSlots = selected === null ? slots : slots.filter((slot) => slot.layer === selected);
  const enabledCount = recipe.layers.filter((layer) => layer.enabled !== false).length;

  const commitParam = (entry: RecipeParamEntry, value: number) => {
    clearLabDraftParams();
    handlers.onEditRecipe(`${entry.label} → ${value.toFixed(2)}`, (r) => storeParam(r, entry.key, value));
  };

  const applySlotColor = (slotIndex: number, rgb: Rgb) => {
    const slot = slots[slotIndex];
    if (!slot) return;
    handlers.onEditRecipe(`${slot.name} → ${rgb01ToHex(rgb[0], rgb[1], rgb[2])}`, (r) => storeSlot(r, slot.layer, slot.ordinal, rgb));
  };

  return (
    <C.HW_Inspector>
      <C.HW_PanelHead>
        <C.HW_Kicker>MATERIAL LAB</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_PanelHeadButton tooltip="Collapse focus panel" onPress={props.onCollapse}>
          <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
        </C.HW_PanelHeadButton>
      </C.HW_PanelHead>
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative', flexDirection: 'column', gap: 5, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8 }}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Icon name="FlaskConical" size={13} color={accentFor('primary')} />
          <TextInput
            value={recipe.name}
            onChange={(name: string) => handlers.onRenameRecipe(name)}
            style={{ flexGrow: 1, minWidth: 0, height: 24, paddingLeft: 6, borderRadius: 6, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', color: TEXT, fontSize: 11, fontWeight: '700' }}
          />
        </Row>
        <Text style={{ color: FAINT, fontSize: 9 }}>
          {selected === null ? 'WHOLE RECIPE' : selected === -1 ? 'BASE' : `LAYER ${selected + 1}`} · auto-saved · composed {labComposeCount()}× this session
        </Text>

        {/* the tunable middle scrolls; FACTS + SAVE stay pinned below it */}
        <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column', gap: 9, overflow: 'scroll' }}>
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
                onPreview={(value) => setLabDraftParam(entry.key, value)}
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
        </Box>

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

        {popover?.kind === 'mask' ? (
          <AtomPickerPopover title="Mask field" kind="field" width={252} onClose={() => setPopover(null)}
            onPick={(fn) => handlers.onEditRecipe(`layer ${popover.layer + 1} mask → ${fn}`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, mask: { field: fn, threshold: l.mask?.threshold ?? 0.5, softness: l.mask?.softness ?? 0.25, invert: l.mask?.invert } })))}
            onClear={() => handlers.onEditRecipe(`layer ${popover.layer + 1} mask off`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, mask: undefined })))} />
        ) : null}
        {popover?.kind === 'warp' ? (
          <AtomPickerPopover title="Layer warp" kind="warp" width={252} onClose={() => setPopover(null)}
            onPick={(fn) => handlers.onEditRecipe(`layer ${popover.layer + 1} warp → ${fn}`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, warp: { atom: fn, amount: l.warp?.amount ?? 0.6 } })))}
            onClear={() => handlers.onEditRecipe(`layer ${popover.layer + 1} warp off`, (r) => mutateLayer(r, popover.layer, (l) => ({ ...l, warp: undefined })))} />
        ) : null}
        {popover?.kind === 'color' ? (
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
            <Pressable onPress={() => setPopover(null)} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.001)' }} />
            <Col style={{ position: 'absolute', left: 4, top: 34, width: 256, maxHeight: 560, backgroundColor: '#17181b', borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 12, gap: 6 }}>
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
      </Box>
    </C.HW_Inspector>
  );
}
