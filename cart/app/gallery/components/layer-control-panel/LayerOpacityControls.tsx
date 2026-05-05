import { Col } from '@reactjit/runtime/primitives';
import type { LayerControlLayer } from '../../data/overstock/layer-control-panel';
import { ChoiceList } from '../controls-specimen/ChoiceList';
import { FilledRailSlider } from '../controls-specimen/FilledRailSlider';
import { MeterSlider } from '../controls-specimen/MeterSlider';
import { RangeSlider } from '../controls-specimen/RangeSlider';

export type LayerOpacityControlsProps = {
  layer: LayerControlLayer;
  onOpacityChange?: (next: number) => void;
  onFillChange?: (next: number) => void;
  onMaskRangeChange?: (next: { low: number; high: number }) => void;
};

export function LayerOpacityControls({
  layer,
  onOpacityChange,
  onFillChange,
  onMaskRangeChange,
}: LayerOpacityControlsProps) {
  return (
    <Col style={{ gap: 10, alignItems: 'flex-start' }}>
      <FilledRailSlider label="OPACITY" value={layer.opacity} width={260} onChange={onOpacityChange} />
      <MeterSlider label={`${String(layer.fill).padStart(3, '0')} / FILL`} value={layer.fill} width={260} tone="blue" onChange={onFillChange} />
      <RangeSlider low={layer.maskLow} high={layer.maskHigh} width={260} onChange={onMaskRangeChange} />
      <ChoiceList
        marker="bracket"
        active={layer.clipped ? 1 : layer.locked ? 2 : layer.mask ? 0 : 3}
        items={[
          { label: 'mask participates in alpha' },
          { label: 'clipped to layer below' },
          { label: 'preserve transparent pixels' },
          { label: 'unconstrained composite' },
        ]}
      />
    </Col>
  );
}
