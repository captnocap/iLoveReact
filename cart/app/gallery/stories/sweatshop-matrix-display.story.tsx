import { defineGallerySection, defineGalleryStory } from '../types';
import { BrailleProjectionSquare } from '../components/sweatshop-matrix-display/BrailleEffectInstrument';

// Renamed from "Sweatshop Matrix Display". The component is one
// BrailleProjectionSquare. The wall (every effect at every size) and the
// "instrument" wrapper were both catalog/page shapes.

export const sweatshopMatrixDisplaySection = defineGallerySection({
  id: 'braille-projection',
  title: 'Braille Projection',
  stories: [
    defineGalleryStory({
      id: 'braille-projection/default',
      title: 'Braille Projection',
      source: 'cart/app/gallery/components/sweatshop-matrix-display/BrailleProjectionSurface.tsx',
      status: 'ready',
      summary: 'One braille projection square. Variants change the size only.',
      tags: ['matrix', 'braille', 'projection'],
      variants: [
        { id: 'native',  name: 'Native (128)', render: () => <BrailleProjectionSquare size={128} /> },
        { id: 'small',   name: 'Small (64)',   render: () => <BrailleProjectionSquare size={64} /> },
        { id: 'large',   name: 'Large (256)',  render: () => <BrailleProjectionSquare size={256} /> },
        { id: 'huge',    name: 'Huge (512)',   render: () => <BrailleProjectionSquare size={512} /> },
      ],
    }),
  ],
});
