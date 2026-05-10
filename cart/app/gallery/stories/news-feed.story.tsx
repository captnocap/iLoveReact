import { defineGallerySection, defineGalleryStory } from '../types';
import { FeedPostCard } from '../components/news-feed/FeedPostCard';
import { newsFeedPostMockData } from '../data/overstock/news-feed-post';

// The component is FeedPostCard — one post. The "News Feed" wrapper that
// stacked posts + composer + actions was the app shape, not a component.

export const newsFeedSection = defineGallerySection({
  id: 'feed-post-card',
  title: 'Feed Post Card',
  stories: [
    defineGalleryStory({
      id: 'feed-post-card/default',
      title: 'Feed Post Card',
      source: 'cart/app/gallery/components/news-feed/FeedPostCard.tsx',
      status: 'ready',
      tags: ['card', 'social'],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <FeedPostCard post={newsFeedPostMockData[0]} />,
        },
        {
          id: 'reposted',
          name: 'Reposted',
          render: () => <FeedPostCard post={newsFeedPostMockData[2]} />,
        },
      ],
    }),
  ],
});
