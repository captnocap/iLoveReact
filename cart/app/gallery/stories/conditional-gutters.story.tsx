import { defineGallerySection, defineGalleryStory } from '../types';
import { Box } from '@reactjit/runtime/primitives';
import { ConditionalGutter } from '../components/conditional-gutters/ConditionalGutter';

// Renamed to "Conditional Gutter" (singular). The plural was an IDE-shell
// demo that bundled four mock chrome panels around a fake editor — that's the
// shape of a screen, not a component. The component is the gutter itself.

const filler = () => (
  <Box style={{ flex: 1, padding: 12, backgroundColor: 'theme:bg' }}>
    <Box style={{ width: '100%', height: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: 'theme:rule' }} />
  </Box>
);

const stage = (gutter: any) => (
  <Box style={{ width: 480, height: 320, borderWidth: 1, borderColor: 'theme:rule', overflow: 'hidden' }}>
    {gutter}
  </Box>
);

export const conditionalGuttersSection = defineGallerySection({
  id: 'conditional-gutter',
  title: 'Conditional Gutter',
  stories: [
    defineGalleryStory({
      id: 'conditional-gutter/edges',
      title: 'Conditional Gutter',
      source: 'cart/app/gallery/components/conditional-gutters/ConditionalGutter.tsx',
      status: 'ready',
      summary: 'Edge-owned panel that animates open/closed. One edge per variant.',
      tags: ['motion', 'layout', 'gutter'],
      variants: [
        {
          id: 'left',
          name: 'Left edge',
          render: () => stage(
            <ConditionalGutter edge="left" open size={180} durationMs={220}>{filler()}</ConditionalGutter>
          ),
        },
        {
          id: 'right',
          name: 'Right edge',
          render: () => stage(
            <ConditionalGutter edge="right" open size={220} durationMs={220}>{filler()}</ConditionalGutter>
          ),
        },
        {
          id: 'top',
          name: 'Top edge',
          render: () => stage(
            <ConditionalGutter edge="top" open size={64} durationMs={220}>{filler()}</ConditionalGutter>
          ),
        },
        {
          id: 'bottom',
          name: 'Bottom edge',
          render: () => stage(
            <ConditionalGutter edge="bottom" open size={120} durationMs={220}>{filler()}</ConditionalGutter>
          ),
        },
      ],
    }),
  ],
});
