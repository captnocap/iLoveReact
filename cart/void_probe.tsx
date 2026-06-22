// void_probe.tsx — PLATFORM-SIDE render probe for the Skybox void shell (req_1655).
// Mounts ONLY <VoidShell> in a minimal Scene3D with the camera parked at the
// authored map's edge, looking OUT into the void — the view the player gets when
// they "walk to the end." This is the headless self-shot proof the heavy editor
// can't give (it OOMs the boot watchdog). Not a game cart; do not add to docs/game.

import { Box } from '@reactjit/primitives';
import { Scene3D } from '@reactjit/primitives';
import { VoidShell } from './hmsc-int/render3d/VoidShell';
import type { WorldCore } from './hmsc-int/game/void/distance';

// A small authored rectangle [0,200] x [0,200]; the void fills everything outside.
const CORE: WorldCore = { minX: 0, minZ: 0, maxX: 200, maxZ: 200, centerX: 100, centerZ: 100 };
// Player standing AT the +x edge, looking out into the procedural sprawl.
const PLAYER_X = 200;
const PLAYER_Z = 100;
const DRAW_RADIUS = 600;

export default function VoidProbe() {
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#5a93cf" showAxes={false}>
        {/* Eye just inside the edge, looking out along +x and slightly down. */}
        <Scene3D.Camera position={[PLAYER_X - 30, 26, PLAYER_Z]} target={[PLAYER_X + 320, 0, PLAYER_Z]} fov={62} far={DRAW_RADIUS} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.8} />
        <Scene3D.DirectionalLight direction={[0.4, 0.82, 0.4]} color="#fff6e0" intensity={0.85} />
        <VoidShell playerX={PLAYER_X} playerZ={PLAYER_Z} core={CORE} drawRadiusMeters={DRAW_RADIUS} />
      </Scene3D>
    </Box>
  );
}
