// sceneEnv.ts — the scene's RENDER ENVIRONMENT, lowered to data.
//
// USER RULING (req_0308): lighting / sky / camera are NOT hardcoded in the Zig
// loader. They are DATA, packed into the game-file's map shape; the stateless
// loader just accepts them. They will change over time (day/night, weather,
// authored views) — so they ride the same universal pipe as the geometry:
// TypeScript/React-authored values -> encoded data -> loaded into the game.
//
// This module owns the environment's shape + its current default values + the
// binary encoder. The loader (world_loader.zig) reads the lump and builds the
// Scene3D camera/lights/sky from it; with no lump it falls back to a built-in
// copy of these defaults (so the codec fixture still renders).
//
// Wire layout (MAP_LUMP.ENVIRONMENT, encoding 'raw', little-endian):
//   u32 version (=1) | f32[35]
//     [0..3]   ambient:     r, g, b, intensity
//     [4..10]  directional: dx, dy, dz, r, g, b, intensity
//     [11..28] sky:         zenith(3) horizon(3) ground(3) sunDir(3) sunColor(3)
//                           haze cloud night
//     [29..34] camera:      fov, horizFactor, horizBase, heightFactor,
//                           heightBase, farFactor
//   The camera frames the placed structures: the loader centers on their bounds
//   and derives distance/height from (radius * factor + base) — so the framing
//   tracks the world while the ANGLE/FOV/reach stay authored data.

import type { HmscSky } from '../render3d/sky';

export const SCENE_ENV_VERSION = 1;
export const SCENE_ENV_FLOATS = 35;

type Vec3 = [number, number, number];

function hexToRgb(hex: string): Vec3 {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export type SceneEnvironment = {
  ambient: { color: Vec3; intensity: number };
  directional: { dir: Vec3; color: Vec3; intensity: number };
  sky: {
    zenith: Vec3;
    horizon: Vec3;
    ground: Vec3;
    sunDir: Vec3;
    sunColor: Vec3;
    haze: number;
    cloud: number;
    night: number;
  };
  camera: {
    fov: number;
    horizFactor: number;
    horizBase: number;
    heightFactor: number;
    heightBase: number;
    farFactor: number;
  };
};

// The current default daytime environment. These are values, not law — the
// editor will author them over time; tweaking the look means tweaking DATA, not
// the loader.
export const DEFAULT_SCENE_ENVIRONMENT: SceneEnvironment = {
  // White ambient (the /test convention — Scene3D.AmbientLight color="#ffffff")
  // and a directional that points UP TOWARD the sun. The shader does
  // max(dot(N, light_dir), 0) with light_dir = direction-to-light, so the sun
  // vector MUST be positive-up or every top/outward face renders unlit (the dark
  // scene bug). These defaults are the fixture/fallback look; the real bake
  // overrides them with buildHmscSky (sceneEnvironmentFromSky) for /test parity.
  ambient: { color: [1, 1, 1], intensity: 0.48 },
  directional: { dir: [0.4, 0.82, 0.4], color: [1.0, 0.96, 0.85], intensity: 0.95 },
  sky: {
    zenith: [0.12, 0.44, 0.84],
    horizon: [0.74, 0.84, 0.94],
    ground: [0.05, 0.05, 0.06],
    sunDir: [0.4, 0.82, 0.4],
    sunColor: [1.0, 0.96, 0.84],
    haze: 0.42,
    cloud: 0.14,
    night: 0.0,
  },
  camera: {
    fov: 50,
    horizFactor: 1.25,
    horizBase: 8,
    heightFactor: 0.55,
    heightBase: 7,
    farFactor: 3.0,
  },
};

/** Encode the environment as the fixed-layout ENVIRONMENT lump payload. */
export function encodeEnvironmentLump(env: SceneEnvironment = DEFAULT_SCENE_ENVIRONMENT): Uint8Array {
  const out = new Uint8Array(4 + SCENE_ENV_FLOATS * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, SCENE_ENV_VERSION, true);
  const f: number[] = [
    ...env.ambient.color, env.ambient.intensity,
    ...env.directional.dir, ...env.directional.color, env.directional.intensity,
    ...env.sky.zenith, ...env.sky.horizon, ...env.sky.ground,
    ...env.sky.sunDir, ...env.sky.sunColor, env.sky.haze, env.sky.cloud, env.sky.night,
    env.camera.fov, env.camera.horizFactor, env.camera.horizBase,
    env.camera.heightFactor, env.camera.heightBase, env.camera.farFactor,
  ];
  if (f.length !== SCENE_ENV_FLOATS) {
    throw new Error(`sceneEnv: expected ${SCENE_ENV_FLOATS} floats, built ${f.length}`);
  }
  for (let i = 0; i < f.length; i += 1) view.setFloat32(4 + i * 4, f[i], true);
  return out;
}

/** Build the render environment from the SAME sky `/test` renders with
 *  (cart/hmsc/render3d/sky.ts buildHmscSky → Scene3D.AmbientLight/DirectionalLight/
 *  Skybox in GameWorld3D). This is how parity is achieved: the loader's lighting
 *  IS /test's lighting, lowered to data. `sunDir` already points toward the sun
 *  (the shader's direction-to-light convention); ambient is white with the sky's
 *  ambient as intensity, exactly like GameWorld3D. Camera framing is not a sky
 *  property, so it keeps the default. */
export function sceneEnvironmentFromSky(sky: HmscSky): SceneEnvironment {
  return {
    ambient: { color: [1, 1, 1], intensity: sky.ambient },
    directional: { dir: sky.sunDir as Vec3, color: hexToRgb(sky.lightColor), intensity: sky.lightIntensity },
    sky: {
      zenith: hexToRgb(sky.zenith),
      horizon: hexToRgb(sky.horizon),
      ground: hexToRgb(sky.ground),
      sunDir: sky.sunDir as Vec3,
      sunColor: hexToRgb(sky.sunColor),
      haze: sky.haze,
      cloud: sky.cloud,
      night: sky.night,
    },
    camera: { ...DEFAULT_SCENE_ENVIRONMENT.camera },
  };
}
