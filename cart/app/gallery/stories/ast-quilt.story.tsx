import { defineGallerySection, defineGalleryStory } from '../types';
import { AstBinarySquares, AstBinaryTile, AstQuilt, AstTile } from '../components/ast-quilt/AstQuilt';
import { AstTileBox } from '../components/ast-quilt/AstTileBox';
import {
  AstFingerprintEffect,
  AstFingerprintEffectGrid,
} from '../components/ast-quilt/EffectFromFingerprint';
import { AST_SAMPLE_FILES } from '../components/ast-quilt/sampleContract';

export const astQuiltSection = defineGallerySection({
  id: 'ast-quilt',
  title: 'AST Quilt',
  stories: [
    defineGalleryStory({
      id: 'ast-quilt/default',
      title: 'AST Quilt',
      source: 'cart/app/gallery/components/ast-quilt/AstQuilt.tsx',
      status: 'ready',
      summary: 'Treemap, binary-square, and gene-driven procedural fingerprint tiles. Same file always lands on the same effect.',
      tags: ['effect', 'fingerprint', 'treemap', 'binary', 'procedural', 'runtime'],
      variants: [
        {
          id: 'default',
          name: 'Quilt',
          render: () => <AstQuilt />,
        },
        {
          id: 'binary-squares',
          name: 'Binary Squares',
          render: () => <AstBinarySquares />,
        },
        {
          id: 'single-tile',
          name: 'Single Tile',
          render: () => <AstTile file={{ ...AST_SAMPLE_FILES[17], selected: true, tagColor: 'theme:ok' }} tileIndex={17} />,
        },
        {
          id: 'box-tile',
          name: 'Box Tile (host-driven)',
          render: () => <AstTileBox file={{ ...AST_SAMPLE_FILES[17], selected: true, tagColor: 'theme:ok' }} tileIndex={17} />,
        },
        {
          id: 'binary-tile',
          name: 'Binary Tile',
          render: () => <AstBinaryTile file={{ ...AST_SAMPLE_FILES[17], selected: true, tagColor: 'theme:ok' }} tileIndex={17} />,
        },
        {
          id: 'random-effect',
          name: 'Random Effect',
          render: () => <AstFingerprintEffect file={AST_SAMPLE_FILES[7]} />,
        },
        {
          id: 'random-effect-grid',
          name: 'Random Effect Grid',
          render: () => <AstFingerprintEffectGrid gridSide={4} />,
        },
        {
          id: 'random-effect-grid-dense',
          name: 'Random Effect Grid (6×6)',
          render: () => <AstFingerprintEffectGrid gridSide={6} />,
        },
      ],
    }),
  ],
});
