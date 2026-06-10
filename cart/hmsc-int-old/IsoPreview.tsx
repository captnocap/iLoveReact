// The iso-3D preview pane: a live 3D view of the STAGED world, drawn by the
// game's own renderer. The user paints/places in the 2D top-down map (left);
// this shows what the game will actually render before compile — "paint in 2D,
// preview in iso-3D, compile to the boot world."
//
// It reuses cart/hmsc's WorldStatics (the exact floors/roads/props/buildings/
// facades/landforms the game draws) under an Isometric camera from
// @reactjit/cameras, and mounts the SAME TileSurfaceCaptures so floor meshes get
// their tile-grid textures (without the captures the floors read as untextured
// void — see render3d/tileSurface.tsx). No fork of the renderer, so the preview
// can never drift from the game.

import { memo } from 'react';
import { Box, Scene3D } from '@reactjit/primitives';
import { IsometricCamera } from '@reactjit/cameras';
import type { GameState } from '../hmsc-int/design';
import { WorldStatics } from '../hmsc-int/render3d/GameWorld3D';
import { TileSurfaceCaptures } from '../hmsc-int/render3d/tileSurface';
import { buildHmscSky } from '../hmsc-int/render3d/sky';

// Where the iso camera looks + how far out it orbits. Centre defaults to the
// world middle; the caller drives target/yaw/dist so the preview can follow the
// 2D map's pan/zoom and rotate to inspect facades.
export type IsoView = {
  centerX: number;
  centerZ: number;
  yawDegrees: number;
  distMeters: number;
};

function skyClearColor(state: GameState): string {
  const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
  return sky.horizon;
}

export const IsoPreview = memo(function IsoPreview(props: { state: GameState; view: IsoView }) {
  const { state, view } = props;
  const world = state.world;
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Floor tile-grid textures: offscreen captures keyed by region id, mounted
          as a 2D sibling of <Scene3D> (the billboard_demo pattern). Each FloorMesh
          in WorldStatics samples floorTextureKey(region.id). */}
      <TileSurfaceCaptures regions={world.surfaceRegions} />
      <Scene3D
        style={{ width: '100%', height: '100%' }}
        backgroundColor={skyClearColor(state)}
        showGrid={false}
        showAxes={false}
      >
        <IsometricCamera
          target={[view.centerX, 0, view.centerZ]}
          yaw={view.yawDegrees}
          dist={view.distMeters}
          fov={28}
        />
        <WorldStatics world={world} skyConfig={state.config.sky} />
      </Scene3D>
    </Box>
  );
});
