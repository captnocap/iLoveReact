import { defineGallerySection, defineGalleryStory } from '../types';
import { ConstraintBadge } from '../components/constraint-badge/ConstraintBadge';
import { constraintMockData } from '../data/core/constraint';

export const constraintBadgeSection = defineGallerySection({
  id: "constraint-badge",
  title: "Constraint Badge",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "constraint-badge/default",
      title: "Constraint Badge",
      source: "cart/app/gallery/components/constraint-badge/ConstraintBadge.tsx",
      status: 'draft',
      tags: ["badge", "card"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <ConstraintBadge row={constraintMockData[0]} />,
        },
      ],
    }),
  ],
});
