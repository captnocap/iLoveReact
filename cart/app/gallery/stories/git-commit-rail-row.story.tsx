import { defineGallerySection, defineGalleryStory } from '../types';
import { GitCommitRailRow } from '../components/git-lanes/GitCommitRailRow';
import { gitActivityMockData } from '../data/overstock/git-activity';

export const gitCommitRailRowSection = defineGallerySection({
  id: "git-commit-rail-row",
  title: "Git Commit Rail Row",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "git-commit-rail-row/default",
      title: "Git Commit Rail Row",
      source: "cart/app/gallery/components/git-lanes/GitCommitRailRow.tsx",
      status: 'ready',
      summary: 'Single Git history row atom with SHA, message, worker, age, and diff stat slots.',
      tags: ["card", "table"],
      variants: [
        {
          id: 'selected',
          name: 'Selected',
          render: () => <GitCommitRailRow row={gitActivityMockData[0]} />,
        },
        {
          id: 'alert',
          name: 'Alert',
          render: () => <GitCommitRailRow row={gitActivityMockData[0]} commit={gitActivityMockData[0].commits[1]} />,
        },
        {
          id: 'compact',
          name: 'Compact',
          render: () => <GitCommitRailRow row={gitActivityMockData[1]} commit={gitActivityMockData[1].commits[0]} compact showSwatch />,
        },
      ],
    }),
  ],
});
