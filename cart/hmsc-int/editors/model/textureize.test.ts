// textureize.test.ts — pins the GLOBAL scene packer (editors/model/textureize.ts,
// req_1068/req_1069): the whole scene packs into ONE square sprite-map atlas, every
// face becomes an island with a slot + an outline (the cookie cutter) + normalized
// UVs in [0,1], islands don't overlap, and Power-of-2 holds. Pure + headless.

import { assert, assertEqual, finish, test } from '../../game/_testkit';
import { cuboid, type EditMesh } from './editMesh';
import { DEFAULT_TEXTURE_OPTIONS, islandColorFor, rasterizeAtlas, textureizeScene, type TextureOptions } from './textureize';
import { encodePng } from './png';

function opts(over: Partial<TextureOptions> = {}): TextureOptions {
  return { ...DEFAULT_TEXTURE_OPTIONS, ...over };
}

// every island slot lies inside the atlas and no two slots overlap (with the
// padding gutter, a 1-texel touch is allowed but interiors must be disjoint).
function noOverlaps(islands: { slot: { x: number; y: number; w: number; h: number } }[]): boolean {
  for (let i = 0; i < islands.length; i += 1) {
    for (let j = i + 1; j < islands.length; j += 1) {
      const a = islands[i].slot, b = islands[j].slot;
      const sep = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (!sep) return false;
    }
  }
  return true;
}

test('a one-cube scene packs all 6 faces into the atlas, UVs in [0,1], no overlaps', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1)];
  const tex = textureizeScene(scene, opts({ dedupIslands: false }));
  assertEqual(tex.islands.length, 6, 'six faces → six islands (dedup OFF = per-face product)');
  assert(tex.texels >= 16, 'atlas has a sane texel size');
  for (const isl of tex.islands) {
    for (const [u, v] of isl.uv) {
      assert(u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6, 'every UV corner is inside the unit atlas');
    }
    assert(isl.outline.length >= 3, 'the island carries an outline (the cookie cutter)');
    assert(isl.slot.x + isl.slot.w <= tex.texels + 1e-6 && isl.slot.y + isl.slot.h <= tex.texels + 1e-6, 'the slot fits in the atlas');
  }
  assert(noOverlaps(tex.islands), 'island slots do not overlap');
});

test('a multi-part scene packs EVERY part’s faces into one shared atlas (the sprite map)', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1), cuboid(2, 1, 1), cuboid(0.5, 0.5, 0.5)];
  const tex = textureizeScene(scene, opts({ dedupIslands: false }));
  assertEqual(tex.islands.length, 18, 'three cubes → 18 islands in ONE atlas (dedup OFF)');
  // islands reference all three parts
  assert([0, 1, 2].every((p) => tex.islands.some((i) => i.part === p)), 'all parts are represented');
  // every face of every part got a rewritten UV (the BRANCH edit)
  for (let p = 0; p < scene.length; p += 1) {
    for (const face of tex.meshes[p].faces) assert(!!face.uv && face.uv.length >= 3, 'every face UV was rewritten into the atlas');
  }
  assert(noOverlaps(tex.islands), 'no island overlaps across parts');
});

test('Power-of-2 Size makes the atlas a power of two; off lets it be tight', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1), cuboid(1, 1, 1)];
  const p2 = textureizeScene(scene, opts({ powerOfTwo: true })).texels;
  assert((p2 & (p2 - 1)) === 0, 'power-of-2 atlas edge');
  const tight = textureizeScene(scene, opts({ powerOfTwo: false })).texels;
  assert(tight >= 16, 'non-pow2 atlas still has a sane size');
});

test('higher Pixel Density yields a larger atlas (more texels per unit)', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1)];
  const lo = textureizeScene(scene, opts({ density: 16 })).texels;
  const hi = textureizeScene(scene, opts({ density: 64 })).texels;
  assert(hi > lo, '64x packs more texels than 16x');
});

test('rearrangeUV: false keeps the meshes unchanged (no repack)', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1)];
  const tex = textureizeScene(scene, opts({ rearrangeUV: false }));
  assertEqual(tex.meshes[0], scene[0], 'the mesh ref is untouched when rearrange is off');
});

test('an empty scene is a no-op, not a crash', () => {
  const tex = textureizeScene([], opts());
  assertEqual(tex.islands.length, 0, 'no islands');
  assert(tex.texels >= 16, 'still a sane atlas size');
});

