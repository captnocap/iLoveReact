import { centerX, centerY, hazeOpacity, project, type Cam, type Rect } from '../world/projection';
import { HEADER, MAX_SPRITES, WIN, type Decor } from '../world/window';
import type { Ent } from '../state/world';
import type { ScapePlayerState } from '../state/player';
import { type InventoryState, type WorldItem, worldItemSlot } from '../systems/inventory';
import type { Door } from '../systems/doors';

export const SK_PALM = 0;
export const SK_DUMPSTER = 1;
export const SK_STORE = 2;
export const SK_SIGN = 3;
export const SK_NPC = 4;
export const SK_DOOR = 5;
export const SK_DOT = 6;
export const SK_TARGET = 7;

export function kindCode(k: string): number {
  return k === 'palm'
    ? SK_PALM
    : k === 'dumpster'
      ? SK_DUMPSTER
      : k === 'storefront'
        ? SK_STORE
        : k === 'sign'
          ? SK_SIGN
          : SK_NPC;
}

function itemSprite(item: WorldItem, inventory: InventoryState) {
  const slot = worldItemSlot(inventory, item);
  if (!slot) return null;
  return {
    kind: 'item',
    x: item.x,
    y: item.y,
    spriteKind: slot.module.world.spriteKind,
    tint: slot.module.world.tint ?? 0,
  };
}

export type ScapeFrame = {
  data: number[];
  spriteN: number;
  bob: number;
  deg: number;
  playerCx: number;
  playerCy: number;
  playerRel: number;
};

export function createScapeFrame({
  sim,
  rect,
  cam,
  winOX,
  winOY,
  winTiles,
  decorList,
  entities,
  inventory,
  doors,
}: {
  sim: ScapePlayerState;
  rect: Rect;
  cam: Cam;
  winOX: number;
  winOY: number;
  winTiles: number[];
  decorList: Decor[];
  entities: Ent[];
  inventory: InventoryState;
  doors: Door[];
}): ScapeFrame {
  const doorSprites = doors.map((d) => ({ kind: 'door', x: d.x + 0.5, y: d.y + 0.5, spriteKind: SK_DOOR, tint: d.open ? 1 : 0 }));
  const visible = (decorList as any[])
    .concat(entities as any[])
    .concat(doorSprites as any[])
    .concat(inventory.worldItems.map((item) => itemSprite(item, inventory)).filter(Boolean) as any[])
    .map((e: any) => {
      const p = project(e.x, e.y, cam, rect);
      return { e, p, op: 1 - hazeOpacity(p.depth) };
    })
    .filter((o) => o.op > 0.03 && o.p.x > -120 && o.p.x < rect.width + 120 && o.p.y > -180 && o.p.y < rect.height + 120)
    .sort((a, b) => Math.abs(a.p.depth) - Math.abs(b.p.depth))
    .slice(0, MAX_SPRITES)
    .sort((a, b) => a.p.y - b.p.y);

  const spriteBuf: number[] = [];
  for (let i = 0; i < sim.path.length; i++) {
    const p = project(sim.path[i].x, sim.path[i].y, cam, rect);
    spriteBuf.push(p.x, p.y, i === sim.path.length - 1 ? SK_TARGET : SK_DOT, 0, 1 - hazeOpacity(p.depth));
  }
  for (const o of visible) spriteBuf.push(o.p.x, o.p.y, o.e.spriteKind ?? kindCode(o.e.kind), o.e.tint ?? 0, o.op);
  const spriteN = spriteBuf.length / 5;

  const head = new Array<number>(HEADER).fill(0);
  head[0] = sim.px;
  head[1] = sim.py;
  head[2] = sim.yaw;
  head[3] = sim.pitch;
  head[4] = sim.zoom;
  head[5] = 30;
  head[6] = winOX;
  head[7] = winOY;
  head[8] = WIN;
  head[9] = spriteN;
  head[10] = sim.body.high;

  const nowMs = (globalThis as any).performance?.now?.() ?? 0;
  return {
    data: head.concat(winTiles, spriteBuf),
    spriteN,
    bob: sim.path.length ? Math.sin(nowMs * 0.012) * 3 : 0,
    deg: Math.round(((((sim.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 180) / Math.PI),
    playerCx: centerX(rect),
    playerCy: centerY(rect),
    playerRel: sim.body.facing - sim.yaw,
  };
}
