import type { UvIslandRect, UvIslandTriangle } from './uvLayout';

export type UvTexturePatchRaster = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}>;

type Triangle = readonly [number, number, number, number, number, number];

function absoluteTriangle(rect: UvIslandRect, triangle: UvIslandTriangle): Triangle {
  return [
    rect.x + triangle.points[0] * rect.w,
    rect.y + triangle.points[1] * rect.h,
    rect.x + triangle.points[2] * rect.w,
    rect.y + triangle.points[3] * rect.h,
    rect.x + triangle.points[4] * rect.w,
    rect.y + triangle.points[5] * rect.h,
  ];
}

function sampleBilinear(
  source: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  output: Uint8Array,
  write: number,
): void {
  if (x < 0 || y < 0 || x > width || y > height) return;
  const sampleX = Math.max(0, Math.min(width - 1, x - 0.5));
  const sampleY = Math.max(0, Math.min(height - 1, y - 0.5));
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sampleX - x0;
  const ty = sampleY - y0;
  const weights = [
    (1 - tx) * (1 - ty),
    tx * (1 - ty),
    (1 - tx) * ty,
    tx * ty,
  ];
  const reads = [
    (y0 * width + x0) * 4,
    (y0 * width + x1) * 4,
    (y1 * width + x0) * 4,
    (y1 * width + x1) * 4,
  ];
  for (let channel = 0; channel < 4; channel += 1) {
    let value = 0;
    for (let sample = 0; sample < 4; sample += 1) {
      value += source[reads[sample]! + channel]! * weights[sample]!;
    }
    output[write + channel] = Math.round(value);
  }
}

/**
 * Bake patch-local UV edits into the selected islands' unchanged master-atlas
 * footprint. Render-face ids pair the temporary source triangles with their
 * durable master triangles, so translation, rotation, vertex edits, and
 * non-uniform scaling stay local to the patch editor.
 */
export function rasterizeUvTexturePatch(
  sourceRgba: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  masterRects: readonly UvIslandRect[],
  patchRects: readonly UvIslandRect[],
): UvTexturePatchRaster | null {
  if (sourceWidth < 1 || sourceHeight < 1
    || sourceRgba.length !== sourceWidth * sourceHeight * 4
    || masterRects.length < 1
    || masterRects.length !== patchRects.length) return null;

  const patchTriangles = new Map<number, Triangle>();
  for (const rect of patchRects) {
    for (const triangle of rect.triangles ?? []) {
      if (patchTriangles.has(triangle.face)) return null;
      patchTriangles.set(triangle.face, absoluteTriangle(rect, triangle));
    }
  }

  const pairs: { master: Triangle; patch: Triangle }[] = [];
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of masterRects) {
    for (const triangle of rect.triangles ?? []) {
      const patch = patchTriangles.get(triangle.face);
      if (!patch) return null;
      const master = absoluteTriangle(rect, triangle);
      pairs.push({ master, patch });
      for (let corner = 0; corner < 3; corner += 1) {
        left = Math.min(left, master[corner * 2]!);
        top = Math.min(top, master[corner * 2 + 1]!);
        right = Math.max(right, master[corner * 2]!);
        bottom = Math.max(bottom, master[corner * 2 + 1]!);
      }
    }
  }
  if (pairs.length < 1 || !Number.isFinite(left) || patchTriangles.size !== pairs.length) return null;

  const x = Math.floor(left);
  const y = Math.floor(top);
  const width = Math.max(1, Math.ceil(right) - x);
  const height = Math.max(1, Math.ceil(bottom) - y);
  const rgba = new Uint8Array(width * height * 4);
  const epsilon = 1e-7;

  for (const pair of pairs) {
    const [ax, ay, bx, by, cx, cy] = pair.master;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) <= epsilon) continue;
    const lowX = Math.max(x, Math.floor(Math.min(ax, bx, cx)));
    const lowY = Math.max(y, Math.floor(Math.min(ay, by, cy)));
    const highX = Math.min(x + width, Math.ceil(Math.max(ax, bx, cx)));
    const highY = Math.min(y + height, Math.ceil(Math.max(ay, by, cy)));
    for (let destinationY = lowY; destinationY < highY; destinationY += 1) {
      for (let destinationX = lowX; destinationX < highX; destinationX += 1) {
        const px = destinationX + 0.5;
        const py = destinationY + 0.5;
        const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
        const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -epsilon || wb < -epsilon || wc < -epsilon) continue;
        const sourceX = wa * pair.patch[0] + wb * pair.patch[2] + wc * pair.patch[4];
        const sourceY = wa * pair.patch[1] + wb * pair.patch[3] + wc * pair.patch[5];
        const write = ((destinationY - y) * width + destinationX - x) * 4;
        sampleBilinear(sourceRgba, sourceWidth, sourceHeight, sourceX, sourceY, rgba, write);
      }
    }
  }
  return { x, y, width, height, rgba };
}
