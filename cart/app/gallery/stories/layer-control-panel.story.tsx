import { defineGallerySection, defineGalleryStory } from '../types';
import { LayerRow } from '../components/layer-control-panel/LayerRow';
import { LayerBlendModeControl } from '../components/layer-control-panel/LayerBlendModeControl';
import { LayerOpacityControls } from '../components/layer-control-panel/LayerOpacityControls';
import { LayerPropertiesPanel } from '../components/layer-control-panel/LayerPropertiesPanel';
import { layerControlPanelMockData } from '../data/overstock/layer-control-panel';

// "Layer Control Panel" was a Photoshop-style umbrella that bundled four
// distinct components plus their atoms. Each one is a real component on its
// own — split into four entries.

const data = layerControlPanelMockData;
const firstLayer = data.layers[0];

export const layerRowSection = defineGallerySection({
  id: 'layer-row',
  title: 'Layer Row',
  stories: [
    defineGalleryStory({
      id: 'layer-row/default',
      title: 'Layer Row',
      source: 'cart/app/gallery/components/layer-control-panel/LayerRow.tsx',
      status: 'ready',
      tags: ['layer', 'row', 'atom'],
      variants: [
        { id: 'default',  name: 'Default',  render: () => <LayerRow layer={firstLayer} /> },
        { id: 'selected', name: 'Selected', render: () => <LayerRow layer={firstLayer} selected /> },
      ],
    }),
  ],
});

export const layerBlendModeControlSection = defineGallerySection({
  id: 'layer-blend-mode-control',
  title: 'Layer Blend Mode Control',
  stories: [
    defineGalleryStory({
      id: 'layer-blend-mode-control/default',
      title: 'Layer Blend Mode Control',
      source: 'cart/app/gallery/components/layer-control-panel/LayerBlendModeControl.tsx',
      status: 'ready',
      tags: ['layer', 'control'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <LayerBlendModeControl layer={firstLayer} blendModes={data.blendModes} />,
        },
      ],
    }),
  ],
});

export const layerOpacityControlsSection = defineGallerySection({
  id: 'layer-opacity-controls',
  title: 'Layer Opacity Controls',
  stories: [
    defineGalleryStory({
      id: 'layer-opacity-controls/default',
      title: 'Layer Opacity Controls',
      source: 'cart/app/gallery/components/layer-control-panel/LayerOpacityControls.tsx',
      status: 'ready',
      tags: ['layer', 'control'],
      variants: [
        { id: 'default', name: 'Default', render: () => <LayerOpacityControls layer={firstLayer} /> },
      ],
    }),
  ],
});

export const layerPropertiesPanelSection = defineGallerySection({
  id: 'layer-properties-panel',
  title: 'Layer Properties Panel',
  stories: [
    defineGalleryStory({
      id: 'layer-properties-panel/default',
      title: 'Layer Properties Panel',
      source: 'cart/app/gallery/components/layer-control-panel/LayerPropertiesPanel.tsx',
      status: 'ready',
      tags: ['layer', 'panel'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => (
            <LayerPropertiesPanel layer={firstLayer} canvas={data.canvas} blendModes={data.blendModes} />
          ),
        },
      ],
    }),
  ],
});
