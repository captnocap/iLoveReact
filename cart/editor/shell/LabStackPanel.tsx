// SECTION C — the Material Lab's STACK panel (req_4406). A left-rail peer of
// Paint and the Asset Explorer while a Lab document is focused: the recipe's
// layer stack lives HERE, on the real gutter, not in a pseudo-column inside
// the stage. Add-buttons pin to the top; the layer list scrolls in the flex
// region below them with the base always the last, ground-floor row. All edits
// go through the one LabHandlers.onEditRecipe vocabulary (undo-tracked in
// AppFrame's lab history).
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { fillShaderFor } from '../render3d/shaders/compose';
import { ATOMS, MATERIALS } from '../render3d/shaders/_generated/registry';
import type { MaterialRecipe } from '../render3d/shaders/recipe';
import ShaderThumb from './ShaderThumb';
import { materialThumbData } from './MaterialPickerPopover';
import { AtomPickerPopover, SurfacePickerPopover } from '../material/LabPickers';
import { mutateLayer, moveLayer } from '../material/labRecipeEdits';
import type { LabHandlers } from '../stage/MaterialLabSurface';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe', PANEL = '#131519';

const BLEND_LABELS = ['over', 'add', 'mult', 'screen'] as const;

type PopoverState =
  | { kind: 'add-surface' }
  | { kind: 'add-colormod' }
  | { kind: 'base-warp' }
  | null;

export default function LabStackPanel(props: {
  recipe: MaterialRecipe;
  selected: number | null;
  handlers: LabHandlers;
}) {
  const { recipe, selected, handlers } = props;
  const [popover, setPopover] = useState<PopoverState>(null);
  const layerRows = recipe.layers.map((layer, index) => ({ layer, index })).reverse();
  const baseMat = MATERIALS.find((m) => m.fn === recipe.base.fn);
  return (
    <C.HW_SidePanel>
      <C.HW_LibHead>
        <Icon name="Layers" size={14} color={accentFor('primary')} />
        <C.HW_LibTitle>The Stack</C.HW_LibTitle>
        <C.HW_Spacer />
        <C.HW_StatusText>{recipe.layers.length} layer{recipe.layers.length === 1 ? '' : 's'} + base</C.HW_StatusText>
      </C.HW_LibHead>
      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative', flexDirection: 'column' }}>
        {/* add-buttons pinned above the scrolling list */}
        <Row style={{ gap: 5, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8 }}>
          <Pressable onPress={() => setPopover({ kind: 'add-surface' })}
            style={{ flexGrow: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}>
            <Text style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>+ SURFACE</Text>
          </Pressable>
          <Pressable onPress={() => setPopover({ kind: 'add-colormod' })}
            style={{ flexGrow: 1, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL }}>
            <Text style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>+ FILTER</Text>
          </Pressable>
        </Row>
        <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column', gap: 4, paddingLeft: 10, paddingRight: 10, paddingBottom: 8, overflow: 'scroll' }}>
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
            {baseMat ? <ShaderThumb shader={fillShaderFor([baseMat.fn])} data={materialThumbData(baseMat.materialId, baseMat.boardIndex, recipe.base.variant ?? 0)} size={26} /> : null}
            <Col style={{ flexGrow: 1, minWidth: 0, gap: 1 }}>
              <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>
                {baseMat?.name ?? recipe.base.fn}
              </Text>
              <Row style={{ gap: 4 }}>
                <Text style={{ color: FAINT, fontSize: 8, fontWeight: '800' }}>BASE</Text>
                {recipe.base.warp ? <Text style={{ color: DIM, fontSize: 8 }}>warp</Text> : null}
              </Row>
            </Col>
            <Pressable tooltip={recipe.base.warp ? 'Change base warp' : 'Warp the base domain'} onPress={() => setPopover({ kind: 'base-warp' })}>
              <Icon name="Tornado" size={12} color={recipe.base.warp ? ACCENT : DIM} />
            </Pressable>
          </Pressable>
        </Box>
        {popover?.kind === 'add-surface' ? (
          <SurfacePickerPopover title="Add surface layer" onClose={() => setPopover(null)}
            onPick={(fn) => handlers.onEditRecipe(`+ layer ${fn}`, (r) => ({ ...r, layers: [...r.layers, { atom: fn, blend: 0, opacity: 1 }] }))} />
        ) : null}
        {popover?.kind === 'add-colormod' ? (
          <AtomPickerPopover title="Add filter layer" kind="colormod" onClose={() => setPopover(null)}
            onPick={(fn) => handlers.onEditRecipe(`+ filter ${fn}`, (r) => ({ ...r, layers: [...r.layers, { atom: fn, opacity: 1, amount: 1 }] }))} />
        ) : null}
        {popover?.kind === 'base-warp' ? (
          <AtomPickerPopover title="Base warp" kind="warp" onClose={() => setPopover(null)}
            onPick={(fn) => handlers.onEditRecipe(`base warp → ${fn}`, (r) => ({ ...r, base: { ...r.base, warp: { atom: fn, amount: r.base.warp?.amount ?? 0.6 } } }))}
            onClear={() => handlers.onEditRecipe('base warp off', (r) => ({ ...r, base: { ...r.base, warp: undefined } }))} />
        ) : null}
      </Box>
    </C.HW_SidePanel>
  );
}
