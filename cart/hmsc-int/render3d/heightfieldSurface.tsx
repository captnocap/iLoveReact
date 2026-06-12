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
// Parking stall paint (PARKSPAWN-0612): 'parking' cells draw white stall lines
// every 3m (bay width) over their asphalt palette color. The kind INDEX is
// baked into the shader string from TILE_KINDS order — the same order
// encodeTileMap ships cell indices in — so the shader needs no extra D[] slot
// (Effect buffers only grow; a layout change would ripple the CPU mirror, the
// painter view, and every baked floor).
const PARKING_KIND_INDEX = TILE_KINDS.indexOf('parking');

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
    if (kind == ${PARKING_KIND_INDEX}) {
      let pwx = in.uv.x * f32(cols);
      let stallD = abs(pwx - 3.0 * round(pwx / 3.0));
      let stall = 1.0 - smoothstep(0.06, 0.10, stallD);
      rgb = mix(rgb, vec3f(0.85, 0.86, 0.88), stall * 0.85);
    }
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
      // Longitudinal overshoot guard (RIBBONCAP-0610): signedD is only the
      // PERPENDICULAR component, so a fragment past a segment's endpoint (q
      // clamped to the end, p-q running ALONG the axis) reads signedD~=0 and
      // would pass the band test — painting an INFINITE strip past the last
      // point (the user's "massive road on a tiny paint"). bestD^2 - signedD^2
      // is the squared longitudinal distance: 0 on the segment interior, >0
      // once clamped to an endpoint. Cap it to square the polyline ends;
      // interior joints stay covered by the neighbour (its perpendicular foot
      // is the nearer point, so it wins selection with zero overshoot).
      let overshoot2 = bestD * bestD - signedD * signedD;
      let inside = bestD < 1e8 && signedD < rExt && signedD > (0.0 - lExt) && overshoot2 < 0.25;
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

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// CPU MIRROR of HEIGHTFIELD_TILE_SHADER's fragment function (RIBBONBAKE-0610).
// The compiled game ships a BAKED floor texture — it cannot run this Effect at
// load — so the editor's LIVE ribbon and the game's baked floor only match if
// the SAME fragment logic produces both. This walks the exact array the shader
// reads (heightfieldTileData(tiles, roads) — or its prefix-compatible twin
// [...encodeTileMap output, ...roadRibbonSection(roads)]); (u,v) ∈ [0,1] is the
// texel UV. Returns linear rgb. KEEP IN LOCKSTEP WITH THE WGSL ABOVE — any edit
// to the shader's ribbon/curb math must land here too, or the game drifts from
// the editor again (the very bug this closes).
export function heightfieldTexelColor(data: number[], u: number, v: number): [number, number, number] {
  const cols = data[0] | 0;
  const rows = data[1] | 0;
  const pal = data[2] | 0;
  const cellBase = 3 + pal * 3;

  const cxi = Math.max(0, Math.min(cols - 1, Math.floor(u * cols)));
  const cyi = Math.max(0, Math.min(rows - 1, Math.floor(v * rows)));
  const kind = data[cellBase + cyi * cols + cxi] | 0;

  const px = u * cols;
  const py = v * rows;
  const edge = Math.max(Math.abs(px - Math.floor(px) - 0.5), Math.abs(py - Math.floor(py) - 0.5));

  let r: number;
  let g: number;
  let b: number;
  if (kind < 0) {
    const gg = smoothstep01(0.46, 0.5, edge) * 0.07;
    r = 0.05 + gg; g = 0.07 + gg; b = 0.1 + gg;
  } else {
    const pbase = 3 + kind * 3;
    const shade = 1 + (0.78 - 1) * smoothstep01(0.44, 0.5, edge);
    r = data[pbase] * shade; g = data[pbase + 1] * shade; b = data[pbase + 2] * shade;
    if (kind === PARKING_KIND_INDEX) {
      const stallD = Math.abs(px - 3 * Math.round(px / 3));
      const stall = (1 - smoothstep01(0.06, 0.1, stallD)) * 0.85;
      r += (0.85 - r) * stall; g += (0.86 - g) * stall; b += (0.88 - b) * stall;
    }
  }

  const cellEnd = cellBase + rows * cols;
  if (cellEnd + 5 <= data.length) {
    const segN = data[cellEnd] | 0;
    const cwIdx = data[cellEnd + 1] | 0;
    const jIdx = data[cellEnd + 2] | 0;
    const laneIdx = data[cellEnd + 3] | 0;
    const medIdx = data[cellEnd + 4] | 0;
    if (segN > 0 && kind !== cwIdx) {
      let bestD = 1e9;
      let signedD = 0;
      let rExt = 0;
      let lExt = 0;
      let twoWay = 0;
      let phase = 0;
      let along = 0;
      for (let s = 0; s < segN; s += 1) {
        const b0 = cellEnd + 5 + s * 8;
        const ax = data[b0];
        const az = data[b0 + 1];
        const abx = data[b0 + 2] - ax;
        const abz = data[b0 + 3] - az;
        const len2 = abx * abx + abz * abz;
        let t = 0;
        if (len2 > 1e-6) t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - az) * abz) / len2));
        const qx = ax + abx * t;
        const qz = az + abz * t;
        const d = Math.hypot(px - qx, py - qz);
        if (d < bestD) {
          bestD = d;
          const rl = Math.hypot(abx, abz) || 1;
          signedD = (px - qx) * (-abz / rl) + (py - qz) * (abx / rl);
          rExt = data[b0 + 4];
          lExt = data[b0 + 5];
          twoWay = data[b0 + 6];
          phase = data[b0 + 7];
          along = t * Math.sqrt(len2);
        }
      }
      const overshoot2 = bestD * bestD - signedD * signedD;
      if (bestD < 1e8 && signedD < rExt && signedD > -lExt && overshoot2 < 0.25) {
        let cr = 0.118;
        let cg = 0.129;
        let cb = 0.157;
        const ad = Math.abs(signedD);
        if (kind !== jIdx) {
          if (twoWay > 0.5 && Math.abs(ad - 0.17) < 0.07) { cr = 0.76; cg = 0.6; cb = 0.11; }
          const k = Math.floor((ad - phase) / 3 + 0.5);
          const boundary = phase + k * 3;
          const maxExt = Math.max(rExt, lExt);
          if (k >= 0 && Math.abs(ad - boundary) < 0.06 && boundary < maxExt - 1 && (boundary > 0.3 || phase < 0.1)) {
            const af = along / 6;
            if (af - Math.floor(af) < 0.5) { cr = 0.82; cg = 0.84; cb = 0.86; }
          }
          const extHere = signedD >= 0 ? rExt : lExt;
          if (extHere - ad < 0.28 && extHere - ad > 0.14) { cr = 0.82; cg = 0.84; cb = 0.86; }
        }
        r = cr; g = cg; b = cb;
      } else {
        const isLane = kind >= laneIdx && kind < laneIdx + 4;
        if (isLane || kind === jIdx || kind === medIdx) {
          const shade2 = 1 + (0.9 - 1) * smoothstep01(0.44, 0.5, edge);
          r = 0.33 * shade2; g = 0.36 * shade2; b = 0.41 * shade2;
        }
      }
    }
  }
  return [r, g, b];
}

