import { defineGallerySection, defineGalleryStory } from '../types';
import { WorkerCard } from '../components/worker-card/WorkerCard';
import { workerMockData } from '../data/core/worker';

export const workerCardSection = defineGallerySection({
  id: "worker-card",
  title: "Worker Card",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "worker-card/default",
      title: "Worker Card",
      source: "cart/app/gallery/components/worker-card/WorkerCard.tsx",
      status: 'draft',
      tags: ["card", "data"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <WorkerCard row={workerMockData[0]} />,
        },
      ],
    }),
  ],
});
