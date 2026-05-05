import { defineGallerySection, defineGalleryStory } from '../types';
import { GitDiffPreview } from '../components/git-lanes/GitDiffPreview';
import { gitActivityMockData } from '../data/overstock/git-activity';

export const gitDiffPreviewSection = defineGallerySection({
  id: "git-diff-preview",
  title: "Git Diff Preview",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "git-diff-preview/default",
      title: "Git Diff Preview",
      source: "cart/app/gallery/components/git-lanes/GitDiffPreview.tsx",
      status: 'ready',
      summary: 'Diff preview atom with selected commit header, changed files, and hunk/add/remove code lines.',
      tags: ["card", "panel"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <GitDiffPreview row={gitActivityMockData[0]} />,
        },
      ],
    }),
  ],
});
