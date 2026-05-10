import { defineGallerySection, defineGalleryStory } from '../types';
import { EasingsInlinePaint } from '../components/easings/EasingsInlinePaint';

export const easingsInlinePaintSection = defineGallerySection({
  id: 'easings-inline-paint',
  title: 'Easings (Inline-paint)',
  stories: [
    defineGalleryStory({
      id: 'easings-inline-paint/default',
      title: 'Easings (Inline-paint)',
      source: 'cart/app/gallery/components/easings/EasingsInlinePaint.tsx',
      status: 'draft',
      summary: 'Animation params live on the Box style; engine.zig evaluates them in the painter using SDL_GetTicks. Same wire model as border_dash.zig — no registry, no latches, no useEffect.',
      tags: ['perf', 'animation', 'easing', 'paint'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <EasingsInlinePaint />,
        },
      ],
    }),
  ],
});
