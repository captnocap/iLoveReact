// editor/stage/MaterialFocusSurface.tsx — the Material Lab focus page
// (req_4395; the Color Studio bench this replaces lives on only as the
// single-material fallback below).
//
// Two views: THE LAB (MaterialLabSurface — stackable, blendable recipes over
// the catalog) and LIBRARY (the shared color surface with the REAL persisted
// sets). Non-registry specs (the layered road shader, imported UV patches)
// cannot base a recipe, so they keep the original palette-slot panel — the
// overrides still ride the D[] palette section shared with the paint bake.
import { useMemo, useState } from 'react';
import { Effect } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { HexColorInput } from '../../../runtime/paint/ColorField';
import {
  colorStudioOverrideKey,
  colorStudioSpec,
  bakedSlotRgb,
  hasAnyOverride,
  resolvedSlotRgb,
  rgbToCss,
  rgbToVec3,
  slotFitColors,
  studioPreviewData,
  studioSpecs,
} from '../data/colorStudio';
import { oklchName, type SpinePaletteSet } from '../data/colorSpine';
import { FILL_GRADES } from '../textures/shaders';
import { hexToRgb01, oklchToHex, oklchToRgb01 } from '../../../runtime/paint/colors';
import { C, accentFor } from '../workspace.cls';
import type { Asset, EditorState, Rgb } from '../data/types';
import type { OklchColor } from '../../../runtime/paint/colors';
import type { MaterialRecipe } from '../render3d/shaders/recipe';
import ColorStudioViewTabs from './ColorStudioViewTabs';
import LabLibraryView from './LabLibraryView';
import MaterialLabSurface, { type LabHandlers } from './MaterialLabSurface';

const VIEW_LABELS: Record<EditorState['colorStudioView'], string> = {
  materialPalette: 'Lab',
  library: 'Library',
};

const MATERIAL_STRIP_PAGE = 6;

