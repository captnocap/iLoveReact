import { useState } from 'react';
import { Box, Col, Row } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory, type GallerySection } from '../types';
import { LayerBlendModeControl } from '../components/layer-control-panel/LayerBlendModeControl';
import { LayerOpacityControls } from '../components/layer-control-panel/LayerOpacityControls';
import { LayerPropertiesPanel } from '../components/layer-control-panel/LayerPropertiesPanel';
import { LayerRow } from '../components/layer-control-panel/LayerRow';
import { LayerThumbnail } from '../components/layer-control-panel/LayerThumbnail';
import { LayerLockToggle, LayerVisibilityToggle } from '../components/layer-control-panel/LayerToggleAtoms';
import { LayerToolbar } from '../components/layer-control-panel/LayerToolbar';
import {
  layerControlPanelMockData,
  type LayerControlLayer,
} from '../data/overstock/layer-control-panel';
import { CTRL } from '../components/controls-specimen/controlsSpecimenTheme';

const firstLayer = layerControlPanelMockData.layers[0];
const titleLayer = layerControlPanelMockData.layers[1];
const groupLayer = layerControlPanelMockData.layers[2];
const hiddenLayer = layerControlPanelMockData.layers[5];

function AtomPad({ children, width = 420, height }: { children: any; width?: number; height?: number }) {
  return (
    <Box
      style={{
        width,
        height,
        padding: 14,
        alignItems: 'flex-start',
        justifyContent: 'center',
        backgroundColor: CTRL.bg,
        borderWidth: 1,
        borderColor: CTRL.rule,
      }}
    >
      {children}
    </Box>
  );
}

function StatefulLayerRow({ layer, selected = false }: { layer: LayerControlLayer; selected?: boolean }) {
  const [current, setCurrent] = useState<LayerControlLayer>(layer);
  return (
    <AtomPad width={720}>
      <LayerRow
        layer={current}
        selected={selected}
        onVisibilityChange={() => setCurrent((item) => ({ ...item, visible: !item.visible }))}
        onLockChange={() => setCurrent((item) => ({ ...item, locked: !item.locked }))}
      />
    </AtomPad>
  );
}

function StatefulBlendMode() {
  const [layer, setLayer] = useState<LayerControlLayer>(firstLayer);
  return (
    <AtomPad width={320}>
      <LayerBlendModeControl
        layer={layer}
        blendModes={layerControlPanelMockData.blendModes}
        onBlendModeChange={(blendMode) => setLayer((item) => ({ ...item, blendMode }))}
      />
    </AtomPad>
  );
}

function StatefulOpacityControls() {
  const [layer, setLayer] = useState<LayerControlLayer>(firstLayer);
  return (
    <AtomPad width={320}>
      <LayerOpacityControls
        layer={layer}
        onOpacityChange={(opacity) => setLayer((item) => ({ ...item, opacity }))}
        onFillChange={(fill) => setLayer((item) => ({ ...item, fill }))}
        onMaskRangeChange={(range) => setLayer((item) => ({ ...item, maskLow: range.low, maskHigh: range.high }))}
      />
    </AtomPad>
  );
}

function StatefulPropertiesPanel() {
  const [layer, setLayer] = useState<LayerControlLayer>(titleLayer);
  return (
    <Box style={{ width: 318, height: 440, borderWidth: 1, borderColor: CTRL.ruleBright }}>
      <LayerPropertiesPanel
        layer={layer}
        canvas={layerControlPanelMockData.canvas}
        blendModes={layerControlPanelMockData.blendModes}
        onLayerChange={(patch) => setLayer((item) => ({ ...item, ...patch }))}
      />
    </Box>
  );
}

function section(
  id: string,
  title: string,
  source: string,
  variants: { id: string; name: string; render: () => any }[],
): GallerySection {
  return defineGallerySection({
    id,
    title,
    group: {
      id: 'controls',
      title: 'Controls & Cards',
    },
    kind: 'atom',
    stories: [
      defineGalleryStory({
        id: `${id}/default`,
        title,
        source,
        status: 'ready',
        summary: 'Layer-control atom for building a Photoshop-style layer stack.',
        tags: ['controls', 'panel', 'atom'],
        variants,
      }),
    ],
  });
}

