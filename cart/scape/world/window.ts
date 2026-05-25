import { cityPropsIn } from './citymap';
import { type DecorKind, tileAt } from './tiles';

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

export function buildTileWindow(winOX: number, winOY: number): number[] {
  const tiles = new Array<number>(WIN * WIN);
  for (let ly = 0; ly < WIN; ly++) {
    for (let lx = 0; lx < WIN; lx++) {
      tiles[ly * WIN + lx] = tileAt(winOX + lx, winOY + ly);
    }
  }
  return tiles;
}

// Authored props within the streaming window — no noise, no scatter. The tile
// window argument is unused now (props are hand-placed, not grass-gated) but kept
// in the signature so the call site stays stable.
export function buildDecorWindow(winOX: number, winOY: number, _winTiles?: number[]): Decor[] {
  return cityPropsIn(winOX, winOY, WIN, WIN).map((p) => ({
    id: `d-${Math.floor(p.x)}-${Math.floor(p.y)}`,
    kind: p.kind,
    x: p.x,
    y: p.y,
    tint: p.tint,
  }));
}
