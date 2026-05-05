import { Col, Row } from '@reactjit/runtime/primitives';
import { Blend } from '@reactjit/runtime/icons/icons';
import { classifiers as S } from '@reactjit/core';
import { Icon } from '@reactjit/runtime/icons/Icon';
import type { LayerBlendMode, LayerControlLayer } from '../../data/overstock/layer-control-panel';
import { Body, Mono } from '../controls-specimen/controlsSpecimenParts';
import { KeyValueBadge } from '../controls-specimen/KeyValueBadge';
import { SegmentedControl } from '../controls-specimen/SegmentedControl';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';
import { getBlendShort } from './layerControlHelpers';

export type LayerBlendModeControlProps = {
  layer: LayerControlLayer;
  blendModes: LayerBlendMode[];
  onBlendModeChange?: (next: LayerBlendMode) => void;
};

export function LayerBlendModeControl({
  layer,
  blendModes,
  onBlendModeChange,
}: LayerBlendModeControlProps) {
  const activeIndex = Math.max(0, blendModes.indexOf(layer.blendMode));

  return (
    <Col style={{ gap: 8, alignItems: 'flex-start' }}>
      <S.InlineX5Between>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon icon={Blend} size={15} color={CTRL.accent} strokeWidth={2.2} />
          <Body color={CTRL.ink} fontSize={13} lineHeight={15} fontWeight="bold">
            Blend mode
          </Body>
        </Row>
        <KeyValueBadge label="MODE" value={getBlendShort(layer.blendMode)} tone="accent" />
      </S.InlineX5Between>
      <SegmentedControl
        options={blendModes.map(getBlendShort)}
        active={activeIndex}
        onChange={(next) => onBlendModeChange?.(blendModes[next] ?? blendModes[0])}
      />
      <Mono color={CTRL.inkGhost}>existing segmented control atom</Mono>
    </Col>
  );
}
