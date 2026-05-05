import { defineGallerySection, defineGalleryStory } from '../types';
import { LayerControlPanel } from '../components/layer-control-panel/LayerControlPanel';
import { layerControlPanelMockData } from '../data/overstock/layer-control-panel';

export const layerControlPanelSection = defineGallerySection({
  id: 'layer-control-panel',
  title: 'Layer Control Panel',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/layer-control-panel/LayerToggleAtoms.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerThumbnail.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerRow.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerToolbar.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerBlendModeControl.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerOpacityControls.tsx',
    'cart/app/gallery/components/layer-control-panel/LayerPropertiesPanel.tsx',
    'cart/app/gallery/components/controls-specimen/StatusBadge.tsx',
    'cart/app/gallery/components/controls-specimen/KeyValueBadge.tsx',
    'cart/app/gallery/components/controls-specimen/StripBadge.tsx',
    'cart/app/gallery/components/controls-specimen/SegmentedControl.tsx',
    'cart/app/gallery/components/controls-specimen/FilledRailSlider.tsx',
    'cart/app/gallery/components/controls-specimen/MeterSlider.tsx',
    'cart/app/gallery/components/controls-specimen/RangeSlider.tsx',
    'cart/app/gallery/components/controls-specimen/ChoiceList.tsx',
    'cart/app/gallery/components/dex-search-bar/DexSearchBar.tsx',
  ],
  stories: [
    defineGalleryStory({
      id: 'layer-control-panel/default',
      title: 'Layer Control Panel',
      source: 'cart/app/gallery/components/layer-control-panel/LayerControlPanel.tsx',
      status: 'ready',
      summary: 'Photoshop-style layer stack with visibility, lock, blend, opacity, fill, mask range, filter, and detail controls.',
      tags: ['panel', 'controls', 'composition'],
      variants: [
        {
          id: 'full-panel',
          name: 'Full panel',
          render: () => <LayerControlPanel data={layerControlPanelMockData} />,
        },
      ],
    }),
  ],
});
