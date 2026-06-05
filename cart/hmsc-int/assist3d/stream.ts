// assist3d/stream — the V20 concern for the assistant-authored 3D scene
// (AUTOSAVE-0605: the route persisted to its own side files — scene.json +
// model-history.json — durable, but OFF the chain: no global sequence, no
// undo position, breakable by addition; the shape V20 rules out).
//
// The concern is THE authored scene: 'sceneAuthored' replaces it (the voxels
// precedent — latest authored doc IS the state), so the materialized snapshot
// is always the current scene and every autosave is its own undo position.
// scene.json stays the live rendezvous (disk = truth for the hot surface +
// external editors, unchanged); the stream is the chain's record of it.
// Unknown kinds pass through (V20 addition).

import type { StreamDef } from '../data';
import type { SceneSpec } from './scene';

export type Assist3dStreamState = {
  /** the authored scene — null until the first authored event */
  scene: SceneSpec | null;
};

export type Assist3dEvent = { kind: 'sceneAuthored'; scene: SceneSpec };

export const assist3dStream: StreamDef<Assist3dStreamState, Assist3dEvent> = Object.freeze({
  name: 'assist3d',
  initial: (): Assist3dStreamState => ({ scene: null }),
  apply: (state: Assist3dStreamState, event: Assist3dEvent): Assist3dStreamState => {
    switch (event?.kind) {
      case 'sceneAuthored':
        return { scene: event.scene };
      default:
        // Unknown kinds are future additions — old materializers skip them.
        return state;
    }
  },
});
