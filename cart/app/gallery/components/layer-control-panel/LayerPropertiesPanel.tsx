import { Box, Col, Row, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { LayerBlendMode, LayerControlLayer } from '../../data/overstock/layer-control-panel';
import { Body, Mono } from '../controls-specimen/controlsSpecimenParts';
import { FileTabCard } from '../controls-specimen/FileTabCard';
import { KeyValueBadge } from '../controls-specimen/KeyValueBadge';
import { MetricBadge } from '../controls-specimen/MetricBadge';
import { StatusBadge } from '../controls-specimen/StatusBadge';
import { StripBadge } from '../controls-specimen/StripBadge';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';
import { getBlendShort, getLayerKindLabel, getLayerKindTone } from './layerControlHelpers';
import { LayerBlendModeControl } from './LayerBlendModeControl';
import { LayerOpacityControls } from './LayerOpacityControls';
import { LayerThumbnail } from './LayerThumbnail';

export type LayerPropertiesPanelProps = {
  layer: LayerControlLayer;
  canvas: string;
  blendModes: LayerBlendMode[];
  onLayerChange?: (patch: Partial<LayerControlLayer>) => void;
};

export function LayerPropertiesPanel({
  layer,
  canvas,
  blendModes,
  onLayerChange,
}: LayerPropertiesPanelProps) {
  return (
    <Col style={{ width: '100%', height: '100%', minHeight: 0, backgroundColor: CTRL.bg1 }}>
      <Box
        style={{
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderColor: CTRL.rule,
          gap: 10,
        }}
      >
        <Row style={{ alignItems: 'center', gap: 10 }}>
          <LayerThumbnail layer={layer} size="large" />
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 5 }}>
            <S.GitTextTitle numberOfLines={1}>{layer.name}</S.GitTextTitle>
            <Mono color={CTRL.inkDim} fontSize={9} lineHeight={11} numberOfLines={2}>
              {layer.note}
            </Mono>
            <StripBadge
              segments={[
                { label: getLayerKindLabel(layer.kind), tone: getLayerKindTone(layer.kind) },
                { label: getBlendShort(layer.blendMode), tone: 'accent' },
                { label: layer.visible ? 'VISIBLE' : 'HIDDEN', tone: layer.visible ? 'ok' : 'neutral' },
              ]}
            />
          </Col>
        </Row>
      </Box>
      <ScrollView showScrollbar style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Col style={{ gap: 14, padding: 12, alignItems: 'flex-start' }}>
          <Row style={{ gap: 10, flexWrap: 'wrap' }}>
            <KeyValueBadge label="CANVAS" value={canvas} tone="blue" />
            <KeyValueBadge label="MASK" value={layer.mask ? 'ON' : 'OFF'} tone={layer.mask ? 'ok' : 'neutral'} />
            <StatusBadge label={layer.locked ? 'LOCKED' : 'EDITABLE'} tone={layer.locked ? 'flag' : 'ok'} variant="led" />
          </Row>
          <FileTabCard
            leaf="LAYER"
            title={layer.name}
            tone={getLayerKindTone(layer.kind)}
            meta={[
              { label: 'KIND', value: getLayerKindLabel(layer.kind) },
              { label: 'BLEND', value: getBlendShort(layer.blendMode) },
              { label: 'FX', value: String(layer.effects) },
            ]}
          />
          <Row style={{ gap: 10, flexWrap: 'wrap' }}>
            <MetricBadge label="opacity" value={String(layer.opacity)} unit="%" />
            <MetricBadge label="fill" value={String(layer.fill)} unit="%" />
          </Row>
          <LayerBlendModeControl
            layer={layer}
            blendModes={blendModes}
            onBlendModeChange={(blendMode) => onLayerChange?.({ blendMode })}
          />
          <LayerOpacityControls
            layer={layer}
            onOpacityChange={(opacity) => onLayerChange?.({ opacity })}
            onFillChange={(fill) => onLayerChange?.({ fill })}
            onMaskRangeChange={(range) => onLayerChange?.({ maskLow: range.low, maskHigh: range.high })}
          />
          <Body color={CTRL.inkDim} fontSize={11} lineHeight={14}>
            This deck is assembled from the existing badge, selector, tab-card, slider, meter, range, and choice-list atoms.
          </Body>
        </Col>
      </ScrollView>
    </Col>
  );
}
