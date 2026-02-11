import type { ComponentType } from 'react';
import { CardStory } from './Card/Card.story';
import { BadgeStory } from './Badge/Badge.story';
import { DividerStory } from './Divider/Divider.story';
import { FlexRowStory } from './FlexRow/FlexRow.story';
import { FlexColumnStory } from './FlexColumn/FlexColumn.story';
import { SpacerStory } from './Spacer/Spacer.story';

export interface StoryDef {
  id: string;
  title: string;
  category: string;
  component: ComponentType;
}

export const stories: StoryDef[] = [
  { id: 'card', title: 'Card', category: 'Addon', component: CardStory },
  { id: 'badge', title: 'Badge', category: 'Addon', component: BadgeStory },
  { id: 'divider', title: 'Divider', category: 'Addon', component: DividerStory },
  { id: 'flex-row-addon', title: 'FlexRow', category: 'Addon', component: FlexRowStory },
  { id: 'flex-column-addon', title: 'FlexColumn', category: 'Addon', component: FlexColumnStory },
  { id: 'spacer', title: 'Spacer', category: 'Addon', component: SpacerStory },
];