// Linear RGB per tile kind, indexed by TILE_KINDS order — the same palette the
// editor ships, recomputed here so the shader maps a cell index → colour with no
// per-cell JS. Shared by the game render and (re-exported) the editor.
export const HEIGHTFIELD_TILE_PALETTE: [number, number, number][] =
  TILE_KINDS.map((k) => hexToRgb01(tileKindDefinition(k).render.color));

// Encode a landform's per-cell tile grid for the shader buffer. `roads` is the
// optional analytic ribbon section (8 floats per segment — see the shader
// comment); absent = a segN=0 header rides along so a re-upload of the same
// buffer turns the pass OFF (see roadRibbonSection's GHOSTROAD-0610 note).
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
 *  covers all four.
 *
 *  The header is ALWAYS emitted, with segN=0 when there are no segments
 *  (GHOSTROAD-0610): the Effect data buffer only ever GROWS
 *  (framework/gpu/effects.zig recreates on capacity shortfall, never on
 *  shrink) and the shader's guard is arrayLength(&D) — the bind-group
 *  CAPACITY. Encoding "no roads" by omitting the section left the PREVIOUS
 *  section alive in the buffer tail, so a deleted road kept rendering as a
 *  ghost ribbon while the menu and state were correctly empty. An explicit
 *  segN=0 overwrites the slot and turns the pass off. */
export function roadRibbonSection(roads?: number[]): number[] {
  const segs = roads && roads.length >= 8 ? roads : [];
  return [
    Math.floor(segs.length / 8),
    TILE_KINDS.indexOf('crosswalk'),
    TILE_KINDS.indexOf('junction'),
    TILE_KINDS.indexOf('laneNorth'),
    TILE_KINDS.indexOf('median'),
    ...segs,
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
