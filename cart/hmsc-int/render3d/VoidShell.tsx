import { memo, useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { buildShellBatch, SHELL_CHUNK_METERS } from '../game/void/shell';
import type { WorldCore } from '../game/void/distance';

// VoidShell — the procedural shell rendered as ONE instanced batch around the
// player. SKYBOX_PLAYBOOK §6: the endless hash-city wraps the authored core as
// the outer ring of the SAME map, streamed by a radius window.
//
// Unlike WorldStatics (memoized on `world`, frozen across movement), the shell
// MOVES WITH the player — but rebuilding 13×13 chunks every step would re-ship a
// big float buffer per frame. So it is memoized on the player's CHUNK cell: it
// only re-rolls when the player crosses a 160 m chunk boundary, not every meter.
// Inside a chunk the same batch identity is reused and nothing re-ships. This is
// the lab's streaming-around-a-focus pattern, keyed on chunk coords.

// The streaming window is sized to the camera's DRAW RADIUS: the host culls any
// geometry past drawRadiusMeters (default 140 m, up to 4 km), so generating more
// than that is invisible waste, and generating LESS leaves a bald horizon. One
// chunk of margin past the draw edge keeps the seam off-screen. Capped so an
// extreme draw radius can't blow up the per-crossing rebuild.
const MAX_SHELL_RADIUS_CHUNKS = 26;
function shellRadiusChunks(drawRadiusMeters: number): number {
  const chunks = Math.ceil(Math.max(0, drawRadiusMeters) / SHELL_CHUNK_METERS) + 1;
  return Math.max(2, Math.min(MAX_SHELL_RADIUS_CHUNKS, chunks));
}

export const VoidShell = memo(function VoidShell(props: {
  playerX: number;
  playerZ: number;
  core: WorldCore;
  drawRadiusMeters: number;
}) {
  const chunkX = Math.floor(props.playerX / SHELL_CHUNK_METERS);
  const chunkZ = Math.floor(props.playerZ / SHELL_CHUNK_METERS);
  const core = props.core;
  const radiusChunks = shellRadiusChunks(props.drawRadiusMeters);
  // Re-roll only on chunk crossing / core / draw-radius change. Build at the
  // chunk CENTER so the streamed window is stable within a chunk (the batch
  // doesn't shift with sub-chunk player motion — only the camera does).
  const batch = useMemo(() => {
    const focusX = chunkX * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
    const focusZ = chunkZ * SHELL_CHUNK_METERS + SHELL_CHUNK_METERS / 2;
    return buildShellBatch(focusX, focusZ, core, radiusChunks);
  }, [chunkX, chunkZ, radiusChunks, core.minX, core.minZ, core.maxX, core.maxZ]);

  if (batch.count === 0) return null;
  // One unit box, scaled per-instance — every chunk's buildings/ground share ONE
  // interned geometry; size lives in the stride-9 stream (memory geometry_intern).
  return (
    <Scene3D.Instances
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      data={batch.data}
      count={batch.count}
      stride={9}
      center={batch.center}
      boundsRadius={batch.radius}
    />
  );
});
