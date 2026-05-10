import { defineGallerySection, defineGalleryStory } from '../types';
import { Box } from '@reactjit/runtime/primitives';
import { SPINNERS } from '../components/grid-spinners/GridSpinners';

// Renamed to "Grid Spinner" (singular). The plural was a wall-of-spinners
// catalog page — that's a docs grid, not a component. Each spinner is now
// its own variant of one entry.

export const gridSpinnersSection = defineGallerySection({
  id: 'grid-spinner',
  title: 'Grid Spinner',
  stories: [
    defineGalleryStory({
      id: 'grid-spinner/all',
      title: 'Grid Spinner',
      source: 'cart/app/gallery/components/grid-spinners/GridSpinners.tsx',
      status: 'ready',
      tags: ['animation', 'loader'],
      variants: SPINNERS.map((s) => ({
        id: s.id,
        name: s.name,
        summary: s.caption,
        render: () => (
          <Box style={{ padding: 24 }}>
            <s.Comp />
          </Box>
        ),
      })),
    }),
  ],
});
