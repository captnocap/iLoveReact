import { defineGallerySection, defineGalleryStory } from '../types';
import { AstBinaryTile, AstTile } from '../components/ast-quilt/AstQuilt';
import { AstTileBox } from '../components/ast-quilt/AstTileBox';
import { AstFingerprintEffect } from '../components/ast-quilt/EffectFromFingerprint';
import { AST_SAMPLE_FILES } from '../components/ast-quilt/sampleContract';

// Just the 3 tile atoms. The full quilt, the binary-squares wall, the
// fingerprint-effect grids — all of those are catalog/montage shapes, not
// components. Compose them later if needed; don't ship them as a gallery entry.

const sampleFile = { ...AST_SAMPLE_FILES[17], selected: true, tagColor: 'theme:ok' as const };

export const astQuiltSection = defineGallerySection({
  id: 'ast-tile',
  title: 'AST Tile',
  stories: [
    defineGalleryStory({
      id: 'ast-tile/default',
      title: 'AST Tile',
      source: 'cart/app/gallery/components/ast-quilt/AstQuilt.tsx',
      status: 'ready',
      summary: 'Three tile shapes for AST fingerprint visualization.',
      tags: ['effect', 'fingerprint', 'tile'],
      variants: [
        {
          id: 'tile',
          name: 'Tile',
          render: () => <AstTile file={sampleFile} tileIndex={17} />,
        },
        {
          id: 'tile-box',
          name: 'Tile (host-driven)',
          render: () => <AstTileBox file={sampleFile} tileIndex={17} />,
        },
        {
          id: 'binary-tile',
          name: 'Binary Tile',
          render: () => <AstBinaryTile file={sampleFile} tileIndex={17} />,
        },
        {
          id: 'fingerprint-effect',
          name: 'Fingerprint Effect',
          render: () => <AstFingerprintEffect file={AST_SAMPLE_FILES[7]} />,
        },
      ],
    }),
  ],
});
