import { defineGallerySection, defineGalleryStory } from '../types';
import { TaskCard } from '../components/task-card/TaskCard';
import { taskMockData } from '../data/overstock/task';

export const taskCardSection = defineGallerySection({
  id: "task-card",
  title: "Task Card",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "task-card/default",
      title: "Task Card",
      source: "cart/app/gallery/components/task-card/TaskCard.tsx",
      status: 'draft',
      tags: ["card"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <TaskCard row={taskMockData[0]} />,
        },
      ],
    }),
  ],
});
