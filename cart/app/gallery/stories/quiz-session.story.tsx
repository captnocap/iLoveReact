import { defineGalleryDataStory, defineGallerySection } from '../types';
import {
  quizSessionMockData,
  quizSessionReferences,
  quizSessionSchema,
} from '../data/overstock/quiz-session';

export const quizSessionSection = defineGallerySection({
  id: 'quiz-session',
  title: 'Quiz session',
  group: { id: 'data-shapes', title: 'Data Shapes' },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: 'quiz-session/catalog',
      title: 'Quiz session',
      source: 'cart/app/gallery/data/quiz-session.ts',
      format: 'data',
      status: 'draft',
      tags: ['quiz', 'manifest', 'chat-loom'],
      storage: ['localstore'],
      references: quizSessionReferences,
      schema: quizSessionSchema,
      mockData: quizSessionMockData,
    }),
  ],
});
