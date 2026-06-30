import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import {
  COLOR_LIBRARY_SETS,
  QUALITY_LABELS,
  SHADER_MATERIALS,
  bakedSlotRgb,
  colorStudioMaterial,
  colorStudioOverrideKey,
  materialPreviewCells,
  resolvedSlotColor,
  rgbToCss,
  rgbToVec3,
  slotAssistColors,
} from '../data/colorStudio';
import type { Asset, ColorStudioMaterialKey, MockState } from '../data/types';

export default function MaterialFocusSurface(props: {
  state: MockState;
  activeAsset: Asset;
  onExit: () => void;
  onAction: (label: string) => void;
  onSelectMaterial: (material: ColorStudioMaterialKey) => void;
  onVariant: (variant: number) => void;
  onSeed: () => void;
  onQuality: (quality: number) => void;
  onSlot: (slot: number) => void;
  onFill: (color: string, source: string) => void;
  onReset: () => void;
}) {
  const material = colorStudioMaterial(props.state);
  const materialKeys = Object.keys(SHADER_MATERIALS) as ColorStudioMaterialKey[];
  const slotColors = material.slots.map((slot, index) => ({
    slot,
    index,
    color: resolvedSlotColor(props.state, material, index),
    baked: bakedSlotRgb(material, props.state.colorStudioVariant, index),
    active: index === props.state.colorStudioActiveSlot,
  }));
  const previewCells = materialPreviewCells(material, slotColors.map((slot) => slot.color), props.state.colorStudioSeed, props.state.colorStudioQuality);
  const activeSlot = slotColors[Math.min(props.state.colorStudioActiveSlot, slotColors.length - 1)] ?? slotColors[0]!;
  const activeOverrideKey = colorStudioOverrideKey(material.key, props.state.colorStudioVariant, activeSlot.index);
  const hasOverride = props.state.colorStudioOverrides[activeOverrideKey] !== undefined;
  const assistColors = slotAssistColors(material, props.state);
  const dDescriptor = `[${material.materialId}, ${props.state.colorStudioVariant}, ${props.state.colorStudioSeed}, ${props.state.colorStudioQuality}, ${material.board.split(' ')[0]}]`;

  return (
    <C.HW_MaterialFocus>
      <C.HW_FocusHeader>
        <Icon name="Palette" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Color Studio</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>Material Palette</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{material.shaderFn}</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>D {dDescriptor}</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={() => props.onAction(`save ${material.name} palette variant`)}><C.HW_PillText>save variant</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={props.onExit}><C.HW_PillText>return to world</C.HW_PillText></C.HW_Pill>
      </C.HW_FocusHeader>
      <C.HW_ColorStudioShell>
        <C.HW_ColorMaterialStrip>
          {materialKeys.map((key) => {
            const option = SHADER_MATERIALS[key];
            const Card = key === material.key ? C.HW_ColorMaterialCardOn : C.HW_ColorMaterialCard;
            const first = option.variants[0]!;
            return (
              <Card key={key} onPress={() => props.onSelectMaterial(key)}>
                <C.HW_ColorMaterialMini>
                  {first.slice(0, 4).map((rgb, index) => (
                    <C.HW_ColorMiniBand key={index} style={{ backgroundColor: rgbToCss(rgb) }} />
                  ))}
                </C.HW_ColorMaterialMini>
                <C.HW_ColorMaterialText>
                  <C.HW_FormValue>{option.name}</C.HW_FormValue>
                  <C.HW_KeyText>{option.board} - {option.shaderFn}</C.HW_KeyText>
                </C.HW_ColorMaterialText>
                <C.HW_Spacer />
                <C.HW_PillText>{option.slots.length} slots</C.HW_PillText>
              </Card>
            );
          })}
        </C.HW_ColorMaterialStrip>
        <C.HW_ColorStudioBody>
          <C.HW_ColorPreviewPanel>
            <C.HW_ColorPreviewHead>
              <Icon name="SwatchBook" size={13} color={accentFor('primary')} />
              <C.HW_HeadTitle>{material.name}</C.HW_HeadTitle>
              <C.HW_PillOn><C.HW_PillTextOn>{material.board}</C.HW_PillTextOn></C.HW_PillOn>
              <C.HW_Pill><C.HW_PillText>opened from {props.activeAsset.name}</C.HW_PillText></C.HW_Pill>
              <C.HW_Spacer />
              <C.HW_StatusText>{hasOverride ? 'override active' : 'baked defaults'}</C.HW_StatusText>
            </C.HW_ColorPreviewHead>
            <C.HW_ColorPreviewGrid>
              {previewCells.map((color, index) => (
                <C.HW_ColorPreviewCell
                  key={index}
                  style={{
                    backgroundColor: color,
                    borderColor: props.state.colorStudioQuality <= 1 ? accentFor('stageBg') : accentFor('borderSoft'),
                  }}
                />
              ))}
            </C.HW_ColorPreviewGrid>
            <C.HW_ColorControlRow>
              <C.HW_ColorControlGroup>
                <C.HW_KeyText>VARIANT</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {[0, 1, 2].map((variant) => {
                    const Btn = variant === props.state.colorStudioVariant ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = variant === props.state.colorStudioVariant ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={variant} onPress={() => props.onVariant(variant)}><Label>v{variant}</Label></Btn>;
                  })}
                </C.HW_ColorSegmentTrack>
              </C.HW_ColorControlGroup>
              <C.HW_ColorControlGroup>
                <C.HW_KeyText>SEED</C.HW_KeyText>
                <C.HW_ColorSeedButton onPress={props.onSeed}>
                  <Icon name="Dices" size={12} color={accentFor('primary')} />
                  <C.HW_FormValue>{props.state.colorStudioSeed}</C.HW_FormValue>
                </C.HW_ColorSeedButton>
              </C.HW_ColorControlGroup>
              <C.HW_ColorControlGroupWide>
                <C.HW_KeyText>QUALITY - D[{props.state.colorStudioQuality}]</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {QUALITY_LABELS.map((label, quality) => {
                    const Btn = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={label} onPress={() => props.onQuality(quality)}><Label>{label}</Label></Btn>;
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
                const overrideKey = colorStudioOverrideKey(material.key, props.state.colorStudioVariant, entry.index);
                return (
                  <Slot key={entry.slot.name} onPress={() => props.onSlot(entry.index)}>
                    <C.HW_ColorSlotSwatch style={{ backgroundColor: entry.color }} />
                    <C.HW_ColorSlotText>
                      <C.HW_FormValue>{entry.slot.name}</C.HW_FormValue>
                      <C.HW_KeyText>{entry.slot.role}</C.HW_KeyText>
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
            <C.HW_ColorActiveSlot>
              <C.HW_ColorActiveSwatch style={{ backgroundColor: activeSlot.color }} />
              <C.HW_ColorActiveText>
                <C.HW_HeadTitle>{activeSlot.slot.name}</C.HW_HeadTitle>
                <C.HW_KeyText>{activeSlot.slot.role} - {hasOverride ? 'you own it' : 'shader default'}</C.HW_KeyText>
                <C.HW_ColorCode>was baked: {rgbToVec3(activeSlot.baked)}</C.HW_ColorCode>
              </C.HW_ColorActiveText>
            </C.HW_ColorActiveSlot>
            <C.HW_ColorReadoutGrid>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{material.materialId}</C.HW_PerfValue>
                <C.HW_PerfLabel>materialId</C.HW_PerfLabel>
              </C.HW_PerfTile>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{props.state.colorStudioVariant}</C.HW_PerfValue>
                <C.HW_PerfLabel>variant</C.HW_PerfLabel>
              </C.HW_PerfTile>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{props.state.colorStudioSeed}</C.HW_PerfValue>
                <C.HW_PerfLabel>seed</C.HW_PerfLabel>
              </C.HW_PerfTile>
            </C.HW_ColorReadoutGrid>
            <C.HW_GroupTitle>
              <Icon name="Sparkles" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>FITS {material.name.toUpperCase()}</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorAssistGrid>
              {assistColors.map((entry) => (
                <C.HW_ColorAssistSwatch key={entry.label} onPress={() => props.onFill(entry.color, `fit ${entry.label}`)}>
                  <C.HW_ColorAssistChip style={{ backgroundColor: entry.color }} />
                  <C.HW_KeyText>{entry.label}</C.HW_KeyText>
                </C.HW_ColorAssistSwatch>
              ))}
            </C.HW_ColorAssistGrid>
            <C.HW_GroupTitle>
              <Icon name="Library" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>LIBRARY SLOT PULL</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorLibraryList>
              {COLOR_LIBRARY_SETS.map((set) => (
                <C.HW_ColorLibraryRow key={set.name}>
                  <C.HW_ColorLibraryName>
                    <C.HW_FormValue>{set.name}</C.HW_FormValue>
                    <C.HW_KeyText>{set.tag}</C.HW_KeyText>
                  </C.HW_ColorLibraryName>
                  <C.HW_ColorLibrarySwatches>
                    {set.colors.map((rgb, index) => {
                      const color = rgbToCss(rgb);
                      return <C.HW_ColorLibrarySwatch key={index} onPress={() => props.onFill(color, set.name)} style={{ backgroundColor: color }} />;
                    })}
                  </C.HW_ColorLibrarySwatches>
                </C.HW_ColorLibraryRow>
              ))}
            </C.HW_ColorLibraryList>
          </C.HW_ColorAssistPanel>
        </C.HW_ColorStudioBody>
      </C.HW_ColorStudioShell>
    </C.HW_MaterialFocus>
  );
}
