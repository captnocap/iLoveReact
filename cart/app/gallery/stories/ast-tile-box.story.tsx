import { defineGallerySection, defineGalleryStory } from '../types';
import { AstTileBox } from '../components/ast-quilt/AstTileBox';
import { AST_SAMPLE_FILES } from '../components/ast-quilt/sampleContract';

export const astTileBoxSection = defineGallerySection({
  id: 'ast-tile-box',
  title: 'AST Tile (Box host-driven)',
  stories: [
    defineGalleryStory({
      id: 'ast-tile-box/default',
      title: 'AST Tile (Box host-driven)',
      source: 'cart/app/gallery/components/ast-quilt/AstTileBox.tsx',
      status: 'draft',
      summary: 'Box-tree rebuild of AST Tile. Same recursive grid, scan band animated via host latch instead of per-pixel JS. Compare to "AST Quilt → Single Tile".',
      tags: ['ast', 'host-driven', 'latch', 'perf'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <AstTileBox file={{ ...AST_SAMPLE_FILES[17], selected: true, tagColor: 'theme:ok' }} tileIndex={17} />,
        },
      ],
    }),
  ],
});
