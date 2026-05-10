import { defineGallerySection, defineGalleryStory } from '../types';
import { EasingsShader } from '../components/easings/EasingsShader';

export const easingsShaderSection = defineGallerySection({
  id: 'easings-shader',
  title: 'Easings (Shader)',
  stories: [
    defineGalleryStory({
      id: 'easings-shader/default',
      title: 'Easings (Shader)',
      source: 'cart/app/gallery/components/easings/EasingsShader.tsx',
      status: 'draft',
      summary: 'All 31 easing curves rendered in ONE WGSL fragment-shader pass. The chart_stress SHADER pattern applied to easings.',
      tags: ['hooks', 'animation', 'perf', 'shader', 'gpu'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <EasingsShader />,
        },
      ],
    }),
  ],
});
