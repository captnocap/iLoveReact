import { Box, Col, Pressable, Row } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { LayerControlLayer } from '../../data/overstock/layer-control-panel';
import { Body, Mono } from '../controls-specimen/controlsSpecimenParts';
import { KeyValueBadge } from '../controls-specimen/KeyValueBadge';
import { StatusBadge } from '../controls-specimen/StatusBadge';
import { StripBadge, type StripBadgeSegment } from '../controls-specimen/StripBadge';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';
import { getBlendShort, getLayerKindLabel, getLayerKindTone } from './layerControlHelpers';
import { LayerLockToggle, LayerVisibilityToggle } from './LayerToggleAtoms';
import { LayerThumbnail } from './LayerThumbnail';

export type LayerRowProps = {
  layer: LayerControlLayer;
  selected?: boolean;
  onSelect?: () => void;
  onVisibilityChange?: () => void;
  onLockChange?: () => void;
};

function layerSegments(layer: LayerControlLayer): StripBadgeSegment[] {
  const segments: StripBadgeSegment[] = [{ label: getBlendShort(layer.blendMode), tone: 'accent' }];
  if (layer.childCount) segments.push({ label: `${layer.childCount} CHILD`, tone: 'blue' });
  if (layer.effects > 0) segments.push({ label: `FX${layer.effects}`, tone: 'warn' });
  if (layer.mask) segments.push({ label: 'MASK', tone: 'ok' });
  if (layer.clipped) segments.push({ label: 'CLIP', tone: 'lilac' });
  if (layer.locked) segments.push({ label: 'LOCK', tone: 'flag' });
  return segments;
}

export function LayerRow({
  layer,
  selected = false,
  onSelect,
  onVisibilityChange,
  onLockChange,
}: LayerRowProps) {
  return (
    <Pressable
      onPress={onSelect}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        minHeight: 66,
        paddingLeft: 9,
        paddingRight: 9,
        paddingTop: 8,
        paddingBottom: 8,
        borderLeftWidth: 3,
        borderBottomWidth: 1,
        borderColor: selected ? CTRL.accent : CTRL.rule,
        backgroundColor: selected ? CTRL.bg2 : CTRL.bg,
      }}
    >
      <LayerVisibilityToggle active={layer.visible} onPress={onVisibilityChange} />
      <LayerThumbnail layer={layer} />
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 5 }}>
        <Row style={{ alignItems: 'center', gap: 8, minWidth: 0 }}>
          <S.GitTextTitle numberOfLines={1}>{layer.name}</S.GitTextTitle>
          <StatusBadge
            label={getLayerKindLabel(layer.kind)}
            tone={getLayerKindTone(layer.kind)}
            variant={selected ? 'solid' : 'outline'}
          />
        </Row>
        <Mono color={layer.visible ? CTRL.inkDimmer : CTRL.inkGhost} fontSize={8} lineHeight={10} numberOfLines={1}>
          {layer.note}
        </Mono>
        <StripBadge segments={layerSegments(layer)} />
      </Col>
      <Box style={{ flexShrink: 0, alignItems: 'flex-end', gap: 7 }}>
        <KeyValueBadge label="OP" value={`${layer.opacity}%`} tone={layer.opacity < 50 ? 'warn' : 'accent'} />
        <Body color={CTRL.inkDim} fontSize={10} lineHeight={12}>
          fill {layer.fill}%
        </Body>
      </Box>
      <LayerLockToggle active={layer.locked} onPress={onLockChange} />
    </Pressable>
  );
}
