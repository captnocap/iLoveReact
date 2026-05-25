import { TILE_PX } from '../world/projection';
import { HEADER, WIN } from '../world/window';
import { HEIGHTS, MAX_BUILDING_H } from '../world/citymap';
import { ITEM_SPRITE_WGSL } from '../registries/items';
import { SDF_HELPERS_WGSL } from './sdf.wgsl';
import { HAZE, NEON, TILE, wgsl } from './palette';

// Ground + windowed tile layer + SDF sprites + high-state post process.
// TONE.md register: neon dusk over grime. Tile/accent colors come from
// render/palette.ts so the minimap and chrome can't drift from the world.
// Buffer layout (unchanged):
//   D[0..8] camera/window header, D[9] spriteCount, D[10] high
//   D[HDR .. HDR+WIN*WIN) tile window
//   spriteCount records of [screenX, screenY, kind, tint, opacity]
export const GROUND_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
const WIN: i32 = ${WIN};
const HDR: i32 = ${HEADER};

// Tile values are packed: bits 0..2 kind, 3..5 height tier, 6..8 facade style.
fn tilePacked(tx: i32, ty: i32, ox: i32, oy: i32) -> i32 {
  let lx = tx - ox;
  let ly = ty - oy;
  if (lx < 0 || ly < 0 || lx >= WIN || ly >= WIN) { return -1; }
  let raw = D[HDR + ly * WIN + lx];
  if (raw < -0.5) { return -1; } // void (outside the city)
  return i32(raw + 0.5);
}
fn tileKind(tx: i32, ty: i32, ox: i32, oy: i32) -> i32 {
  let p = tilePacked(tx, ty, ox, oy);
  if (p < 0) { return -1; }
  return p & 7;
}
fn isWall(tx: i32, ty: i32, ox: i32, oy: i32) -> bool {
  return tileKind(tx, ty, ox, oy) == 6;
}
fn tileStyle(tx: i32, ty: i32, ox: i32, oy: i32) -> i32 {
  let p = tilePacked(tx, ty, ox, oy);
  if (p < 0) { return 0; }
  return (p >> 6) & 7;
}
fn heightForTier(t: i32) -> f32 {
${HEIGHTS.map((h, i) => `  if (t == ${i}) { return ${h.toFixed(2)}; }`).join('\n')}
  return ${HEIGHTS[HEIGHTS.length - 1].toFixed(2)};
}
// Extrusion height of a tile — only walls rise; everything else is ground (0).
fn tileHeight(tx: i32, ty: i32, ox: i32, oy: i32) -> f32 {
  let p = tilePacked(tx, ty, ox, oy);
  if (p < 0) { return 0.0; }
  if ((p & 7) != 6) { return 0.0; }
  return heightForTier((p >> 3) & 7);
}
// Per-building facade palette (style 0 pink stucco, 1 teal, 2 lilac, 3 grime).
fn facadeColor(s: i32) -> vec3f {
  if (s == 1) { return vec3f(0.16, 0.30, 0.30); }
  if (s == 2) { return vec3f(0.28, 0.18, 0.34); }
  if (s == 3) { return vec3f(0.15, 0.13, 0.13); }
  return vec3f(0.34, 0.18, 0.24);
}
fn windowHue(s: i32) -> vec3f {
  if (s == 1) { return ${wgsl(NEON.pink)}; }
  if (s == 2) { return ${wgsl(NEON.orange)}; }
  return ${wgsl(NEON.cyan)};
}
fn roofTone(s: i32) -> vec3f {
  if (s == 1) { return vec3f(0.09, 0.12, 0.13); }
  if (s == 2) { return vec3f(0.12, 0.10, 0.15); }
  if (s == 3) { return vec3f(0.08, 0.075, 0.07); }
  return vec3f(0.13, 0.10, 0.13);
}
fn neonHue(t: i32) -> vec3f {
  if (t == 1) { return ${wgsl(NEON.cyan)}; }
  if (t == 2) { return ${wgsl(NEON.purple)}; }
  if (t == 3) { return ${wgsl(NEON.orange)}; }
  return ${wgsl(NEON.pink)};
}
fn rooftop(hit: vec2f, ox: i32, oy: i32, style: i32) -> vec3f {
  let tx = i32(floor(hit.x));
  let ty = i32(floor(hit.y));
  let fx = fract(hit.x);
  let fy = fract(hit.y);
  // tar-and-gravel surface, toned per building style
  let g = snoise(hit.x * 4.0, hit.y * 4.0) * 0.02;
  var col = roofTone(style) + vec3f(g, g, g);
  // parapet: a bright neon rim, but only on the building's OUTER edges (where the
  // neighbouring tile is not also a wall) — so the roof reads as one capped block.
  let edgeW = select(0.0, 1.0 - smoothstep(0.0, 0.12, fx), !isWall(tx - 1, ty, ox, oy));
  let edgeE = select(0.0, 1.0 - smoothstep(0.0, 0.12, 1.0 - fx), !isWall(tx + 1, ty, ox, oy));
  let edgeN = select(0.0, 1.0 - smoothstep(0.0, 0.12, fy), !isWall(tx, ty - 1, ox, oy));
  let edgeS = select(0.0, 1.0 - smoothstep(0.0, 0.12, 1.0 - fy), !isWall(tx, ty + 1, ox, oy));
  let para = max(max(edgeW, edgeE), max(edgeN, edgeS));
  col = mix(col, windowHue(style) * 0.6 + vec3f(0.12, 0.12, 0.16), para * 0.7);
  // a hashed AC unit / vent block on roughly a third of the roof tiles
  let h = fract(sin(f32(tx) * 12.9898 + f32(ty) * 78.233) * 43758.5453);
  if (h > 0.7 && abs(fx - 0.5) < 0.18 && abs(fy - 0.5) < 0.15) {
    col = vec3f(0.18, 0.17, 0.21);
  }
  return col;
}
fn wallSideColor(nrm: vec2f, hit: vec2f, z: f32, wallH: f32, style: i32) -> vec3f {
  let ndl = clamp(dot(nrm, vec2f(0.42, -0.91)) * 0.5 + 0.5, 0.0, 1.0);
  let lit = 0.40 + 0.50 * ndl;
  let tex = snoise(hit.x * 3.0, hit.y * 3.0) * 0.02;
  var col = (facadeColor(style) + vec3f(tex, tex, tex)) * lit * (0.80 + 0.20 * (z / wallH));
  let along = select(fract(hit.x), fract(hit.y), abs(nrm.x) > 0.5);
  // lit neon windows; row count scales with building height (more floors = taller).
  let rows = max(2.0, floor(wallH * 1.5));
  let wcol = floor(along * 2.0);
  let wrow = floor((z / wallH) * rows);
  let wx2 = fract(along * 2.0);
  let wz2 = fract((z / wallH) * rows);
  let inwin = step(0.22, wx2) * step(wx2, 0.78) * step(0.30, wz2) * step(wz2, 0.82);
  let hue = windowHue(style);
  // checkered lit/dark windows
  let onCell = (i32(wcol) + i32(wrow)) % 2 == 0;
  let win = select(hue * 0.22, hue, onCell);
  col = mix(col, win, inwin * 0.5);
  // neon roofline rim + grimy footing
  if (z > wallH - 0.12) { col = mix(col, hue, 0.5); }
  if (z < 0.06) { col = col * 0.5; }
  return col;
}
fn baseColor(kind: i32, wx: f32, wy: f32, t: f32) -> vec3f {
  // canal at dusk — teal swell with pink neon glints off the surface
  if (kind == 3) {
    let w = sin(wx * 1.7 + t * 1.3) * 0.5 + sin(wy * 2.3 - t * 1.05) * 0.5;
    let glint = pow(max(sin(wx * 6.0 + wy * 4.0 - t * 2.0), 0.0), 8.0);
    var c = mix(${wgsl(TILE.water)}, ${wgsl(TILE.water)} + ${wgsl(NEON.cyan)} * 0.12, w * 0.5 + 0.5);
    return c + ${wgsl(NEON.pink)} * glint * 0.18;
  }
  // sidewalk — dusk concrete with grain
  if (kind == 1) { let g = snoise(wx * 2.5, wy * 2.5) * 0.03; return ${wgsl(TILE.sidewalk)} + vec3f(g, g, g); }
  // neon plaza — glowing pink/cyan checker, the dream pole
  if (kind == 2) {
    let cell = (i32(floor(wx)) + i32(floor(wy))) % 2;
    let pulse = 0.5 + 0.5 * sin(t * 1.4 + wx * 0.6 + wy * 0.4);
    let neon = select(${wgsl(NEON.cyan)}, ${wgsl(NEON.pink)}, cell == 0);
    return ${wgsl(TILE.plaza)} + neon * (0.10 + 0.12 * pulse);
  }
  // beach lip — warm but dirty
  if (kind == 4) { let g = snoise(wx * 4.0, wy * 4.0) * 0.04; return ${wgsl(TILE.sand)} + vec3f(g, g, g); }
  // grime / trap-house dirt — the squalor pole
  if (kind == 5) { let st = snoise(wx * 2.0, wy * 2.0) * 0.05 - snoise(wx * 7.0, wy * 7.0) * 0.03; return ${wgsl(TILE.grime)} + vec3f(st, st, st); }
  // wall handled by raycast (kind == 6)
  if (kind == 6) { return ${wgsl(TILE.wall)}; }
  // door threshold — a dark recess in the facade; the door leaf is a sprite
  if (kind == 7) { return vec3f(0.05, 0.04, 0.07); }
  // road — wet asphalt with a faint neon reflection sheen
  let sheen = pow(max(sin(wx * 0.7 + wy * 1.3 + t * 0.5), 0.0), 6.0);
  let refl = mix(${wgsl(NEON.purple)}, ${wgsl(NEON.cyan)}, fract(wx * 0.3 + wy * 0.2));
  let grain = snoise(wx * 3.0, wy * 3.0) * 0.02;
  return ${wgsl(TILE.road)} + vec3f(grain, grain, grain) + refl * sheen * 0.08;
}