export default function MaterialFocusSurface(props: {
  state: EditorState;
  activeAsset: Asset;
  /** The active Lab recipe — null = single-material fallback (non-registry spec). */
  labRecipe: MaterialRecipe | null;
  labHandlers: LabHandlers;
  labUsage: { world: number; models: number };
  onExit: () => void;
  onSelectMaterial: (specId: string) => void;
  onVariant: (variant: number) => void;
  onSeed: () => void;
  onQuality: (quality: number) => void;
  onSlot: (slot: number) => void;
  onFill: (rgb: Rgb, source: string) => void;
  onReset: () => void;
  onView: (view: EditorState['colorStudioView']) => void;
  onSpineCurrent: (color: OklchColor) => void;
  onSpineAddToTray: () => void;
  onSpineTrayPick: (color: OklchColor) => void;
  onSpineScenePick: (color: OklchColor, css: string) => void;
  onSpineLoadLibrarySet: (name: string, colors: OklchColor[]) => void;
  onCreateSet: () => void;
  onDeleteSet: (index: number) => void;
  onOpenInLab: (specId: string) => void;
}) {
  const spec = colorStudioSpec(props.state);
  const specs = studioSpecs();
  const [stripPage, setStripPage] = useState(() => {
    const at = specs.findIndex((s) => s.id === spec.id);
    return at === -1 ? 0 : Math.floor(at / MATERIAL_STRIP_PAGE);
  });
  const maxStripPage = Math.max(0, Math.ceil(specs.length / MATERIAL_STRIP_PAGE) - 1);
  const page = Math.min(stripPage, maxStripPage);
  const stripSpecs = specs.slice(page * MATERIAL_STRIP_PAGE, page * MATERIAL_STRIP_PAGE + MATERIAL_STRIP_PAGE);

  const slots = spec.slots ?? [];
  const slotColors = slots.map((slot, index) => ({
    slot,
    index,
    rgb: resolvedSlotRgb(props.state, spec, index),
    baked: bakedSlotRgb(spec, index),
    active: index === Math.min(props.state.colorStudioActiveSlot, slots.length - 1),
  }));
  const activeSlot = slotColors[Math.min(props.state.colorStudioActiveSlot, slotColors.length - 1)] ?? slotColors[0];
  const activeOverrideKey = activeSlot ? colorStudioOverrideKey(spec.id, props.state.colorStudioVariant, activeSlot.index) : '';
  const slotOwned = activeSlot ? props.state.colorStudioOverrides[activeOverrideKey] !== undefined : false;
  const anyOverride = hasAnyOverride(props.state, spec);
  const fits = activeSlot ? slotFitColors(activeSlot.baked) : [];

  // The live preview data: memo'd so the <Effect> storage buffer only re-uploads
  // when an authoring input changes, not on every unrelated editor re-render.
  const previewData = useMemo(
    () => studioPreviewData(props.state, spec),
    [spec.id, props.state.colorStudioVariant, props.state.colorStudioSeed, props.state.colorStudioQuality, props.state.colorStudioOverrides],
  );
  const dDescriptor = `[${previewData.slice(0, 5).map((n) => Math.round(n)).join(', ')}${anyOverride ? ` +${slots.length} slots` : ''}]`;
  const spineRgb = oklchToRgb01(props.state.colorSpineCurrent) as Rgb;

  return (
    <C.HW_MaterialFocus>
      <C.HW_FocusHeader>
        <Icon name="FlaskConical" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Material Lab</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{VIEW_LABELS[props.state.colorStudioView]}</C.HW_PillTextOn></C.HW_PillOn>
        {props.state.colorStudioView === 'materialPalette' ? (
          <>
            <C.HW_Pill><C.HW_PillText>{props.labRecipe ? props.labRecipe.id : spec.id}</C.HW_PillText></C.HW_Pill>
            {!props.labRecipe ? <C.HW_Pill><C.HW_PillText>D {dDescriptor}</C.HW_PillText></C.HW_Pill> : null}
          </>
        ) : null}
        <C.HW_Spacer />
        <C.HW_Pill onPress={props.onExit}><C.HW_PillText>return to world</C.HW_PillText></C.HW_Pill>
      </C.HW_FocusHeader>
      <C.HW_ColorStudioShell>
        <ColorStudioViewTabs view={props.state.colorStudioView} onSelect={props.onView} />
        {props.state.colorStudioView === 'library' ? (
          <LabLibraryView
            sets={props.state.colorSpineSets}
            savedTray={props.state.colorSpinePalette}
            onOpenInLab={props.onOpenInLab}
            onLoadSet={props.onSpineLoadLibrarySet}
            onCreateSet={props.onCreateSet}
            onDeleteSet={props.onDeleteSet}
          />
        ) : props.labRecipe ? (
          <MaterialLabSurface
            state={props.state}
            recipe={props.labRecipe}
            usage={props.labUsage}
            handlers={props.labHandlers}
          />
        ) : (
        <>
        <C.HW_ColorMaterialStrip>
          <C.HW_Pill onPress={() => setStripPage(Math.max(0, page - 1))}>
            <Icon name="ChevronLeft" size={11} color={accentFor('textDim')} />
          </C.HW_Pill>
          {stripSpecs.map((option) => {
            const Card = option.id === spec.id ? C.HW_ColorMaterialCardOn : C.HW_ColorMaterialCard;
            const bands = (option.slots ?? []).slice(0, 4);
            return (
              <Card key={option.id} tooltip={`${option.label} - ${option.group}`} onPress={() => props.onSelectMaterial(option.id)}>
                <C.HW_ColorMaterialMini>
                  {bands.map((slot, index) => (
                    <C.HW_ColorMiniBand key={index} style={{ backgroundColor: rgbToCss(slot.rgb as Rgb) }} />
                  ))}
                </C.HW_ColorMaterialMini>
                {/* Single-line, ellipsized — card width is a SHARE of the strip,
                    so long names truncate instead of wrapping out of the card. */}
                <C.HW_ColorMaterialText>
                  <C.HW_FormValue numberOfLines={1} noWrap>{option.label}</C.HW_FormValue>
                  <C.HW_KeyText numberOfLines={1} noWrap>{option.group} - {option.slots?.length ?? 0} slots</C.HW_KeyText>
                </C.HW_ColorMaterialText>
              </Card>
            );
          })}
          <C.HW_Pill onPress={() => setStripPage(Math.min(maxStripPage, page + 1))}>
            <Icon name="ChevronRight" size={11} color={accentFor('textDim')} />
          </C.HW_Pill>
        </C.HW_ColorMaterialStrip>
        <C.HW_ColorStudioBody>
          <C.HW_ColorPreviewPanel>
            <C.HW_ColorPreviewHead>
              <Icon name="SwatchBook" size={13} color={accentFor('primary')} />
              <C.HW_HeadTitle>{spec.label}</C.HW_HeadTitle>
              <C.HW_PillOn><C.HW_PillTextOn>{spec.group}</C.HW_PillTextOn></C.HW_PillOn>
              <C.HW_Pill><C.HW_PillText>page {page + 1}/{maxStripPage + 1} - {specs.length} materials</C.HW_PillText></C.HW_Pill>
              <C.HW_Spacer />
              <C.HW_StatusText>{anyOverride ? 'override active' : 'baked defaults'}</C.HW_StatusText>
            </C.HW_ColorPreviewHead>
            {/* The REAL WGSL render — the same FILL_SHADER + D[] the game and the
                paint bake consume. No CSS approximation. */}
            <C.HW_ColorPreviewLive>
              <Effect shader={spec.shader} data={previewData} style={{ width: 280, height: 280 }} />
            </C.HW_ColorPreviewLive>
            <C.HW_ColorControlRow>
              {/* WIDE, not the 132px fixed group — take labels are real words
                  ('Trash Stains'), so the segment shares the row and each label
                  clamps to one line instead of wrapping out of the track. */}
              <C.HW_ColorControlGroupWide>
                <C.HW_KeyText>VARIANT</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {spec.variants.map((variant, index) => {
                    const Btn = index === props.state.colorStudioVariant ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = index === props.state.colorStudioVariant ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={variant.id} onPress={() => props.onVariant(index)}><Label numberOfLines={1} noWrap>{variant.label}</Label></Btn>;
                  })}
                </C.HW_ColorSegmentTrack>
              </C.HW_ColorControlGroupWide>
              <C.HW_ColorControlGroup>
                <C.HW_KeyText>SEED</C.HW_KeyText>
                <C.HW_ColorSeedButton onPress={props.onSeed}>
                  <Icon name="Dices" size={12} color={accentFor('primary')} />
                  <C.HW_FormValue>{props.state.colorStudioSeed}</C.HW_FormValue>
                </C.HW_ColorSeedButton>
              </C.HW_ColorControlGroup>
              <C.HW_ColorControlGroupWide>
                <C.HW_KeyText>QUALITY - D[3]</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {FILL_GRADES.map((label, quality) => {
                    const Btn = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={label} onPress={() => props.onQuality(quality)}><Label numberOfLines={1} noWrap>{label}</Label></Btn>;
                  })}
                </C.HW_ColorSegmentTrack>
              </C.HW_ColorControlGroupWide>
            </C.HW_ColorControlRow>
            <C.HW_ColorSlotHead>
              <C.HW_GroupTitle>
                <Icon name="Pipette" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>PALETTE SLOTS</C.HW_GroupText>
              </C.HW_GroupTitle>
              <C.HW_Spacer />
              <C.HW_Pill onPress={props.onReset}><C.HW_PillText>reset to baked</C.HW_PillText></C.HW_Pill>
            </C.HW_ColorSlotHead>
            <C.HW_ColorSlotGrid>
              {slotColors.map((entry) => {
                const Slot = entry.active ? C.HW_ColorSlotOn : C.HW_ColorSlot;
                const overrideKey = colorStudioOverrideKey(spec.id, props.state.colorStudioVariant, entry.index);
                return (
                  <Slot key={`${entry.index}-${entry.slot.name}`} onPress={() => props.onSlot(entry.index)}>
                    <C.HW_ColorSlotSwatch style={{ backgroundColor: rgbToCss(entry.rgb) }} />
                    <C.HW_ColorSlotText>
                      <C.HW_FormValue numberOfLines={1} noWrap>{entry.slot.name}</C.HW_FormValue>
                      <C.HW_KeyText numberOfLines={1} noWrap>slot {entry.index}</C.HW_KeyText>
                    </C.HW_ColorSlotText>
                    <C.HW_Spacer />
                    <C.HW_KeyText>{props.state.colorStudioOverrides[overrideKey] ? 'owned' : 'baked'}</C.HW_KeyText>
                  </Slot>
                );
              })}
            </C.HW_ColorSlotGrid>
          </C.HW_ColorPreviewPanel>
          <C.HW_ColorAssistPanel>
            <C.HW_GroupTitle>
              <Icon name="SlidersHorizontal" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>ACTIVE SLOT</C.HW_GroupText>
            </C.HW_GroupTitle>
            {activeSlot ? (
              <C.HW_ColorActiveSlot>
                <C.HW_ColorActiveSwatch style={{ backgroundColor: rgbToCss(activeSlot.rgb) }} />
                <C.HW_ColorActiveText>
                  <C.HW_HeadTitle>{activeSlot.slot.name}</C.HW_HeadTitle>
                  <C.HW_KeyText>{slotOwned ? 'you own it' : 'shader default'}</C.HW_KeyText>
                  <HexColorInput
                    value={rgbToCss(activeSlot.rgb)}
                    onCommit={(hex) => props.onFill(hexToRgb01(hex) as Rgb, `hex ${hex}`)}
                    showSwatch={false}
                    width={112}
                  />
                  <C.HW_ColorCode>was baked: {rgbToVec3(activeSlot.baked)}</C.HW_ColorCode>
                </C.HW_ColorActiveText>
              </C.HW_ColorActiveSlot>
            ) : (
              <C.HW_KeyText>this material exposes no color slots</C.HW_KeyText>
            )}
            {/* The unification: the spine's current color pours into the active slot. */}
            <C.HW_ColorSpineFill onPress={() => props.onFill(spineRgb, 'current color')}>
              <C.HW_ColorAssistChip style={{ backgroundColor: oklchToHex(props.state.colorSpineCurrent) }} />
              <C.HW_FormValue>use current color</C.HW_FormValue>
              <C.HW_Spacer />
              <C.HW_KeyText>{oklchName(props.state.colorSpineCurrent)}</C.HW_KeyText>
            </C.HW_ColorSpineFill>
            <C.HW_GroupTitle>
              <Icon name="Sparkles" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>FITS {activeSlot ? activeSlot.slot.name.toUpperCase() : 'SLOT'}</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorAssistGrid>
              {fits.map((entry) => (
                <C.HW_ColorAssistSwatch key={entry.label} onPress={() => props.onFill(entry.rgb, `fit ${entry.label}`)}>
                  <C.HW_ColorAssistChip style={{ backgroundColor: rgbToCss(entry.rgb) }} />
                  <C.HW_KeyText>{entry.label}</C.HW_KeyText>
                </C.HW_ColorAssistSwatch>
              ))}
            </C.HW_ColorAssistGrid>
            <C.HW_GroupTitle>
              <Icon name="Library" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>LIBRARY SLOT PULL</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorLibraryList>
              {props.state.colorSpineSets.map((set: SpinePaletteSet) => (
                <C.HW_ColorLibraryRow key={set.name}>
                  <C.HW_ColorLibraryName>
                    <C.HW_FormValue numberOfLines={1} noWrap>{set.name}</C.HW_FormValue>
                  </C.HW_ColorLibraryName>
                  <C.HW_ColorLibrarySwatches>
                    {set.colors.map((color, index) => {
                      const rgb = oklchToRgb01(color) as Rgb;
                      return (
                        <C.HW_ColorLibrarySwatch
                          key={index}
                          onPress={() => props.onFill(rgb, set.name)}
                          style={{ backgroundColor: oklchToHex(color) }}
                        />
                      );
                    })}
                  </C.HW_ColorLibrarySwatches>
                </C.HW_ColorLibraryRow>
              ))}
            </C.HW_ColorLibraryList>
          </C.HW_ColorAssistPanel>
        </C.HW_ColorStudioBody>
        </>
        )}
      </C.HW_ColorStudioShell>
    </C.HW_MaterialFocus>
  );
}
