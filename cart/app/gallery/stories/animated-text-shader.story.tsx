import { defineGallerySection, defineGalleryStory } from '../types';
import { AnimatedTextShader } from '../components/animated-text/AnimatedTextShader';

export const animatedTextShaderSection = defineGallerySection({
  id: 'animated-text-shader',
  title: 'Animated Text (Shader)',
  stories: [
    defineGalleryStory({
      id: 'animated-text-shader/default',
      title: 'Animated Text (Shader)',
      source: 'cart/app/gallery/components/animated-text/AnimatedTextShader.tsx',
      status: 'draft',
      summary: 'Same four scenes as Animated Text — colors driven by named WGSL shaders via Text textEffect. Reveal scenes use interval pacing instead of RAF.',
      tags: ['hooks', 'animation', 'text', 'shader', 'gpu', 'perf'],
      variants: [
        {
          id: 'overview',
          name: 'Overview',
          render: () => <AnimatedTextShader />,
        },
      ],
    }),
  ],
});
