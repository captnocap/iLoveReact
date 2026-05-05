import { defineGallerySection, defineGalleryStory } from '../types';
import { GitLaneGraph } from '../components/git-lanes/GitLaneGraph';
import { gitActivityMockData } from '../data/overstock/git-activity';

export const gitLaneGraphSection = defineGallerySection({
  id: "git-lane-graph",
  title: "Git Lane Graph",
  group: {
    id: "charts",
    title: "Charts & Graphs",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "git-lane-graph/default",
      title: "Git Lane Graph",
      source: "cart/app/gallery/components/git-lanes/GitLaneGraph.tsx",
      status: 'ready',
      summary: 'Static Git lane graph atom built from Graph.Path segments and commit points.',
      tags: ["chart", "graph"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <GitLaneGraph row={gitActivityMockData[2]} width={120} />,
        },
      ],
    }),
  ],
});
