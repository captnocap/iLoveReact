// BlockFace3D — texture-mapped voxel face on a real 3D sphere.
//
// Reads a 16×16 BlockFaces frame, builds an RGBA pixel buffer (with a
// skin-tone fill replacing the transparent edges), and renders ONE
// <Scene3D.Mesh geometry="sphere"> with that buffer as a diffuse texture.
//
// The wgpu pipeline (framework/gpu/3d.zig + shaders.zig) projects the
// texture via planar UV onto the +Z hemisphere of the sphere, so the
// face reads as a flat decal stuck to the front of the head with the
// sphere's curvature visible at the silhouette. The back hemisphere
// mirrors the front; back faces are culled by default and only become
// visible when the camera orbits behind, which is acceptable for a
// front-facing avatar.
//
// Why this works without the voxel approach: every sphere now samples
// a per-mesh texture (default 1×1 white when none is provided), so
// passing pixels turns the sphere into a real textured surface — the
// same architecture love2d had with mesh:setTexture(image).

import { useMemo } from 'react';
import { Scene3D } from '@reactjit/runtime/primitives';
import {
  variantSpec,
  type ArchetypeKey,
} from './BlockFaces';

export type BlockFace3DProps = {
  /** World-space sphere center the face wraps onto. */
  center: [number, number, number];
  /** Sphere radius. */
  radius: number;
  /** Archetype + seed pick the frames + variant palette. */
  archetype: ArchetypeKey;
  seed?: string;
  /** Frame name from the archetype's FrameMap. Defaults to 'idle'. */
  frame?: string;
  /**
   * Hex fill (RRGGBB or RRGGBBAA) for transparent cells in the BlockFace
   * frame. Defaults to a skin tone matching the variant palette so the
   * sphere reads as a head with a face on it, not a face floating in
   * void.
   */
  skinHex?: string;

  // Voxel-era props kept as no-op for callers that still pass them.
  // The texture-mapped path doesn't need angular wrapping or grout.
  yawHalfDeg?: number;
  pitchHalfDeg?: number;
  gap?: number;
  thickness?: number;
};

const SIZE = 16;

const PAL_HEX: Record<string, string> = {
  s: '#cc9866', S: '#9a6638', L: '#e0b288',
  h: '#2a1810', H: '#4a2a1a',
  w: '#ffffff', W: '#ffffff', O: '#ffffff',
  i: '#3a78c8', I: '#3aaa78',
  p: '#0a0a0a',
  m: '#cc6644', M: '#aa4422',
  k: '#222222', K: '#101010',
  g: '#666666', G: '#888888',
  r: '#cc3322', o: '#cc8833', y: '#ddcc44',
  c: '#33cc88', b: '#3a78c8', l: '#aa66cc',
  z: '#9a6638', Z: '#5a3826',
  v: '#7a5a3a', q: '#cc3322', Q: '#aa4422',
  e: '#7a5a3a', E: '#5a3a22',
  x: '#0a0a0a', X: '#222222',
  a: '#9a6638', A: '#7a4a2a',
  n: '#5a3826', N: '#3a221a',
  d: '#9a6638', D: '#5a3826',
  u: '#7a5a3a', U: '#9a6638',
  t: '#9a6638', T: '#5a3826',
  f: '#9a6638', F: '#5a3826',
  j: '#ddcc44', J: '#bbaa33',
  P: '#7a5a3a', V: '#5a3826',
  C: '#9a6638', B: '#9a6638',
  Y: '#7a5a3a', R: '#5a3826',
};

const THEME_HEX_FALLBACK: Record<string, string> = {
  'theme:inkDim': '#7a5a3a',
  'theme:paperInkDim': '#9a6638',
  'theme:paper': '#e0b288',
  'theme:inkGhost': '#5a3826',
  'theme:rule': '#3a221a',
  'theme:bg2': '#101010',
  'theme:paperRuleBright': '#bb8855',
  'theme:accent': '#cc8833',
  'theme:warn': '#ddcc44',
  'theme:flag': '#cc3322',
  'theme:inkDimmer': '#5a4a3a',
  'theme:ink': '#ffffff',
  'theme:bg': '#0a0a0a',
  'theme:blue': '#3a78c8',
  'theme:ok': '#3aaa78',
  'theme:lilac': '#aa66cc',
  'theme:transparent': '',
};

function resolveHex(token: string | undefined, fallback: string): string {
  if (!token) return fallback;
  if (token.startsWith('#')) return token;
  if (token.startsWith('theme:')) return THEME_HEX_FALLBACK[token] ?? fallback;
  return fallback;
}

function normalizeHex(input: string, fallback: string): string {
  let s = input || fallback;
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s = s + 'ff';
  if (s.length !== 8) return fallback;
  return s;
}

function buildTextureHex(
  frameRows: string[],
  palette: Record<string, string>,
  skinHex: string,
): string {
  const skin = normalizeHex(skinHex, 'cc9866ff');
  let out = '';
  for (let gy = 0; gy < SIZE; gy++) {
    const row = frameRows[gy] || '';
    for (let gx = 0; gx < SIZE; gx++) {
      const ch = row[gx] || '.';
      if (ch === '.' || ch === ' ') {
        out += skin;
        continue;
      }
      const variantToken = palette[ch];
      const fallbackHex = PAL_HEX[ch] ?? '#888888';
      const resolved = resolveHex(variantToken, fallbackHex);
      out += normalizeHex(resolved, 'cc9866ff');
    }
  }
  return out;
}

export function BlockFace3D({
  center,
  radius,
  archetype,
  seed,
  frame = 'idle',
  skinHex = '#cc9866',
}: BlockFace3DProps): any {
  const spec = useMemo(() => variantSpec(archetype, seed), [archetype, seed]);
  const frameRows = spec.frames[frame] ?? spec.frames.idle ?? [];
  const texHex = useMemo(
    () => buildTextureHex(frameRows, spec.palette, skinHex),
    [frameRows, spec.palette, skinHex]
  );

  // Sit 5% outside the underlying head sphere so it definitively wins
  // the depth test on every front-facing pixel — 1.005x was too tight
  // and let the inner head leak through at the front center.
  const surfaceR = radius * 1.05;
  return (
    <Scene3D.Mesh
      geometry="sphere"
      position={center}
      radius={surfaceR}
      // White material so the texture shows true colors. Set a tint
      // here (e.g. "#ff8866") to color-shift the whole face for moods.
      material="#ffffff"
      texture={{ width: SIZE, height: SIZE, hex: texHex }}
    />
  );
}
