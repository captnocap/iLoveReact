import { defineGallerySection, defineGalleryStory } from '../types';
import { GitLanes } from '../components/git-lanes/GitLanes';
import { gitActivityMockData } from '../data/overstock/git-activity';

export const gitLanesSection = defineGallerySection({
  id: "git-lanes",
  title: "Git Lanes",
  group: {
    id: "compositions",
    title: "Compositions",
  },
  kind: "top-level",
  composedOf: [
    "cart/app/gallery/components/git-lanes/GitLaneFrame.tsx",
    "cart/app/gallery/components/git-lanes/GitLaneGraph.tsx",
    "cart/app/gallery/components/git-lanes/GitCommitRailRow.tsx",
    "cart/app/gallery/components/git-lanes/GitDiffPreview.tsx",
  ],
  stories: [
    defineGalleryStory({
      id: "git-lanes/default",
      title: "Git Lanes",
      source: "cart/app/gallery/components/git-lanes/GitLanes.tsx",
      status: 'ready',
      summary: 'Retro terminal Git activity browser with lane graph, compact history rows, live chrome, keyboard footer, and diff preview.',
      tags: ["panel", "graph", "table"],
      variants: [
        {
          id: 'lanes-detail',
          name: 'Lanes + Detail',
          render: () => <GitLanes row={gitActivityMockData[0]} />,
        },
        {
          id: 'compact-list',
          name: 'Compact List',
          render: () => <GitLanes row={gitActivityMockData[1]} />,
        },
        {
          id: 'graph-list',
          name: 'Graph List',
          render: () => <GitLanes row={gitActivityMockData[2]} />,
        },
      ],
    }),
  ],
});
