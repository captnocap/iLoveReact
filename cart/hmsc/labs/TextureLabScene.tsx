import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { HMSC_TILE_TEXTURE_KEYS } from '../world/tileTextureKeys';

const PANEL_SIZE_METERS = 1.15;
const PANEL_THICKNESS_METERS = 0.05;
const LAB_ORIGIN_X = 3.5;
const LAB_ORIGIN_Z = -4.2;
const PANEL_Y_METERS = 0.82;

const TEXTURE_PANELS = [
  { key: HMSC_TILE_TEXTURE_KEYS.water, x: 0, z: 0 },
  { key: HMSC_TILE_TEXTURE_KEYS.road, x: 1.35, z: 0 },
  { key: HMSC_TILE_TEXTURE_KEYS.asphalt, x: 2.7, z: 0 },
  { key: HMSC_TILE_TEXTURE_KEYS.sidewalk, x: 4.05, z: 0 },
  { key: HMSC_TILE_TEXTURE_KEYS.mud, x: 0, z: 1.35 },
  { key: HMSC_TILE_TEXTURE_KEYS.sand, x: 1.35, z: 1.35 },
  { key: HMSC_TILE_TEXTURE_KEYS.wall, x: 2.7, z: 1.35 },
  { key: HMSC_TILE_TEXTURE_KEYS.door, x: 4.05, z: 1.35 },
  { key: HMSC_TILE_TEXTURE_KEYS.marker, x: 0, z: 2.7 },
];

export function TextureLabScene() {
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 6.6, height: 0.035, depth: 5.05 }}
        material="#0d1626"
        position={[LAB_ORIGIN_X + 2.05, -0.018, LAB_ORIGIN_Z + 1.36]}
      />
      {TEXTURE_PANELS.map((panel) => (
        <Scene3D.Mesh
          key={panel.key}
          geometry={Geometry.Box}
          params={{ width: PANEL_SIZE_METERS, height: PANEL_SIZE_METERS, depth: PANEL_THICKNESS_METERS }}
          material="#ffffff"
          textureKey={panel.key}
          position={[LAB_ORIGIN_X + panel.x, PANEL_Y_METERS, LAB_ORIGIN_Z + panel.z]}
          rotation={[-18, 0, 0]}
        />
      ))}
    </>
  );
}
