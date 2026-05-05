import { defineGallerySection, defineGalleryStory } from '../types';
import { Box } from '@reactjit/runtime/primitives';
import { NewsFeed } from '../components/news-feed/NewsFeed';
import { newsFeedPostMockData } from '../data/overstock/news-feed-post';

export const newsFeedSection = defineGallerySection({
  id: "news-feed",
  title: "News Feed",
  group: {
    id: "compositions",
    title: "Compositions",
  },
  kind: "top-level",
  composedOf: [
    "cart/app/gallery/components/news-feed/FeedComposer.tsx",
    "cart/app/gallery/components/news-feed/FeedPostCard.tsx",
    "cart/app/gallery/components/news-feed/FeedActionButton.tsx",
  ],
  stories: [
    defineGalleryStory({
      id: "news-feed/default",
      title: "News Feed",
      source: "cart/app/gallery/components/news-feed/NewsFeed.tsx",
      status: 'draft',
      tags: ["input", "card", "panel"],
      variants: [
        {
          id: 'default',
          name: 'Desktop Feed',
          render: () => (
            <Box style={{ width: 760, height: 560 }}>
              <NewsFeed rows={newsFeedPostMockData} />
            </Box>
          ),
        },
        {
          id: 'compact',
          name: 'Compact Feed',
          render: () => (
            <Box style={{ width: 390, height: 560 }}>
              <NewsFeed rows={newsFeedPostMockData} />
            </Box>
          ),
        },
      ],
    }),
  ],
});