${SDF_HELPERS_WGSL}
fn npcColor(i: i32) -> vec3f {
  if (i == 0) { return vec3f(0.78, 0.32, 0.40); }  // washed red
  if (i == 1) { return vec3f(0.30, 0.55, 0.62); }  // grimy teal
  if (i == 2) { return vec3f(0.55, 0.50, 0.30); }  // mustard
  if (i == 3) { return vec3f(0.40, 0.42, 0.50); }  // grey hoodie
  if (i == 5) { return vec3f(0.85, 0.45, 0.70); }  // hot pink (the fixer)
  return vec3f(0.50, 0.40, 0.58);                  // bruised purple
}
fn awningColor(i: i32) -> vec3f {
  if (i == 0) { return ${wgsl(NEON.pink)}; }
  if (i == 1) { return ${wgsl(NEON.cyan)}; }
  return ${wgsl(NEON.orange)};
}
fn sprite(kind: i32, lx: f32, ly: f32, tint: i32) -> vec4f {
  var c = vec4f(0.0, 0.0, 0.0, 0.0);
  if (kind <= 4) {
    let sd = sdCirc(vec2f(lx, (ly - 1.0) * 2.4), 13.0);
    c = over(c, vec4f(0.02, 0.01, 0.04, (1.0 - smoothstep(0.0, 1.5, sd)) * 0.34));
  }
  if (kind == 0) {
    // palm — thin trunk + drooping fronds
    c = over(c, shade(sdBox(vec2f(lx, ly + 22.0), vec2f(2.6, 22.0)), vec3f(0.34, 0.26, 0.20), vec3f(0.20, 0.15, 0.11)));
    let top = vec2f(lx, ly + 46.0);
    var fr = sdCirc(top + vec2f(-10.0, 2.0), 6.0);
    fr = min(fr, sdCirc(top + vec2f(10.0, 2.0), 6.0));
    fr = min(fr, sdCirc(top + vec2f(0.0, -4.0), 6.0));
    fr = min(fr, sdCirc(top + vec2f(-6.0, -2.0), 5.0));
    fr = min(fr, sdCirc(top + vec2f(6.0, -2.0), 5.0));
    c = over(c, shade(fr, vec3f(0.16, 0.42, 0.22), vec3f(0.08, 0.26, 0.13)));
  } else if (kind == 1) {
    // dumpster — grimy green body + lid + spilling trash
    c = over(c, shade(sdBox(vec2f(lx, ly + 12.0), vec2f(15.0, 11.0)), vec3f(0.18, 0.30, 0.20), vec3f(0.10, 0.18, 0.12)));
    c = over(c, shade(sdBox(vec2f(lx, ly + 24.0), vec2f(17.0, 4.0)), vec3f(0.13, 0.22, 0.15), vec3f(0.07, 0.13, 0.09)));
    c = over(c, shade(sdCirc(vec2f(lx - 7.0, ly + 30.0), 4.0), vec3f(0.42, 0.40, 0.30), vec3f(0.22, 0.20, 0.14)));
  } else if (kind == 2) {
    // storefront — facade, neon awning, lit sign bar, dark doorway
    let aw = awningColor(tint);
    c = over(c, shade(sdBox(vec2f(lx, ly + 20.0), vec2f(22.0, 20.0)), vec3f(0.20, 0.16, 0.22), vec3f(0.10, 0.08, 0.12)));
    c = over(c, shade(sdBox(vec2f(lx, ly + 10.0), vec2f(7.0, 10.0)), vec3f(0.05, 0.04, 0.07), vec3f(0.02, 0.02, 0.03)));
    c = over(c, shade(sdBox(vec2f(lx, ly + 30.0), vec2f(26.0, 5.0)), aw, aw * 0.5));
    c = over(c, shade(sdBox(vec2f(lx, ly + 42.0), vec2f(18.0, 4.0)), aw, vec3f(1.0, 1.0, 1.0)));
  } else if (kind == 3) {
    // neon sign — pole + glowing panel with a soft halo
    let hue = neonHue(tint);
    c = over(c, shade(sdBox(vec2f(lx, ly + 18.0), vec2f(2.0, 18.0)), vec3f(0.20, 0.20, 0.24), vec3f(0.10, 0.10, 0.13)));
    let panel = sdBox(vec2f(lx, ly + 44.0), vec2f(13.0, 9.0));
    let halo = 1.0 - smoothstep(0.0, 22.0, panel);
    c = over(c, vec4f(hue, halo * 0.35));
    c = over(c, shade(panel, hue, vec3f(1.0, 1.0, 1.0)));
  } else if (kind == 4) {
    // a grimy figure
    c = over(c, shade(sdBox(vec2f(lx, ly + 6.0), vec2f(6.0, 6.0)), vec3f(0.12, 0.10, 0.14), vec3f(0.06, 0.05, 0.07)));
    c = over(c, shade(sdBox(vec2f(lx, ly + 18.0), vec2f(8.0, 9.0)), npcColor(tint), vec3f(0.08, 0.06, 0.08)));
    c = over(c, shade(sdCirc(vec2f(lx, ly + 32.0), 7.0), vec3f(0.62, 0.46, 0.40), vec3f(0.34, 0.24, 0.20)));
  } else if (kind == 5) {
    // door leaf — tint 0 closed (a leaf filling the frame, neon trim + handle),
    // tint 1 open (a dark opening with the leaf swung against the jamb).
    if (tint < 1) {
      c = over(c, shade(sdBox(vec2f(lx, ly + 22.0), vec2f(12.0, 22.0)), vec3f(0.13, 0.10, 0.16), ${wgsl(NEON.pink)}));
      c = over(c, shade(sdCirc(vec2f(lx + 7.0, ly + 22.0), 1.8), ${wgsl(NEON.cyan)}, vec3f(1.0, 1.0, 1.0)));
    } else {
      c = over(c, shade(sdBox(vec2f(lx, ly + 22.0), vec2f(11.0, 22.0)), vec3f(0.03, 0.02, 0.05), vec3f(0.06, 0.05, 0.09)));
      c = over(c, shade(sdBox(vec2f(lx - 13.0, ly + 22.0), vec2f(2.5, 22.0)), vec3f(0.13, 0.10, 0.16), ${wgsl(NEON.pink)}));
    }
  } else if (kind == 13) {
    // a downed body — prone torso + slumped head, dull, a dark pool beneath
    c = over(c, vec4f(0.06, 0.02, 0.03, (1.0 - smoothstep(0.0, 16.0, sdCirc(vec2f(lx, (ly + 5.0) * 2.4), 13.0))) * 0.5));
    c = over(c, shade(sdBox(vec2f(lx, ly + 6.0), vec2f(11.0, 4.0)), vec3f(0.30, 0.17, 0.19), vec3f(0.12, 0.07, 0.08)));
    c = over(c, shade(sdCirc(vec2f(lx - 12.0, ly + 6.0), 4.0), vec3f(0.42, 0.31, 0.29), vec3f(0.18, 0.12, 0.12)));
  } else if (kind == 6) {
    c = over(c, shade(abs(lx) + abs(ly) - 4.0, ${wgsl(NEON.pink)}, vec3f(1.0, 1.0, 1.0)));
  } else if (kind == 7) {
    c = over(c, shade(abs(abs(lx) + abs(ly) - 9.0) - 1.6, ${wgsl(NEON.cyan)}, vec3f(1.0, 1.0, 1.0)));
  }
${ITEM_SPRITE_WGSL}
  return c;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let px = D[0];
  let py = D[1];
  let yaw = D[2];
  let pitch = D[3];
  let zoom = D[4];
  let ox = i32(D[6]);
  let oy = i32(D[7]);
  let cx = U.size_w * 0.5;
  let cy = U.size_h * 0.56;
  let tilepx = ${TILE_PX}.0 * zoom;
  let high = D[10];

  var sx = in.uv.x * U.size_w;
  var sy = in.uv.y * U.size_h;
  if (high > 0.001) {
    sx = sx + high * (sin(in.uv.y * 18.0 + U.time * 2.5) * 6.0 + sin(in.uv.x * 9.0 - U.time * 1.7) * 4.0);
    sy = sy + high * (cos(in.uv.x * 16.0 + U.time * 2.1) * 6.0);
  }
  let rx = (sx - cx) / tilepx;
  let ry = (sy - cy) / (tilepx * pitch);
  let cs = cos(yaw);
  let sn = sin(yaw);
  let wx = px + rx * cs + ry * sn;
  let wy = py - rx * sn + ry * cs;

  let kind = tileKind(i32(floor(wx)), i32(floor(wy)), ox, oy);
  let haze = ${wgsl(HAZE)};
  var col = haze;
  if (kind >= 0) {
    col = baseColor(kind, wx, wy, U.time);
    let fx = fract(wx);
    let fy = fract(wy);
    let edge = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy));
    col = col * mix(0.80, 1.0, smoothstep(0.0, 0.04, edge));
  }

  var hazeDist = length(vec2f(wx - px, wy - py));
  // Variable-height heightfield march. The view vector points from this ground
  // fragment toward the camera; marching that way, the ray rises by pitch per
  // tile. We step from high above (z = H_MAX) down toward the fragment and take
  // the first building column the ray dips into. Crossing a column roofline from
  // directly above => rooftop; stepping in from a shorter neighbour => a side
  // face. This lets every building carry its own height (citymap height tiers).
  let view = vec2f(sn, cs);
  let H_MAX = ${(MAX_BUILDING_H + 0.2).toFixed(2)};
  let sMax = H_MAX / pitch;
  let STEPS = 56;
  let ds = sMax / f32(STEPS);
  var prevTx = -99999;
  var prevTy = -99999;
  for (var i = 0; i < STEPS; i = i + 1) {
    let s = sMax - (f32(i) + 0.5) * ds;
    let z = s * pitch;
    let q = vec2f(wx, wy) + view * s;
    let qx = i32(floor(q.x));
    let qy = i32(floor(q.y));
    let h = tileHeight(qx, qy, ox, oy);
    if (h > 0.0 && z <= h) {
      let style = tileStyle(qx, qy, ox, oy);
      if (qx == prevTx && qy == prevTy) {
        col = rooftop(q, ox, oy, style); // descended onto this column's roof
      } else {
        let nrm = normalize(vec2f(f32(prevTx - qx), f32(prevTy - qy)));
        col = wallSideColor(nrm, q, z, h, style); // stepped into a side face
      }
      hazeDist = length(q - vec2f(px, py));
      break;
    }
    prevTx = qx;
    prevTy = qy;
  }
  col = mix(col, haze, smoothstep(15.0, 24.0, hazeDist));

  let base = HDR + WIN * WIN;
  let n = i32(D[9]);
  for (var i = 0; i < n; i = i + 1) {
    let o = base + i * 5;
    let lx = sx - D[o];
    let ly = sy - D[o + 1];
    if (lx < -44.0 || lx > 44.0 || ly > 14.0 || ly < -96.0) { continue; }
    let sc = sprite(i32(D[o + 2]), lx, ly, i32(D[o + 3]));
    col = mix(col, sc.rgb, sc.a * D[o + 4]);
  }

  let vuv = in.uv - vec2f(0.5, 0.5);
  col = col * (1.0 - dot(vuv, vuv) * 0.55);

  if (high > 0.001) {
    let lum = dot(col, vec3f(0.299, 0.587, 0.114));
    col = mix(vec3f(lum), col, 1.0 + high * 0.9);
    col = col + high * 0.10 * vec3f(
      sin(U.time * 1.3 + in.uv.x * 4.0),
      sin(U.time * 1.7 + in.uv.y * 4.0),
      sin(U.time * 0.9));
    col = col * (1.0 + high * 0.13 * sin(U.time * 2.0));
  }
  return vec4f(col, 1.0);
}
`;
