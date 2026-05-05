import { useMemo, useState } from 'react';
import { Box, Col, Row, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import {
  layerControlPanelMockData,
  type LayerControlLayer,
  type LayerControlPanelData,
} from '../../data/overstock/layer-control-panel';
import { DexSearchBar } from '../dex-search-bar/DexSearchBar';
import { SegmentedControl } from '../controls-specimen/SegmentedControl';
import { KeyValueBadge } from '../controls-specimen/KeyValueBadge';
import { StatusBadge } from '../controls-specimen/StatusBadge';
import { CTRL } from '../controls-specimen/controlsSpecimenTheme';
import { getLayerKindLabel } from './layerControlHelpers';
import { LayerPropertiesPanel } from './LayerPropertiesPanel';
import { LayerRow } from './LayerRow';
import { LayerToolbar } from './LayerToolbar';

export type LayerControlPanelProps = {
  data?: LayerControlPanelData;
  width?: number;
  height?: number;
};

function matchesFilter(layer: LayerControlLayer, filter: string): boolean {
  if (filter === 'PIX') return layer.kind === 'pixel' || layer.kind === 'smart';
  if (filter === 'TYPE') return layer.kind === 'type';
  if (filter === 'FX') return layer.effects > 0 || layer.mask || layer.kind === 'adjustment';
  return true;
}

export function LayerControlPanel({
  data = layerControlPanelMockData,
  width = 840,
  height = 560,
}: LayerControlPanelProps) {
  const [layers, setLayers] = useState<LayerControlLayer[]>(() => data.layers);
  const [selectedId, setSelectedId] = useState(() => data.layers[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [filterIndex, setFilterIndex] = useState(0);

  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? layers[0];
  const activeFilter = data.filters[filterIndex] ?? data.filters[0] ?? 'ALL';
  const visibleCount = layers.filter((layer) => layer.visible).length;

  const filteredLayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return layers.filter((layer) => {
      const queryMatch =
        q.length === 0 ||
        layer.name.toLowerCase().includes(q) ||
        layer.note.toLowerCase().includes(q) ||
        getLayerKindLabel(layer.kind).toLowerCase().includes(q);
      return queryMatch && matchesFilter(layer, activeFilter);
    });
  }, [activeFilter, layers, query]);

  function updateLayer(id: string, patch: Partial<LayerControlLayer>) {
    setLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  return (
    <Col
      style={{
        width,
        height,
        minHeight: 0,
        backgroundColor: CTRL.bg,
        borderWidth: 1,
        borderColor: CTRL.ruleBright,
        overflow: 'hidden',
      }}
    >
      <LayerToolbar
        documentName={data.documentName}
        activeChannel={data.activeChannel}
        layerCount={layers.length}
        visibleCount={visibleCount}
      />
      <Row style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, borderRightWidth: 1, borderColor: CTRL.rule }}>
          <DexSearchBar
            value={query}
            onChange={setQuery}
            placeholder="filter layers / effects"
            count={`${filteredLayers.length}/${layers.length}`}
          />
          <Box style={{ padding: 10, borderBottomWidth: 1, borderColor: CTRL.rule, alignItems: 'flex-start' }}>
            <SegmentedControl options={data.filters} active={filterIndex} onChange={setFilterIndex} />
          </Box>
          <ScrollView showScrollbar style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
            <Col style={{ width: '100%' }}>
              {filteredLayers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  selected={layer.id === selectedLayer?.id}
                  onSelect={() => setSelectedId(layer.id)}
                  onVisibilityChange={() => updateLayer(layer.id, { visible: !layer.visible })}
                  onLockChange={() => updateLayer(layer.id, { locked: !layer.locked })}
                />
              ))}
            </Col>
          </ScrollView>
          <S.GitLaneFooter>
            <StatusBadge label="STACK" tone="accent" variant="pill" />
            <KeyValueBadge label="VISIBLE" value={`${visibleCount}/${layers.length}`} tone="ok" />
            <KeyValueBadge label="FILTER" value={activeFilter} tone="blue" />
          </S.GitLaneFooter>
        </Col>
        <Box style={{ width: 318, flexShrink: 0, minHeight: 0 }}>
          {selectedLayer ? (
            <LayerPropertiesPanel
              layer={selectedLayer}
              canvas={data.canvas}
              blendModes={data.blendModes}
              onLayerChange={(patch) => updateLayer(selectedLayer.id, patch)}
            />
          ) : null}
        </Box>
      </Row>
    </Col>
  );
}
