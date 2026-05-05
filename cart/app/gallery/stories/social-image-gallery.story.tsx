import { Box } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { SocialImageGallery } from '../components/social-image-gallery/SocialImageGallery';
import {
  DEFAULT_SOCIAL_IMAGE_POST,
} from '../components/social-image-gallery/socialImageGalleryShared';
import { newsFeedPostMockData } from '../data/overstock/news-feed-post';

export const socialImageGallerySection = defineGallerySection({
  id: 'social-image-gallery',
  title: 'Social Image Gallery',
  group: {
    id: 'compositions',
    title: 'Compositions',
  },
  kind: 'top-level',
  composedOf: [
    'cart/app/gallery/components/social-image-gallery/SocialImageAuthor.tsx',
    'cart/app/gallery/components/social-image-gallery/SocialImageStage.tsx',
    'cart/app/gallery/components/social-image-gallery/SocialImageActions.tsx',
    'cart/app/gallery/components/social-image-gallery/SocialImageComments.tsx',
    'cart/app/gallery/components/social-image-gallery/socialImageGalleryShared.ts',
  ],
  stories: [
    defineGalleryStory({
      id: 'social-image-gallery/default',
      title: 'Social Image Gallery',
      source: 'cart/app/gallery/components/social-image-gallery/SocialImageGallery.tsx',
      status: 'draft',
      tags: ['image', 'gallery', 'social', 'feed'],
      variants: [
        {
          id: 'feed-post',
          name: 'Feed post',
          render: () => (
            <Box style={{ width: 860, height: 540 }}>
              <SocialImageGallery post={DEFAULT_SOCIAL_IMAGE_POST} />
            </Box>
          ),
        },
        {
          id: 'narrow',
          name: 'Narrow viewer',
          render: () => (
            <Box style={{ width: 620, height: 620 }}>
              <SocialImageGallery post={DEFAULT_SOCIAL_IMAGE_POST} initialIndex={1} />
            </Box>
          ),
        },
        {
          id: 'reposted-thread',
          name: 'Reposted thread',
          render: () => (
            <Box style={{ width: 860, height: 540 }}>
              <SocialImageGallery
                post={newsFeedPostMockData[2]}
                initialIndex={2}
              />
            </Box>
          ),
        },
      ],
    }),
  ],
});
