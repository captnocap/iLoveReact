// painterView.wgsl.ts — the COMBINED editor surface: every authoring channel on
// one quad, weighted by per-channel emphasis (PAINTER-0610, req_0593).
//
// The old per-layer views (tile / height-tint / zone-tint) swapped the whole
// shader, so each mode was blind to the others — roads couldn't see terrain,
// terrain couldn't see zones. This shader composes all of them in one pass:
//
//   tile ground + analytic road ribbon   (copied from HEIGHTFIELD_TILE_SHADER)
//   height tint + contour lines          (copied from HEIGHT_TILE_VIEW_WGSL)
//   zone tint                            (copied from ZONE_VIEW_WGSL)
//
// EDITOR-ONLY. The game's HEIGHTFIELD_TILE_SHADER (render3d/heightfieldSurface)
// and its CPU mirror heightfieldTexelColor stay untouched — they bake the
// compiled game's floor and must remain in lockstep with each other, not with
// this view. Ribbon math here is a verbatim copy; if the game ribbon changes,
// re-copy it.
//
// D[] layout (encodePainterSurface — EVERY section always emitted with explicit
// headers, the GHOSTROAD-0610 rule: Effect buffers only grow, so an omitted
// section leaves the previous tenant alive in the tail):
//   [0] opRoad  [1] opHeight  [2] opZone  [3] reserved
//   tile:   cols, rows, palN, palN*3 rgb, cols*rows cell indices
//   road:   segN, crosswalkIdx, junctionIdx, laneStartIdx, medianIdx, segN*8 segs
//   height: hcols, hrows, visRef, tilesX, tilesY, hcols*hrows z samples
//   zone:   zcols, zrows, zpalN, zpalN*3 rgb, zcols*zrows zone indices
//
// (WGSL: no unary plus, no backticks in comments.)

// Parking stall paint: same per-kind branch + line width as the game's
// HEIGHTFIELD_TILE_SHADER, sharing the one home (parkingStall.ts), so the
// painter shows exactly the bay lines the game will bake. 'parking' runs across
// X, 'parkingCross' across Z (req_0710).
import {
  PARKING_KIND_INDEX, PARKING_CROSS_KIND_INDEX, PARKING_STALL_WGSL,
} from './render3d/parkingStall';

export const PAINTER_VIEW_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${PARKING_STALL_WGSL}

fn warmRamp(t: f32) -> vec3f {
  let c0 = vec3f(0.98, 0.78, 0.24);
  let c1 = vec3f(0.98, 0.45, 0.18);
  let c2 = vec3f(1.00, 0.92, 0.78);
  let s = clamp(t, 0.0, 1.0) * 2.0;
  if (s < 1.0) { return mix(c0, c1, s); }
  return mix(c1, c2, s - 1.0);
}

fn coolRamp(t: f32) -> vec3f {
  let c0 = vec3f(0.20, 0.75, 0.88);
  let c1 = vec3f(0.18, 0.36, 0.88);
  let c2 = vec3f(0.08, 0.12, 0.42);
  let s = clamp(t, 0.0, 1.0) * 2.0;
  if (s < 1.0) { return mix(c0, c1, s); }
  return mix(c1, c2, s - 1.0);
}

