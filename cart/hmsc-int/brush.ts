export type BrushShape = 'circle' | 'square' | 'diamond';
export type BrushMode = 'paint' | 'erase';

export function footprintDistance(shape: BrushShape, dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  switch (shape) {
    case 'square': return Math.max(ax, ay);
    case 'diamond': return ax + ay;
    case 'circle':
    default: return Math.hypot(dx, dy);
  }
}

export function forEachFootprintCell(
  shape: BrushShape,
  radius: number,
  cx: number,
  cz: number,
  cb: (x: number, z: number) => void,
): void {
  const r = Math.max(0, Math.round(radius));
  const reach = r + 0.5;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (footprintDistance(shape, dx, dz) <= reach) cb(cx + dx, cz + dz);
    }
  }
}
