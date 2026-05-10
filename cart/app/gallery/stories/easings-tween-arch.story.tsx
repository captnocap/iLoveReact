import { defineGallerySection, defineGalleryStory } from '../types';
import { EasingsTweenArch } from '../components/easings/EasingsTweenArch';

export const easingsTweenArchSection = defineGallerySection({
  id: 'easings-tween-arch',
  title: 'Easings (Tween Arch)',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'atom',
  stories: [
    defineGalleryStory({
      id: 'easings-tween-arch/default',
      title: 'Easings (Tween Arch)',
      source: 'cart/app/gallery/components/easings/EasingsTweenArch.tsx',
      status: 'draft',
      summary: 'Three animation architectures (JS loop, Zig math + JS loop, Zig-driven loop) measured at 50/200/500/1000 tiles. Read fps from the dev panel as you toggle.',
      tags: ['perf', 'animation', 'tween', 'easing'],
      variants: [
        {
          id: 'matrix',
          name: 'Architecture matrix',
          render: () => <EasingsTweenArch />,
        },
      ],
    }),
  ],
});
