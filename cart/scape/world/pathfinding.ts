import { decorAt, Kind, tileAt } from './tiles';

export function blockedAt(x: number, y: number, staticBlockers: Set<string>): boolean {
  const k = tileAt(x, y);
  if (k < 0 || k === Kind.Water || k === Kind.Wall) return true; // k<0 = outside the city
  if (decorAt(x, y)) return true;
  return staticBlockers.has(`${x},${y}`);
}

export function walkable(x: number, y: number, staticBlockers: Set<string>): boolean {
  return !blockedAt(x, y, staticBlockers);
}

export function nearestWalkable(gx: number, gy: number, staticBlockers: Set<string>) {
  if (walkable(gx, gy, staticBlockers)) return { x: gx, y: gy };
  for (let rad = 1; rad <= 6; rad++) {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let y = gy - rad; y <= gy + rad; y++) {
      for (let x = gx - rad; x <= gx + rad; x++) {
        if (!walkable(x, y, staticBlockers)) continue;
        const d = Math.abs(x - gx) + Math.abs(y - gy);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.42],
  [1, -1, 1.42],
  [-1, 1, 1.42],
  [-1, -1, 1.42],
];

const MAX_PATH = 48;
const MAX_EXPAND = 6000;

export function findPath(sx0: number, sy0: number, gx0: number, gy0: number, staticBlockers: Set<string>) {
  const sx = Math.floor(sx0);
  const sy = Math.floor(sy0);
  let gx = Math.floor(gx0);
  let gy = Math.floor(gy0);
  const gd = Math.hypot(gx - sx, gy - sy);
  if (gd > MAX_PATH) {
    gx = sx + Math.round(((gx - sx) / gd) * MAX_PATH);
    gy = sy + Math.round(((gy - sy) / gd) * MAX_PATH);
  }
  const goal = nearestWalkable(gx, gy, staticBlockers);
  if (!goal || !walkable(sx, sy, staticBlockers)) return [];
  const sk = `${sx},${sy}`;
  const gk = `${goal.x},${goal.y}`;
  if (sk === gk) return [{ x: goal.x + 0.5, y: goal.y + 0.5 }];
  const open: string[] = [sk];
  const came = new Map<string, string>();
  const g = new Map<string, number>([[sk, 0]]);
  const f = new Map<string, number>([[sk, Math.abs(goal.x - sx) + Math.abs(goal.y - sy)]]);
  const closed = new Set<string>();
  while (open.length && closed.size < MAX_EXPAND) {
    let bi = 0;
    let bs = f.get(open[0]) ?? Infinity;
    for (let i = 1; i < open.length; i++) {
      const sc = f.get(open[i]) ?? Infinity;
      if (sc < bs) {
        bs = sc;
        bi = i;
      }
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === gk) {
      const out: { x: number; y: number }[] = [];
      let c = cur;
      while (c !== sk) {
        const [x, y] = c.split(',').map(Number);
        out.push({ x: x + 0.5, y: y + 0.5 });
        c = came.get(c) ?? sk;
      }
      return out.reverse();
    }
    closed.add(cur);
    const [cx, cy] = cur.split(',').map(Number);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(nx, ny, staticBlockers)) continue;
      if (dx && dy && (!walkable(cx + dx, cy, staticBlockers) || !walkable(cx, cy + dy, staticBlockers))) continue;
      const nk = `${nx},${ny}`;
      if (closed.has(nk)) continue;
      const tentative = (g.get(cur) ?? Infinity) + cost;
      if (tentative >= (g.get(nk) ?? Infinity)) continue;
      came.set(nk, cur);
      g.set(nk, tentative);
      f.set(nk, tentative + Math.abs(goal.x - nx) + Math.abs(goal.y - ny));
      if (!open.includes(nk)) open.push(nk);
    }
  }
  return [];
}
