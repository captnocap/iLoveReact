import { packedAt, propsIn } from './atlas';
import { type DecorKind } from './tiles';

export const HEADER = 16;
export const WIN = 56;
export const HALF = WIN >> 1;
export const MAX_SPRITES = 180;

export interface Decor {
  id: string;
  kind: DecorKind;
  x: number;
  y: number;
  tint: number;
}

// Streams the PACKED tile values (kind | tier<<3 | style<<6) from the baked world
// (VOID where unclaimed). Window origin may be negative. The minimap shader masks
// off the kind and unpacks tier/style as needed.
export function buildTileWindow(winOX: number, winOY: number): number[] {
  const tiles = new Array<number>(WIN * WIN);
  for (let ly = 0; ly < WIN; ly++) {
    for (let lx = 0; lx < WIN; lx++) {
      tiles[ly * WIN + lx] = packedAt(winOX + lx, winOY + ly);
    }
  }
  return tiles;
}

// Props inside the streaming window — baked, hand-placed. The tile-window argument
// is unused (props aren't grass-gated) but kept so the call site stays stable.
export function buildDecorWindow(winOX: number, winOY: number, _winTiles?: number[]): Decor[] {
  return propsIn(winOX, winOY, WIN, WIN);
}