export const layerVisibilityToggleSection = section(
  'layer-visibility-toggle',
  'Layer Visibility Toggle',
  'cart/app/gallery/components/layer-control-panel/LayerToggleAtoms.tsx',
  [
    {
      id: 'visible',
      name: 'Visible',
      render: () => (
        <AtomPad width={120}>
          <LayerVisibilityToggle active />
        </AtomPad>
      ),
    },
    {
      id: 'hidden',
      name: 'Hidden',
      render: () => (
        <AtomPad width={120}>
          <LayerVisibilityToggle active={false} />
        </AtomPad>
      ),
    },
  ],
);

export const layerLockToggleSection = section(
  'layer-lock-toggle',
  'Layer Lock Toggle',
  'cart/app/gallery/components/layer-control-panel/LayerToggleAtoms.tsx',
  [
    {
      id: 'unlocked',
      name: 'Unlocked',
      render: () => (
        <AtomPad width={120}>
          <LayerLockToggle active={false} />
        </AtomPad>
      ),
    },
    {
      id: 'locked',
      name: 'Locked',
      render: () => (
        <AtomPad width={120}>
          <LayerLockToggle active />
        </AtomPad>
      ),
    },
  ],
);

export const layerThumbnailSection = section(
  'layer-thumbnail',
  'Layer Thumbnail',
  'cart/app/gallery/components/layer-control-panel/LayerThumbnail.tsx',
  [
    {
      id: 'compact',
      name: 'Compact',
      render: () => (
        <AtomPad width={280}>
          <Row style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {layerControlPanelMockData.layers.slice(0, 5).map((layer) => (
              <LayerThumbnail key={layer.id} layer={layer} />
            ))}
          </Row>
        </AtomPad>
      ),
    },
    {
      id: 'large',
      name: 'Large',
      render: () => (
        <AtomPad width={320}>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            <LayerThumbnail layer={firstLayer} size="large" />
            <LayerThumbnail layer={groupLayer} size="large" />
            <LayerThumbnail layer={hiddenLayer} size="large" />
          </Row>
        </AtomPad>
      ),
    },
  ],
);

export const layerRowSection = section(
  'layer-row',
  'Layer Row',
  'cart/app/gallery/components/layer-control-panel/LayerRow.tsx',
  [
    {
      id: 'selected',
      name: 'Selected',
      render: () => <StatefulLayerRow layer={firstLayer} selected />,
    },
    {
      id: 'group',
      name: 'Group',
      render: () => <StatefulLayerRow layer={groupLayer} />,
    },
    {
      id: 'hidden',
      name: 'Hidden',
      render: () => <StatefulLayerRow layer={hiddenLayer} />,
    },
  ],
);

export const layerToolbarSection = section(
  'layer-toolbar',
  'Layer Toolbar',
  'cart/app/gallery/components/layer-control-panel/LayerToolbar.tsx',
  [
    {
      id: 'document',
      name: 'Document',
      render: () => (
        <AtomPad width={820}>
          <LayerToolbar
            documentName={layerControlPanelMockData.documentName}
            activeChannel={layerControlPanelMockData.activeChannel}
            layerCount={layerControlPanelMockData.layers.length}
            visibleCount={layerControlPanelMockData.layers.filter((layer) => layer.visible).length}
          />
        </AtomPad>
      ),
    },
  ],
);

export const layerBlendModeControlSection = section(
  'layer-blend-mode-control',
  'Layer Blend Mode Control',
  'cart/app/gallery/components/layer-control-panel/LayerBlendModeControl.tsx',
  [
    {
      id: 'blend',
      name: 'Blend',
      render: () => <StatefulBlendMode />,
    },
  ],
);

export const layerOpacityControlsSection = section(
  'layer-opacity-controls',
  'Layer Opacity Controls',
  'cart/app/gallery/components/layer-control-panel/LayerOpacityControls.tsx',
  [
    {
      id: 'sliders',
      name: 'Sliders',
      render: () => <StatefulOpacityControls />,
    },
  ],
);

export const layerPropertiesPanelSection = section(
  'layer-properties-panel',
  'Layer Properties Panel',
  'cart/app/gallery/components/layer-control-panel/LayerPropertiesPanel.tsx',
  [
    {
      id: 'detail',
      name: 'Detail',
      render: () => (
        <Col style={{ padding: 14, backgroundColor: CTRL.bg }}>
          <StatefulPropertiesPanel />
        </Col>
      ),
    },
  ],
);

export const layerControlAtomSections = [
  layerVisibilityToggleSection,
  layerLockToggleSection,
  layerThumbnailSection,
  layerRowSection,
  layerToolbarSection,
  layerBlendModeControlSection,
  layerOpacityControlsSection,
  layerPropertiesPanelSection,
];