test('islandColorFor is stable + cycles per face within a part (req_1072)', () => {
  assertEqual(islandColorFor('pt-1', 2), islandColorFor('pt-1', 2), 'same (part,face) → same color, always');
  assert(islandColorFor('pt-1', 0) !== islandColorFor('pt-1', 1), 'consecutive faces differ (cycle the palette)');
});

test('rasterizeAtlas: whole sheet is texels² with opaque island pixels; a slice is cropped', () => {
  const scene: EditMesh[] = [cuboid(1, 1, 1)];
  const tex = textureizeScene(scene, opts());
  const parts = scene.map((mesh, i) => ({ id: `pt-${i}`, mesh: tex.meshes[i] }));
  const whole = rasterizeAtlas(parts, tex.texels, 'template', '#000000');
  assertEqual(whole.width, tex.texels, 'whole sheet width = atlas texels');
  assertEqual(whole.rgba.length, tex.texels * tex.texels * 4, 'rgba is tight width*height*4');
  let opaque = 0;
  for (let i = 3; i < whole.rgba.length; i += 4) if (whole.rgba[i] === 255) opaque += 1;
  assert(opaque > 0, 'the template fills island silhouettes (some opaque pixels)');
  const slice = rasterizeAtlas(parts, tex.texels, 'template', '#000000', { partId: 'pt-0', faceIndex: 0 });
  assert(slice.width <= tex.texels && slice.height <= tex.texels && slice.width >= 1, 'a slice is cropped to its slot');
});

test('encodePng emits a valid PNG signature + IHDR dimensions', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]); // 2×2
  const png = encodePng(rgba, 2, 2);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert(sig.every((b, i) => png[i] === b), 'starts with the PNG signature');
  // IHDR data begins at byte 16 (8 sig + 4 len + 4 'IHDR'): width then height, BE.
  const w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
  const h = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
  assertEqual(w, 2, 'IHDR width');
  assertEqual(h, 2, 'IHDR height');
});

test('fitTexels packs a fixed-size atlas regardless of model size (req_1209 paint grid)', () => {
  // A small and a 12× larger model both fit to ~the same target — the paint grid is
  // model-INDEPENDENT (the bug was the packed atlas ballooning to 1024 for a big model,
  // making paint cells sub-pixel + bleeding across faces).
  const small = textureizeScene([cuboid(1, 1, 1)], DEFAULT_TEXTURE_OPTIONS, 16, 64);
  const huge = textureizeScene([cuboid(12, 4, 4)], DEFAULT_TEXTURE_OPTIONS, 16, 64);
  assert(small.texels <= 128 && huge.texels <= 128, 'both fit at/under 128 (≈ the 64 target, pow2-rounded)');
  assert(Math.abs(small.texels - huge.texels) <= huge.texels, 'the huge model is NOT an order of magnitude bigger');
  // every face gets a paintable slot (≥ ~1 cell) with the grid = the packed atlas (no bleed).
  for (const f of huge.meshes[0].faces) {
    const uv = f.uv!;
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (const [u, v] of uv) { x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    assert((x1 - x0) * huge.texels >= 0.9 && (y1 - y0) * huge.texels >= 0.9, 'face slot spans at least ~1 grid cell');
  }
});

test('dedupIslands collapses congruent faces to one shared island (req_1255)', () => {
  // a 1×1×1 cube's six faces are all 1×1 squares → ONE distinct shape. Dedup packs
  // one island; every face still gets a uv (pointing at the shared slot).
  const cube = textureizeScene([cuboid(1, 1, 1)], opts({ dedupIslands: true }));
  assertEqual(cube.islands.length, 1, 'six congruent faces → one island');
  for (const f of cube.meshes[0].faces) assert(!!f.uv && f.uv.length >= 3, 'every face still has a uv into the shared slot');
  // a 2×1×1 slab has TWO distinct shapes (1×1 ends + 2×1 sides) → two islands.
  const slab = textureizeScene([cuboid(2, 1, 1)], opts({ dedupIslands: true }));
  assertEqual(slab.islands.length, 2, '1×1 ends + 2×1 sides → two shapes');
  // dedup never GROWS the atlas vs the per-face product (the storage win).
  const on = textureizeScene([cuboid(2, 1, 1)], opts({ dedupIslands: true })).texels;
  const off = textureizeScene([cuboid(2, 1, 1)], opts({ dedupIslands: false })).texels;
  assert(on <= off, 'the deduped atlas is no bigger than the per-face one');
});

finish('textureize');
