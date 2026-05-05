import { defineGallerySection, defineGalleryStory } from '../types';
import { GoalCard } from '../components/goal-card/GoalCard';
import { goalMockData } from '../data/core/goal';

export const goalCardSection = defineGallerySection({
  id: "goal-card",
  title: "Goal Card",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "goal-card/default",
      title: "Goal Card",
      source: "cart/app/gallery/components/goal-card/GoalCard.tsx",
      status: 'draft',
      tags: ["card"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <GoalCard row={goalMockData[0]} />,
        },
      ],
    }),
  ],
});
