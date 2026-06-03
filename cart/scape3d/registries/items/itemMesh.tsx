// Item 3D models are authored in CENTIMETRES: 1 unit = 1 cm = 0.01 world unit, so
// 100 units = 1 tile = 1 m. An item must fit within ~1 tile — most fill only a corner
// of it. The fine grid lets you articulate small detail (a 2 cm blade, a 4 cm shaft)
// while the whole thing stays sub-tile. This is the ITEM model (real geometry the
// player holds / that lies on the ground) — separate from the HUD icon (SDF for now,
// pixel_icon/cutout later). A dropped item is anchored at its CENTRE on the ground
// (x,z) and built UP from baseY.
import { Scene3D } from '@reactjit/primitives';

export const CM = 0.01;
// `yaw` spins the whole item about its anchor (radians). 0 = its authored pose lying
// flat on the ground; held items pass the player's facing so the item points forward.
export type ItemAnchor = { x: number; z: number; baseY: number; yaw?: number };

type ItemBox = {
  x?: number; y?: number; z?: number; // cm offsets from anchor (centre / ground)
  w: number; h: number; d: number;    // cm dimensions
  geometry?: 'box' | 'cylinder';
  radius?: number;                     // cm, for cylinder
};

// Place one cm-space part at the item's world anchor, rotated by the anchor's yaw.
export function itemBox(a: ItemAnchor, b: ItemBox, color: string) {
  const yaw = a.yaw ?? 0;
  const ox = (b.x ?? 0) * CM, oz = (b.z ?? 0) * CM;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const common = {
    material: color,
    rotation: [0, yaw, 0] as [number, number, number],
    position: [a.x + ox * cos - oz * sin, a.baseY + (b.y ?? 0) * CM, a.z + ox * sin + oz * cos] as [number, number, number],
  };
  if (b.geometry === 'cylinder') {
    return <Scene3D.Mesh geometry="cylinder" {...common} radius={(b.radius ?? b.w / 2) * CM} sizeY={b.h * CM} />;
  }
  return <Scene3D.Mesh geometry="box" {...common} sizeX={b.w * CM} sizeY={b.h * CM} sizeZ={b.d * CM} />;
}
