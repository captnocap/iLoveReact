import { defineGallerySection, defineGalleryStory } from '../types';
import {
  BinaryClock,
  SecondLoom,
  TimeRibbons,
  WordClock,
} from '../components/time-instruments/TimeInstruments';

// Each clock is its own component, its own gallery entry. The old
// TimeInstrumentDeck lumped them together with extra nesting; that's gone.

export const binaryClockSection = defineGallerySection({
  id: 'binary-clock',
  title: 'Binary Clock',
  stories: [
    defineGalleryStory({
      id: 'binary-clock/default',
      title: 'Binary Clock',
      source: 'cart/app/gallery/components/time-instruments/TimeInstruments.tsx',
      status: 'ready',
      summary: 'Binary-coded decimal HH:MM:SS using existing classifier atoms.',
      tags: ['time', 'clock', 'binary', 'motion', 'atom'],
      variants: [
        { id: 'default', name: 'Default', render: () => <BinaryClock /> },
      ],
    }),
  ],
});

export const timeRibbonsSection = defineGallerySection({
  id: 'time-ribbons',
  title: 'Time Ribbons',
  stories: [
    defineGalleryStory({
      id: 'time-ribbons/default',
      title: 'Time Ribbons',
      source: 'cart/app/gallery/components/time-instruments/TimeInstruments.tsx',
      status: 'ready',
      summary: 'Day, week, and year progress as live rails.',
      tags: ['time', 'clock', 'progress', 'motion', 'atom'],
      variants: [
        { id: 'default', name: 'Default', render: () => <TimeRibbons /> },
      ],
    }),
  ],
});

export const wordClockSection = defineGallerySection({
  id: 'word-clock',
  title: 'Word Clock',
  stories: [
    defineGalleryStory({
      id: 'word-clock/default',
      title: 'Word Clock',
      source: 'cart/app/gallery/components/time-instruments/TimeInstruments.tsx',
      status: 'ready',
      summary: 'Local time rounded to the nearest five-minute phrase.',
      tags: ['time', 'clock', 'word', 'motion', 'atom'],
      variants: [
        { id: 'default', name: 'Default', render: () => <WordClock /> },
      ],
    }),
  ],
});

export const secondLoomSection = defineGallerySection({
  id: 'second-loom',
  title: 'Second Loom',
  stories: [
    defineGalleryStory({
      id: 'second-loom/default',
      title: 'Second Loom',
      source: 'cart/app/gallery/components/time-instruments/TimeInstruments.tsx',
      status: 'ready',
      summary: 'A sixty-cell second sweep with a short decaying trail.',
      tags: ['time', 'clock', 'motion', 'atom'],
      variants: [
        { id: 'default', name: 'Default', render: () => <SecondLoom /> },
      ],
    }),
  ],
});
