import { defineGalleryDataStory, defineGallerySection } from '../types';
import { newsFeedPostMockData, newsFeedPostReferences, newsFeedPostSchema } from '../data/overstock/news-feed-post';

export const newsFeedPostSection = defineGallerySection({
  id: "news-feed-post",
  title: "News Feed Post",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "news-feed-post/catalog",
      title: "News Feed Post",
      source: "cart/app/gallery/data/news-feed-post.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: newsFeedPostReferences,
      schema: newsFeedPostSchema,
      mockData: newsFeedPostMockData,
    }),
  ],
});