fn hSample(base: i32, ix: i32, iy: i32, cols: i32, rows: i32) -> f32 {
  let cx = clamp(ix, 0, cols - 1);
  let cy = clamp(iy, 0, rows - 1);
  return D[base + 5 + cy * cols + cx];
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let opRoad = D[0];
  let opHeight = D[1];
  let opZone = D[2];
  let tBase = 4;

  // ── tile ground (the base channel, always on) ──────────────────────────────
  let cols = i32(D[tBase]);
  let rows = i32(D[tBase + 1]);
  let pal = i32(D[tBase + 2]);
  let cellBase = tBase + 3 + pal * 3;

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
    let pbase = tBase + 3 + kind * 3;
    let col = vec3f(D[pbase], D[pbase + 1], D[pbase + 2]);
    let shade = mix(1.0, 0.78, smoothstep(0.44, 0.5, edge));
    rgb = col * shade;
    if (kind == ${PARKING_KIND_INDEX}) {
      rgb = parking_stall(in.uv.x * f32(cols), rgb);
    } else if (kind == ${PARKING_CROSS_KIND_INDEX}) {
      rgb = parking_stall(in.uv.y * f32(rows), rgb);
    }
  }

  // ── road ribbon (verbatim from HEIGHTFIELD_TILE_SHADER, weighted) ──────────
  let cellEnd = cellBase + rows * cols;
  let segN = i32(D[cellEnd]);
  let cwIdx = i32(D[cellEnd + 1]);
  let jIdx = i32(D[cellEnd + 2]);
  let laneIdx = i32(D[cellEnd + 3]);
  let medIdx = i32(D[cellEnd + 4]);
  if (segN > 0 && opRoad > 0.001 && kind != cwIdx) {
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
    // Longitudinal overshoot guard (RIBBONCAP-0610) — see heightfieldSurface.
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
      rgb = mix(rgb, road, opRoad);
    } else {
      // Curb apron: a road-stamped cell outside the analytic band is the stamp
      // staircase at a curve — concrete shoulder, not blocky asphalt tiles.
      let isLane = kind >= laneIdx && kind < laneIdx + 4;
      if (isLane || kind == jIdx || kind == medIdx) {
        let shade2 = mix(1.0, 0.9, smoothstep(0.44, 0.5, edge));
        rgb = mix(rgb, vec3f(0.33, 0.36, 0.41) * shade2, opRoad);
      }
    }
  }

  // ── height tint + contours (verbatim ramps, amount scaled by opHeight) ─────
  let hBase = cellEnd + 5 + segN * 8;
  let hcols = i32(D[hBase]);
  let hrows = i32(D[hBase + 1]);
  if (opHeight > 0.001 && hcols > 1 && hrows > 1) {
    let visRef = max(D[hBase + 2], 0.01);
    let fp = in.uv * vec2f(f32(hcols - 1), f32(hrows - 1));
    let ix = i32(floor(fp.x));
    let iy = i32(floor(fp.y));
    let fr = fract(fp);
    let h00 = hSample(hBase, ix, iy, hcols, hrows);
    let h10 = hSample(hBase, ix + 1, iy, hcols, hrows);
    let h01 = hSample(hBase, ix, iy + 1, hcols, hrows);
    let h11 = hSample(hBase, ix + 1, iy + 1, hcols, hrows);
    let hz = mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
    let ht = clamp(abs(hz) / visRef, 0.0, 1.0);
    if (abs(hz) > 0.025) {
      let tint = select(coolRamp(ht), warmRamp(ht), hz > 0.0);
      rgb = mix(rgb, tint, (0.34 + 0.30 * smoothstep(0.0, 0.28, ht)) * opHeight);

      let af = fract(abs(hz));
      let near = min(af, 1.0 - af);
      let contour = 1.0 - smoothstep(0.0, 0.055, near);
      rgb = mix(rgb, vec3f(0.02, 0.03, 0.05), contour * 0.45 * opHeight);
    }
  }

  // ── zone tint (verbatim from ZONE_VIEW_WGSL, amount scaled by opZone) ──────
  let zBase = hBase + 5 + hcols * hrows;
  let zpalN = i32(D[zBase + 2]);
  if (opZone > 0.001) {
    let zCellBase = zBase + 3 + zpalN * 3;
    let zkind = i32(D[zCellBase + cy * cols + cx]);
    if (zkind >= 0) {
      let zb = zBase + 3 + zkind * 3;
      let zc = vec3f(D[zb], D[zb + 1], D[zb + 2]);
      rgb = mix(rgb, zc, 0.5 * opZone);
    }
  }

  // ── painted water (the terrain water brush): a clear blue where the water grid
  // is wet (level > 0), so you SEE what you paint on the 2D map. Same encodeField
  // layout as height; the section sits after zone. Always shown (it's the body
  // of water, not a tint channel).
  let zEnd = zBase + 3 + zpalN * 3 + i32(D[zBase]) * i32(D[zBase + 1]);
  let wcols = i32(D[zEnd]);
  let wrows = i32(D[zEnd + 1]);
  if (wcols > 1 && wrows > 1) {
    let wx = clamp(i32(in.uv.x * f32(wcols)), 0, wcols - 1);
    let wy = clamp(i32(in.uv.y * f32(wrows)), 0, wrows - 1);
    let level = D[zEnd + 5 + wy * wcols + wx];
    if (level > 0.02) {
      let deep = clamp(0.45 + level * 0.04, 0.45, 0.78);
      rgb = mix(rgb, vec3f(0.18, 0.50, 0.66), deep);
    }
  }

  return vec4f(rgb, 1.0);
}
`;
