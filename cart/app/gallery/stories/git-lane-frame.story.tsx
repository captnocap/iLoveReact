import { defineGallerySection, defineGalleryStory } from '../types';
import { GitLaneFrame } from '../components/git-lanes/GitLaneFrame';
import { gitActivityMockData } from '../data/overstock/git-activity';

export const gitLaneFrameSection = defineGallerySection({
  id: "git-lane-frame",
  title: "Git Lane Frame",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "git-lane-frame/default",
      title: "Git Lane Frame",
      source: "cart/app/gallery/components/git-lanes/GitLaneFrame.tsx",
      status: 'ready',
      summary: 'Reusable terminal frame atom with topbar, live indicator, search fallback, and keyboard hint footer.',
      tags: ["card", "panel"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <GitLaneFrame row={gitActivityMockData[0]} width={420} height={170} />,
        },
      ],
    }),
  ],
});
