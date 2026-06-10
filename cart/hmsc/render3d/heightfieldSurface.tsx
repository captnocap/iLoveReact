import { memo, useMemo } from 'react';
import { Effect, StaticSurface } from '@reactjit/primitives';
import type { Landform } from '../design';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { hexToRgb01 } from '../world/placeables';

// The painted-terrain surface: the per-cell tile grid a 'heightfield' landform
// carries (field.tiles), captured offscreen by ONE Effect quad and draped over the
// displaced mesh as its texture — the editor's "tiles on the mesh" in the game's
// own renderer. ONE shader for both the editor's 2D canvas and the game's 3D
// terrain (hmsc-int re-exports HEIGHTFIELD_TILE_SHADER), so the paint you see in
// the painter is the paint the world boots with.
//
// D[] layout (matches encodeTileMap / heightfieldTileData): [0]cols [1]rows
// [2]paletteCount, then paletteCount*3 palette rgb floats, then rows*cols cell
// indices (-1 = empty). (WGSL: no unary +, no backticks in comments.)

// After the cell grid, an OPTIONAL road-ribbon section (ROADCURVE-0610):
// [segCount, crosswalkKindIdx, junctionKindIdx, laneStartKindIdx, medianKindIdx,
// then segCount*8 floats — ax az bx bz rightExt leftExt twoWay phase, in cell
// space]. The ribbon paints the carriageway ANALYTICALLY from distance to the
// filleted centerline, so curves are sub-tile smooth at the capture's full
// resolution; the 1m tile stamps underneath keep carrying gameplay. Crosswalk
// cells keep their tile look (the zebra is a rectangular band — cells render it
// fine); junction cells take plain asphalt (no markings through the box).
// Road-STAMPED cells that fall OUTSIDE the analytic band (the rasterization
// staircase at curves) render as a concrete curb apron instead of raw asphalt
// tiles — the gameplay stamp stays, the blocky edge disappears.
export const HEIGHTFIELD_TILE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;

  let cx = clamp(i32(floor(in.uv.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(in.uv.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);

  let gf = abs(fract(in.uv * vec2f(f32(cols), f32(rows))) - vec2f(0.5));
  let edge = max(gf.x, gf.y);

  var rgb = vec3f(0.0);
  if (kind < 0) {
    let g = smoothstep(0.46, 0.5, edge) * 0.07;
    rgb = vec3f(0.05 + g, 0.07 + g, 0.10 + g);
  } else {
    let pbase = 3 + kind * 3;
    let col = vec3f(D[pbase], D[pbase + 1], D[pbase + 2]);
    let shade = mix(1.0, 0.78, smoothstep(0.44, 0.5, edge));
    rgb = col * shade;
  }

  let cellEnd = cellBase + rows * cols;
  let total = i32(arrayLength(&D));
  if (cellEnd + 5 <= total) {
    let segN = i32(D[cellEnd]);
    let cwIdx = i32(D[cellEnd + 1]);
    let jIdx = i32(D[cellEnd + 2]);
    let laneIdx = i32(D[cellEnd + 3]);
    let medIdx = i32(D[cellEnd + 4]);
    if (segN > 0 && kind != cwIdx) {
      let p = in.uv * vec2f(f32(cols), f32(rows));
      var bestD = 1e9;
      var signedD = 0.0;
      var rExt = 0.0;
      var lExt = 0.0;
      var twoWay = 0.0;
      var phase = 0.0;
      var along = 0.0;
      for (var s = 0; s < segN; s = s + 1) {
        let b0 = cellEnd + 5 + s * 8;
        let a = vec2f(D[b0], D[b0 + 1]);
        let b = vec2f(D[b0 + 2], D[b0 + 3]);
        let ab = b - a;
        let len2 = dot(ab, ab);
        var t = 0.0;
        if (len2 > 0.000001) { t = clamp(dot(p - a, ab) / len2, 0.0, 1.0); }
        let q = a + ab * t;
        let d = distance(p, q);
        if (d < bestD) {
          bestD = d;
          let ru = normalize(vec2f(0.0 - ab.y, ab.x));
          signedD = dot(p - q, ru);
          rExt = D[b0 + 4];
          lExt = D[b0 + 5];
          twoWay = D[b0 + 6];
          phase = D[b0 + 7];
          along = t * sqrt(len2);
        }
      }
      let inside = bestD < 1e8 && signedD < rExt && signedD > (0.0 - lExt);
      if (inside) {
        var road = vec3f(0.118, 0.129, 0.157);
        let ad = abs(signedD);
        if (kind != jIdx) {
          if (twoWay > 0.5 && abs(ad - 0.17) < 0.07) { road = vec3f(0.76, 0.60, 0.11); }
          let rel = ad - phase;
          let k = floor(rel / 3.0 + 0.5);
          let boundary = phase + k * 3.0;
          let maxExt = max(rExt, lExt);
          if (k >= 0.0 && abs(ad - boundary) < 0.06 && boundary < maxExt - 1.0 && (boundary > 0.3 || phase < 0.1)) {
            if (fract(along / 6.0) < 0.5) { road = vec3f(0.82, 0.84, 0.86); }
          }
          let extHere = select(lExt, rExt, signedD >= 0.0);
          if (extHere - ad < 0.28 && extHere - ad > 0.14) { road = vec3f(0.82, 0.84, 0.86); }
        }
        rgb = road;
      } else {
        // The curb apron: a road-stamped cell (lane / median / junction) whose
        // fragment lies outside the analytic band is the stamp staircase at a
        // curve — render it as concrete shoulder, not blocky asphalt tiles.
        let isLane = kind >= laneIdx && kind < laneIdx + 4;
        if (isLane || kind == jIdx || kind == medIdx) {
          let shade2 = mix(1.0, 0.9, smoothstep(0.44, 0.5, edge));
          rgb = vec3f(0.33, 0.36, 0.41) * shade2;
        }
      }
    }
  }
  return vec4f(rgb, 1.0);
}
`;

// Linear RGB per tile kind, indexed by TILE_KINDS order — the same palette the
// editor ships, recomputed here so the shader maps a cell index → colour with no
// per-cell JS. Shared by the game render and (re-exported) the editor.
export const HEIGHTFIELD_TILE_PALETTE: [number, number, number][] =
  TILE_KINDS.map((k) => hexToRgb01(tileKindDefinition(k).render.color));

// Encode a landform's per-cell tile grid for the shader buffer. `roads` is the
// optional analytic ribbon section (8 floats per segment — see the shader
// comment); absent = the section is omitted and the shader's length guard
// skips the pass, so pre-road data renders exactly as before.
export function heightfieldTileData(tiles: { cols: number; rows: number; idx: number[] }, roads?: number[]): number[] {
  const out: number[] = [tiles.cols, tiles.rows, HEIGHTFIELD_TILE_PALETTE.length];
  for (const c of HEIGHTFIELD_TILE_PALETTE) out.push(c[0], c[1], c[2]);
  for (let i = 0; i < tiles.idx.length; i += 1) out.push(tiles.idx[i]);
  out.push(...roadRibbonSection(roads));
  return out;
}

/** The ribbon section ([segN, crosswalkIdx, junctionIdx, laneStartIdx,
 *  medianIdx, segs…]) appended after the cells — shared by the 3D drape capture
 *  AND the editor's 2D chunk quads (both run HEIGHTFIELD_TILE_SHADER). The lane
 *  block (laneNorth..laneWest) is contiguous in TILE_KINDS, so one start index
 *  covers all four. Empty input = empty section. */
export function roadRibbonSection(roads?: number[]): number[] {
  if (!roads || roads.length < 8) return [];
  return [
    Math.floor(roads.length / 8),
    TILE_KINDS.indexOf('crosswalk'),
    TILE_KINDS.indexOf('junction'),
    TILE_KINDS.indexOf('laneNorth'),
    TILE_KINDS.indexOf('median'),
    ...roads,
  ];
}

export function heightfieldTextureKey(landformId: string): string {
  return `hf_surface_${landformId}`;
}

// ~4 px per 1m cell over the footprint, capped well under the window framebuffer
// (a StaticSurface capture cannot exceed it — same rule as the chunk floors).
const MAX_CAPTURE_PX = 512;
function captureDimension(tiles: { cols: number; rows: number }): number {
  const span = Math.max(tiles.cols, tiles.rows);
  return Math.max(128, Math.min(MAX_CAPTURE_PX, Math.round(span * 4)));
}

// One landform's painted-tile texture: its per-cell grid captured offscreen, keyed
// by landform id so the texture (and its bind group) persists across frames; only
// the contents re-bake when the paint changes. Identities are stabilized so an
// unrelated re-render does not commit an Effect UPDATE that re-bakes every frame
// (the static_surface_inline_props_rebake trap).
const HeightfieldSurfaceCapture = memo(function HeightfieldSurfaceCapture(props: { landform: Landform }) {
  const tiles = props.landform.field?.tiles;
  const roads = props.landform.field?.roads;
  const px = captureDimension(tiles ?? { cols: 1, rows: 1 });
  const data = useMemo(() => (tiles ? heightfieldTileData(tiles, roads) : [1, 1, 0, -1]), [tiles, roads]);
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: px, height: px }),
    [px],
  );
  const effectStyle = useMemo(() => ({ width: px, height: px }), [px]);
  return (
    <StaticSurface staticKey={heightfieldTextureKey(props.landform.id)} style={surfaceStyle}>
      <Effect shader={HEIGHTFIELD_TILE_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// The painted-tile captures for every heightfield landform (those carrying a tile
// grid). Mirrors LandformSurfaceCaptures; rendered alongside it.
export const HeightfieldSurfaceCaptures = memo(function HeightfieldSurfaceCaptures(props: { landforms: Landform[] }) {
  return (
    <>
      {props.landforms
        .filter((lf) => lf.field?.tiles)
        .map((lf) => (
          <HeightfieldSurfaceCapture key={heightfieldTextureKey(lf.id)} landform={lf} />
        ))}
    </>
  );
});
