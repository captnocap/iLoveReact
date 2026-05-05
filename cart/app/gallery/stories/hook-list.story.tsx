import { defineGallerySection, defineGalleryStory } from '../types';
import { HookList } from '../components/hook-list/HookList';
import { eventHookMockData } from '../data/core/event-hook';

export const hookListSection = defineGallerySection({
  id: "hook-list",
  title: "Hook List",
  group: {
    id: "controls",
    title: "Controls & Cards",
  },
  kind: "atom",
  stories: [
    defineGalleryStory({
      id: "hook-list/default",
      title: "Hook List",
      source: "cart/app/gallery/components/hook-list/HookList.tsx",
      status: 'draft',
      tags: ["card", "table"],
      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <HookList row={eventHookMockData[0]} />,
        },
      ],
    }),
  ],
});
