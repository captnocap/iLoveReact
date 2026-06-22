// render3d/skyDrift.ts — the seam-1 void consumer: warp the sky by skyDrift.
//
// SKYBOX_PLAYBOOK seam 1 names sky-drift the FIRST visible distortion because it
// is the cheapest — it rides the sceneEnv/HmscSky floats that already exist
// (haze/cloud/night + the gradient colors). This is DRIFT, not new rendering:
// the same analytic skybox, fed numbers nudged toward "the world is thinning."
//
// Pure function. Input is the built HmscSky and the skyDrift weight (0 honest →
// 1 fully corrupted) from voidDistortion(); output is a new HmscSky. With
// skyDrift 0 it returns the sky unchanged, so inside the believable core the look
// is exactly what it was.

import type { HmscSky } from './sky';

// Sickly, desaturated targets the sky bleeds toward as escape_depth climbs — a
// washed-out grey-green wrongness, not a storm. Picked to read as "the simulation
// is running out of texture out here," per playbook §2.
const VOID_ZENITH = '#3b4147';
const VOID_HORIZON = '#565a59';
const VOID_GROUND = '#1c1e1d';
const VOID_SUN = '#a7b291';

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb: Rgb): string {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`;
}

function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
  ]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Warp the sky by skyDrift in [0,1]. Hue bleeds toward the sickly void palette;
// haze/cloud climb (depth and detail wash out); the sun loses its disc and color;
// light flattens. Identity at d=0.
export function driftSky(sky: HmscSky, skyDrift: number): HmscSky {
  const d = skyDrift <= 0 ? 0 : skyDrift >= 1 ? 1 : skyDrift;
  if (d === 0) return sky;
  return {
    ...sky,
    zenith: mixHex(sky.zenith, VOID_ZENITH, d),
    horizon: mixHex(sky.horizon, VOID_HORIZON, d),
    ground: mixHex(sky.ground, VOID_GROUND, d * 0.7),
    sunColor: mixHex(sky.sunColor, VOID_SUN, d),
    lightColor: mixHex(sky.lightColor, VOID_SUN, d * 0.8),
    // Detail and depth wash out: haze and cloud rise toward a flat ceiling.
    haze: lerp(sky.haze, 0.92, d),
    cloud: lerp(sky.cloud, 0.72, d * 0.85),
    // A wrongness dim, not nightfall — drain some daylight without going black.
    night: lerp(sky.night, Math.min(1, sky.night + 0.32), d),
    // The sun stops being a sun: disc shrinks, glow flattens, light goes ambient.
    sunSize: lerp(sky.sunSize, sky.sunSize * 0.4, d),
    sunGlow: lerp(sky.sunGlow, sky.sunGlow * 0.35, d),
    ambient: lerp(sky.ambient, sky.ambient * 0.82, d),
    lightIntensity: lerp(sky.lightIntensity, sky.lightIntensity * 0.55, d),
  };
}
