import { defineGallerySection, defineGalleryStory } from '../types';
import { RubricPanel } from '../components/rubric-panel/RubricPanel';
import { outcomeRubricMockData } from '../data/composition/outcome-rubric';

export const rubricPanelSection = defineGallerySection({
  id: "rubric-panel",
  title: "Rubric Panel",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "rubric-panel/default",
      title: "Rubric Panel",
      source: "cart/app/gallery/components/rubric-panel/RubricPanel.tsx",
      status: 'draft',
      tags: ["card", "panel"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <RubricPanel row={outcomeRubricMockData[0]} />,
        },
      ],
    }),
  ],
});
