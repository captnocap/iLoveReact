import { defineGallerySection, defineGalleryStory } from '../types';
import { PresetCard } from '../components/preset-card/PresetCard';
import { inferencePresetMockData } from '../data/core/inference-preset';

export const presetCardSection = defineGallerySection({
  id: "preset-card",
  title: "Preset Card",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "preset-card/default",
      title: "Preset Card",
      source: "cart/app/gallery/components/preset-card/PresetCard.tsx",
      status: 'draft',
      tags: ["card"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <PresetCard row={inferencePresetMockData[0]} />,
        },
      ],
    }),
  ],
});
