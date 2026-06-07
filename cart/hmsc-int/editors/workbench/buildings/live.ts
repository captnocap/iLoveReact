// editors/workbench/buildings/live.ts — the BUILDING store's LIVE singleton
// (BUILDSKIN-0606; the paint/live.ts split: store.ts stays P4-bundleable,
// this module touches the editor singletons + the React-side texture
// registry).
//
// Wiring: the source opens its OWN V20 session on the WORLD channel
// ('/workbench' route id) — a building edit is a `prefabDefined` commit, the
// same stream the build route and the game boot read; error captured (the
// census store-unavailable convention; the roster still lists the static
// seeds read-only-ish when the store is down — commits just don't land).
// Materials come from THE texture registry (game/textures): allTextures for
// the picker, textureById for the existence gate — the skin vocabulary IS
// the material system, by construction.

import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { worldStream, type WorldEvent, type WorldStreamState } from '../../../game/world/stream';
import { allTextures, textureById } from '../../../game/textures/registry';
import { createBuildingsStore, type BuildingsStore } from './store';

let live: BuildingsStore | null = null;

export function buildingsWorkbenchStore(): BuildingsStore {
  if (live) return live;
  let session: RouteSession<WorldEvent> | null = null;
  let world: (() => WorldStreamState | null) = () => null;
  let error: string | null = null;
  try {
    const channel = editorChannel(worldStream);
    session = editorSessions().open('/workbench', channel) as RouteSession<WorldEvent>;
    world = () => {
      try { return channel.state(); } catch { return null; }
    };
  } catch (e: any) {
    error = String(e?.message ?? e);
  }
  live = createBuildingsStore({
    world,
    session,
    error,
    validMaterial: (id: string) => textureById(id) !== undefined,
    materials: () => allTextures().map((t) => ({ id: t.id, label: t.label })),
  });
  return live;
}
