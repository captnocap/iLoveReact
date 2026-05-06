import { defineGallerySection, defineGalleryStory, type GalleryVariant } from '../types';
import {
  BlockFaces,
  StaticFace,
  blockFacesArchetypes,
} from '../components/block-faces/BlockFaces';
import { workerMockData } from '../data/core/worker';
import type { Worker } from '../data/core/worker';
import { ChartAnimationProvider } from '../lib/useSpring';

function makeWorker(overrides: Partial<Worker>): Worker {
  return {
    id: 'mock_worker',
    userId: 'user_local',
    workspaceId: 'ws_reactjit',
    settingsId: 'settings_default',
    label: 'Mock',
    kind: 'primary',
    lifecycle: 'active',
    connectionId: 'conn_claude_cli',
    modelId: 'claude-opus-4-7',
    maxConcurrentRequests: 1,
    spawnedAt: '2026-04-28T13:03:00Z',
    ...overrides,
  };
}

// Animation is force-disabled across every variant for now — running multiple
// live face grids in one view chews CPU. Re-enable once we have a sane stagger
// / off-screen pause story.
function staticVariant(id: string, name: string, render: () => any): GalleryVariant {
  return {
    id,
    name,
    render: () => <ChartAnimationProvider disabled>{render()}</ChartAnimationProvider>,
  };
}

const tileVariants: GalleryVariant[] = [
  staticVariant('tile-active', 'Tile · streaming subagent', () => <BlockFaces row={workerMockData[1]} />),
  staticVariant('tile-supervisor', 'Tile · supervisor', () => <BlockFaces row={workerMockData[0]} />),
  staticVariant('tile-idle', 'Tile · idle reviewer', () => <BlockFaces row={workerMockData[3]} />),
  staticVariant('tile-portrait', 'Tile · portrait layout', () =>
    <BlockFaces row={makeWorker({ id: 'portrait-frank', label: 'frank', lifecycle: 'streaming' })} layout="portrait" scale={6} />
  ),
];

const archetypeVariants: GalleryVariant[] = blockFacesArchetypes.map((arch) =>
  staticVariant(`archetype-${arch}`, `Archetype · ${arch}`, () => <StaticFace archetype={arch} scale={8} seed={arch} />)
);

export const blockFacesSection = defineGallerySection({
  id: 'block-faces',
  title: 'Block Faces',
  group: {
    id: 'controls',
    title: 'Controls & Cards',
  },
  kind: 'atom',
  stories: [
    defineGalleryStory({
      id: 'block-faces',
      title: 'Block Faces',
      source: 'cart/app/gallery/components/block-faces/BlockFaces.tsx',
      status: 'ready',
      summary: 'Worker tile and per-archetype face. Animations paused. Showcases (frame atlases, scale rows, variation grids, lifecycle schedules, generators) deferred until we can stagger their mounts.',
      tags: ['card', 'motion'],
      variants: [...tileVariants, ...archetypeVariants],
    }),
  ],
});
