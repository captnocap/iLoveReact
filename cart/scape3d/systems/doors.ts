// Doors — stateful world objects driven BY the action menu (the first real
// consumer of systems/actions.ts). A door sits in a carved Door-gap tile in a
// building wall. Closed = blocks movement (the building is a sealed shell);
// open = passable. The door leaf renders as a sprite (render/sprites.ts), open
// vs closed by tint. (LoS-through-when-open and walkable interiors come later,
// alongside the perception system — see [[project_scape_action_menu]].)

import { CITY_DOORS } from '../world/citymap';

export interface Door {
  id: string;
  x: number; // tile coords (integer)
  y: number;
  open: boolean;
}

export function buildDoors(): Door[] {
  return CITY_DOORS.map((d, i) => ({ id: `door-${i}`, x: d.x, y: d.y, open: false }));
}

/** Tile keys ("x,y") of every CLOSED door — folded into the pathfinding blockers. */
export function closedDoorBlockers(doors: Door[]): string[] {
  return doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`);
}

/** The door nearest a world point, within `maxDist` tiles (for click targeting). */
export function nearestDoor(doors: Door[], wx: number, wy: number, maxDist: number): Door | null {
  let best: Door | null = null;
  let bestD = maxDist;
  for (const d of doors) {
    const dist = Math.hypot(d.x + 0.5 - wx, d.y + 0.5 - wy);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

export function toggleDoor(door: Door): void {
  door.open = !door.open;
}
