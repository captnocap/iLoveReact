// game/textures/neon — turn an SVG path into a NEON DECAL (req_0893, ask #2).
//
// The "SVG → business LED sign" core, as a pure function: given a path `d`
// string (pasted from a logo, or emitted by a future pen tool), build a DecalDoc
// holding one glowing DecalPathNode. Saved through saveDecalTexture it becomes a
// library material; skin a neonLogo / neonLogoDouble panel face with it and the
// glow bakes into the world (decalRender.NeonPathView lowers it everywhere).
//
// Data only (the decal.ts law: no React imports).

import { DECAL_DOC_VERSION, type DecalDoc, type DecalPathNode } from './decal';

export type NeonOptions = {
  /** canvas size; defaults to a square fit auto-sized from the path coords */
  width?: number;
  height?: number;
  /** the lit tube color (the neon core) */
  stroke?: string;
  /** core tube width in px */
  strokeWidth?: number;
  /** glow halo color (defaults to the stroke) */
  glow?: string;
  glowWidth?: number;
  glowOpacity?: number;
  /** optional filled interior behind the tube */
  fill?: string;
  /** canvas backing — neon reads against near-black; '' = transparent */
  bg?: string;
};

// A logo's viewBox is unknown when only the `d` is pasted, so size the canvas to
// the path's own coordinate range (the largest absolute number in `d`). Most
// logos use a `viewBox 0 0 N N`, so the path fills the canvas; coords map 1:1 at
// bake (decalRender uses viewZoom = sx, sx=1 at native size). Clamped to a sane
// texture range. Caller can override with an explicit width/height (a real viewBox).
export function autoSizeFromPath(d: string): number {
  let max = 0;
  const re = /-?\d*\.?\d+(?:e-?\d+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const v = Math.abs(Number(m[0]));
    if (Number.isFinite(v) && v > max) max = v;
  }
  if (max <= 0) return 512;
  return Math.max(16, Math.min(4096, Math.ceil(max)));
}

export function neonDecalDoc(d: string, opts: NeonOptions = {}): DecalDoc {
  const size = autoSizeFromPath(d);
  const width = opts.width ?? size;
  const height = opts.height ?? size;
  const node: DecalPathNode = {
    id: 'neon',
    kind: 'path',
    x: 0,
    y: 0,
    w: width,
    h: height,
    d,
    stroke: opts.stroke ?? '#ff3bd0',
    strokeWidth: opts.strokeWidth ?? Math.max(2, Math.round(size * 0.018)),
    glow: opts.glow,
    glowWidth: opts.glowWidth,
    glowOpacity: opts.glowOpacity ?? 0.55,
    fill: opts.fill,
  };
  return {
    version: DECAL_DOC_VERSION,
    width,
    height,
    bg: opts.bg ?? '#07070d',
    nodes: [node],
  };
}
