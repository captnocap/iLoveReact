import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Graph, Pressable, Text } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';

type Vec = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type TileKind = 'grass' | 'path' | 'plaza' | 'water' | 'field' | 'stone';
type ThingKind = 'tree' | 'rock' | 'stall' | 'npc' | 'obelisk';
type Thing = { id: string; kind: ThingKind; x: number; y: number; color?: string };
type KeyName = 'w' | 'a' | 's' | 'd';

const WORLD_W = 32;
const WORLD_H = 32;
const TILE_PX = 34;
const PLAYER_SPEED = 4.4;
const KEY_ROTATE_SPEED = 1.75;
const PITCH_SPEED = 0.7;

const COLORS: Record<TileKind, string> = {
  grass: '#3c7b46',
  path: '#a1774b',
  plaza: '#8f8f78',
  water: '#276f8f',
  field: '#8a943c',
  stone: '#686f76',
};

const SHADOW = '#17251d99';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dist(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function tileKind(x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return 'water';
  if (x <= 5 && y >= 19) return 'water';
  if (x >= 22 && y <= 9) return 'field';
  if (x >= 11 && x <= 18 && y >= 12 && y <= 18) return 'plaza';
  if (x === 14 || x === 15 || y === 15 || (x >= 8 && x <= 24 && y === 8)) return 'path';
  if ((x >= 3 && x <= 8 && y >= 3 && y <= 7) || (x >= 24 && x <= 28 && y >= 18 && y <= 23)) return 'stone';
  return 'grass';
}

function makeThings(): Thing[] {
  const things: Thing[] = [
    { id: 'obelisk', kind: 'obelisk', x: 14.5, y: 15.5 },
    { id: 'stall-1', kind: 'stall', x: 12.5, y: 13.5, color: '#b94638' },
    { id: 'stall-2', kind: 'stall', x: 17.5, y: 13.5, color: '#d09a35' },
    { id: 'stall-3', kind: 'stall', x: 12.5, y: 17.5, color: '#346ba6' },
    { id: 'npc-guard', kind: 'npc', x: 16.5, y: 15.5, color: '#cfb36f' },
    { id: 'npc-merchant', kind: 'npc', x: 13.5, y: 14.5, color: '#b65f3a' },
    { id: 'npc-fisher', kind: 'npc', x: 6.5, y: 21.5, color: '#6896a8' },
    { id: 'rock-1', kind: 'rock', x: 4.5, y: 5.5 },
    { id: 'rock-2', kind: 'rock', x: 6.5, y: 4.5 },
    { id: 'rock-3', kind: 'rock', x: 26.5, y: 20.5 },
  ];

  let treeId = 0;
  for (let y = 2; y < WORLD_H - 2; y += 3) {
    for (let x = 2; x < WORLD_W - 2; x += 4) {
      const kind = tileKind(x, y);
      if (kind !== 'grass') continue;
      if ((x + y * 3) % 7 === 0 || (x * 5 + y) % 11 === 0) {
        things.push({ id: `tree-${treeId++}`, kind: 'tree', x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return things;
}

function makeBlocked(things: Thing[]): Set<string> {
  const blocked = new Set<string>();
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const kind = tileKind(x, y);
      if (kind === 'water' || kind === 'stone') blocked.add(keyOf(x, y));
    }
  }
  for (const thing of things) {
    if (thing.kind === 'tree' || thing.kind === 'rock' || thing.kind === 'stall' || thing.kind === 'obelisk') {
      blocked.add(keyOf(Math.floor(thing.x), Math.floor(thing.y)));
    }
  }
  return blocked;
}

function isWalkable(x: number, y: number, blocked: Set<string>): boolean {
  return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H && !blocked.has(keyOf(x, y));
}

function nearestWalkable(goal: Vec, blocked: Set<string>): Vec | null {
  const gx = clamp(Math.floor(goal.x), 0, WORLD_W - 1);
  const gy = clamp(Math.floor(goal.y), 0, WORLD_H - 1);
  if (isWalkable(gx, gy, blocked)) return { x: gx, y: gy };

  for (let radius = 1; radius <= 6; radius++) {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let y = gy - radius; y <= gy + radius; y++) {
      for (let x = gx - radius; x <= gx + radius; x++) {
        if (!isWalkable(x, y, blocked)) continue;
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

function findPath(start: Vec, rawGoal: Vec, blocked: Set<string>): Vec[] {
  const sx = clamp(Math.floor(start.x), 0, WORLD_W - 1);
  const sy = clamp(Math.floor(start.y), 0, WORLD_H - 1);
  const goal = nearestWalkable(rawGoal, blocked);
  if (!goal || !isWalkable(sx, sy, blocked)) return [];

  const startKey = keyOf(sx, sy);
  const goalKey = keyOf(goal.x, goal.y);
  if (startKey === goalKey) return [{ x: goal.x + 0.5, y: goal.y + 0.5 }];

  const open: string[] = [startKey];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, Math.abs(goal.x - sx) + Math.abs(goal.y - sy)]]);
  const closed = new Set<string>();
  const dirs = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.42], [1, -1, 1.42], [-1, 1, 1.42], [-1, -1, 1.42],
  ];

  while (open.length > 0) {
    let bestIndex = 0;
    let bestScore = fScore.get(open[0]) ?? Infinity;
    for (let i = 1; i < open.length; i++) {
      const score = fScore.get(open[i]) ?? Infinity;
      if (score < bestScore) {
        bestIndex = i;
        bestScore = score;
      }
    }

    const current = open.splice(bestIndex, 1)[0];
    if (current === goalKey) {
      const tiles: Vec[] = [];
      let cursor = current;
      while (cursor !== startKey) {
        const [x, y] = cursor.split(',').map(Number);
        tiles.push({ x: x + 0.5, y: y + 0.5 });
        cursor = cameFrom.get(cursor) ?? startKey;
      }
      tiles.reverse();
      return tiles;
    }

    closed.add(current);
    const [cx, cy] = current.split(',').map(Number);
    for (const [dx, dy, cost] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny, blocked)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(cx + dx, cy, blocked) || !isWalkable(cx, cy + dy, blocked))) continue;
      const nKey = keyOf(nx, ny);
      if (closed.has(nKey)) continue;
      const tentative = (gScore.get(current) ?? Infinity) + cost;
      if (tentative >= (gScore.get(nKey) ?? Infinity)) continue;
      cameFrom.set(nKey, current);
      gScore.set(nKey, tentative);
      fScore.set(nKey, tentative + Math.abs(goal.x - nx) + Math.abs(goal.y - ny));
      if (!open.includes(nKey)) open.push(nKey);
    }
  }

  return [];
}

function centerFor(rect: Rect): Vec {
  return { x: rect.width * 0.5, y: rect.height * 0.55 };
}

function project(world: Vec, player: Vec, yaw: number, pitch: number, zoom: number, rect: Rect): Vec & { depth: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = world.x - player.x;
  const dy = world.y - player.y;
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  const center = centerFor(rect);
  return {
    x: center.x + rx * TILE_PX * zoom,
    y: center.y + ry * TILE_PX * zoom * pitch,
    depth: ry,
  };
}

function unproject(screen: Vec, player: Vec, yaw: number, pitch: number, zoom: number, rect: Rect): Vec {
  const center = centerFor(rect);
  const rx = (screen.x - center.x) / (TILE_PX * zoom);
  const ry = (screen.y - center.y) / (TILE_PX * zoom * pitch);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: player.x + rx * c + ry * s,
    y: player.y - rx * s + ry * c,
  };
}

function tilePath(x: number, y: number, player: Vec, yaw: number, pitch: number, zoom: number, rect: Rect): { d: string; depth: number; visible: boolean } {
  const pts = [
    project({ x, y }, player, yaw, pitch, zoom, rect),
    project({ x: x + 1, y }, player, yaw, pitch, zoom, rect),
    project({ x: x + 1, y: y + 1 }, player, yaw, pitch, zoom, rect),
    project({ x, y: y + 1 }, player, yaw, pitch, zoom, rect),
  ];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  return {
    d: `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)} L ${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)} L ${pts[3].x.toFixed(1)} ${pts[3].y.toFixed(1)} Z`,
    depth: (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) * 0.25,
    visible: maxX >= -80 && minX <= rect.width + 80 && maxY >= -80 && minY <= rect.height + 100,
  };
}

function shiftedColor(kind: TileKind, x: number, y: number): string {
  if (kind === 'path' && (x + y) % 3 === 0) return '#ad8152';
  if (kind === 'plaza' && (x + y) % 2 === 0) return '#7f846f';
  if (kind === 'grass' && (x * 13 + y * 7) % 5 === 0) return '#47884f';
  if (kind === 'field' && (x + y) % 2 === 0) return '#76853a';
  if (kind === 'water' && (x + y) % 2 === 0) return '#1f607c';
  return COLORS[kind];
}

function useKeyboard(keysRef: any) {
  useEffect(() => {
    const apply = (ev: any, down: boolean) => {
      const key = String(ev?.key ?? '').toLowerCase();
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        keysRef.current[key as KeyName] = down;
      }
    };
    const offDown = busOn('__keydown', (ev) => apply(ev, true));
    const offUp = busOn('__keyup', (ev) => apply(ev, false));
    return () => {
      offDown();
      offUp();
    };
  }, [keysRef]);
}

function MiniMap({ player, path, yaw, blocked }: { player: Vec; path: Vec[]; yaw: number; blocked: Set<string> }) {
  const size = 128;
  const cell = size / WORLD_W;
  const px = player.x * cell;
  const py = player.y * cell;
  const end = path.length > 0 ? path[path.length - 1] : null;
  const cameraX = px + Math.sin(yaw) * 13;
  const cameraY = py - Math.cos(yaw) * 13;
  const cells = [];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const kind = tileKind(x, y);
      const color = blocked.has(keyOf(x, y))
        ? '#29313a'
        : kind === 'water'
          ? '#2e7795'
          : kind === 'path' || kind === 'plaza'
            ? '#a98d5d'
            : '#477447';
      cells.push(<Box key={`${x}-${y}`} style={{ position: 'absolute', left: x * cell, top: y * cell, width: cell + 0.2, height: cell + 0.2, backgroundColor: color }} />);
    }
  }

  return (
    <Box style={{ position: 'absolute', right: 20, top: 20, width: size, height: size, backgroundColor: '#101820dd', borderWidth: 2, borderColor: '#e0c36e', padding: 3 }}>
      {cells}
      {end ? <Box style={{ position: 'absolute', left: end.x * cell - 3, top: end.y * cell - 3, width: 6, height: 6, backgroundColor: '#f2d36b' }} /> : null}
      <Graph style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
        <Graph.Path d={`M ${px.toFixed(1)} ${py.toFixed(1)} L ${cameraX.toFixed(1)} ${cameraY.toFixed(1)}`} stroke="#f5e7b0" strokeWidth={2} />
      </Graph>
      <Box style={{ position: 'absolute', left: px - 3, top: py - 3, width: 7, height: 7, backgroundColor: '#f5f0d0', borderWidth: 1, borderColor: '#1c1b16' }} />
    </Box>
  );
}

function PixelTree({ left, top, scale }: { left: number; top: number; scale: number }) {
  const u = scale;
  return (
    <Box style={{ position: 'absolute', left, top, width: 18 * u, height: 28 * u }}>
      <Box style={{ position: 'absolute', left: 7 * u, top: 15 * u, width: 5 * u, height: 13 * u, backgroundColor: '#6f4728' }} />
      <Box style={{ position: 'absolute', left: 2 * u, top: 8 * u, width: 14 * u, height: 12 * u, backgroundColor: '#235f35' }} />
      <Box style={{ position: 'absolute', left: 5 * u, top: 3 * u, width: 10 * u, height: 9 * u, backgroundColor: '#2f7d3f' }} />
      <Box style={{ position: 'absolute', left: 0, top: 12 * u, width: 7 * u, height: 8 * u, backgroundColor: '#1b4d2b' }} />
      <Box style={{ position: 'absolute', left: 11 * u, top: 12 * u, width: 7 * u, height: 8 * u, backgroundColor: '#1f5d32' }} />
      <Box style={{ position: 'absolute', left: 8 * u, top: 5 * u, width: 4 * u, height: 4 * u, backgroundColor: '#6bbb58' }} />
    </Box>
  );
}

function PixelRock({ left, top, scale }: { left: number; top: number; scale: number }) {
  const u = scale;
  return (
    <Box style={{ position: 'absolute', left, top, width: 18 * u, height: 13 * u }}>
      <Box style={{ position: 'absolute', left: 2 * u, top: 5 * u, width: 14 * u, height: 8 * u, backgroundColor: '#5d666d' }} />
      <Box style={{ position: 'absolute', left: 5 * u, top: 2 * u, width: 10 * u, height: 5 * u, backgroundColor: '#7e878c' }} />
      <Box style={{ position: 'absolute', left: 8 * u, top: 3 * u, width: 4 * u, height: 3 * u, backgroundColor: '#b2b9b7' }} />
    </Box>
  );
}

function PixelStall({ left, top, scale, color }: { left: number; top: number; scale: number; color: string }) {
  const u = scale;
  return (
    <Box style={{ position: 'absolute', left, top, width: 28 * u, height: 23 * u }}>
      <Box style={{ position: 'absolute', left: 4 * u, top: 10 * u, width: 20 * u, height: 12 * u, backgroundColor: '#5c3424' }} />
      <Box style={{ position: 'absolute', left: 1 * u, top: 4 * u, width: 26 * u, height: 8 * u, backgroundColor: color }} />
      <Box style={{ position: 'absolute', left: 5 * u, top: 4 * u, width: 5 * u, height: 8 * u, backgroundColor: '#f2d36b' }} />
      <Box style={{ position: 'absolute', left: 15 * u, top: 4 * u, width: 5 * u, height: 8 * u, backgroundColor: '#f2d36b' }} />
      <Box style={{ position: 'absolute', left: 9 * u, top: 14 * u, width: 10 * u, height: 5 * u, backgroundColor: '#d2ac68' }} />
    </Box>
  );
}

function PixelNpc({ left, top, scale, color }: { left: number; top: number; scale: number; color: string }) {
  const u = scale;
  return (
    <Box style={{ position: 'absolute', left, top, width: 12 * u, height: 20 * u }}>
      <Box style={{ position: 'absolute', left: 3 * u, top: 1 * u, width: 7 * u, height: 7 * u, backgroundColor: '#b98252' }} />
      <Box style={{ position: 'absolute', left: 2 * u, top: 8 * u, width: 9 * u, height: 8 * u, backgroundColor: color }} />
      <Box style={{ position: 'absolute', left: 3 * u, top: 16 * u, width: 3 * u, height: 4 * u, backgroundColor: '#372d28' }} />
      <Box style={{ position: 'absolute', left: 8 * u, top: 16 * u, width: 3 * u, height: 4 * u, backgroundColor: '#372d28' }} />
    </Box>
  );
}

function PixelObelisk({ left, top, scale }: { left: number; top: number; scale: number }) {
  const u = scale;
  return (
    <Box style={{ position: 'absolute', left, top, width: 24 * u, height: 42 * u }}>
      <Box style={{ position: 'absolute', left: 9 * u, top: 2 * u, width: 7 * u, height: 31 * u, backgroundColor: '#354455' }} />
      <Box style={{ position: 'absolute', left: 7 * u, top: 9 * u, width: 11 * u, height: 21 * u, backgroundColor: '#495b6d' }} />
      <Box style={{ position: 'absolute', left: 10 * u, top: 13 * u, width: 5 * u, height: 12 * u, backgroundColor: '#73c7c7' }} />
      <Box style={{ position: 'absolute', left: 4 * u, top: 33 * u, width: 17 * u, height: 7 * u, backgroundColor: '#252f3b' }} />
    </Box>
  );
}

function PixelPlayer({ rect, yaw, facing }: { rect: Rect; yaw: number; facing: number }) {
  const center = centerFor(rect);
  const u = 2.2;
  const rel = facing - yaw;
  const eyeX = Math.cos(rel) * 3.5 * u;
  const eyeY = Math.sin(rel) * 2.2 * u;
  const left = center.x - 10 * u;
  const top = center.y - 23 * u;
  return (
    <Box style={{ position: 'absolute', left, top, width: 20 * u, height: 28 * u }}>
      <Box style={{ position: 'absolute', left: 3 * u, top: 22 * u, width: 14 * u, height: 4 * u, backgroundColor: SHADOW }} />
      <Box style={{ position: 'absolute', left: 6 * u, top: 4 * u, width: 9 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
      <Box style={{ position: 'absolute', left: 5 * u + eyeX, top: 7 * u + eyeY, width: 3 * u, height: 2 * u, backgroundColor: '#1c2024' }} />
      <Box style={{ position: 'absolute', left: 4 * u, top: 12 * u, width: 12 * u, height: 11 * u, backgroundColor: '#2e6da4' }} />
      <Box style={{ position: 'absolute', left: 7 * u, top: 14 * u, width: 6 * u, height: 5 * u, backgroundColor: '#6fb3d2' }} />
      <Box style={{ position: 'absolute', left: 3 * u, top: 13 * u, width: 3 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
      <Box style={{ position: 'absolute', left: 15 * u, top: 13 * u, width: 3 * u, height: 8 * u, backgroundColor: '#d39b67' }} />
      <Box style={{ position: 'absolute', left: 6 * u, top: 22 * u, width: 4 * u, height: 5 * u, backgroundColor: '#202833' }} />
      <Box style={{ position: 'absolute', left: 12 * u, top: 22 * u, width: 4 * u, height: 5 * u, backgroundColor: '#202833' }} />
    </Box>
  );
}

function ThingSprite({ thing, player, yaw, pitch, zoom, rect }: { thing: Thing; player: Vec; yaw: number; pitch: number; zoom: number; rect: Rect }) {
  const p = project({ x: thing.x, y: thing.y }, player, yaw, pitch, zoom, rect);
  const distanceScale = clamp(1 + p.depth * 0.014, 0.78, 1.24);
  const u = clamp(zoom * distanceScale, 0.75, 2.1);
  const shadowW = thing.kind === 'stall' ? 32 * u : 18 * u;
  const shadowH = 7 * u;
  const shadowLeft = p.x - shadowW * 0.5;
  const shadowTop = p.y - shadowH * 0.35;

  let sprite: any = null;
  if (thing.kind === 'tree') sprite = <PixelTree left={p.x - 9 * u} top={p.y - 27 * u} scale={u} />;
  if (thing.kind === 'rock') sprite = <PixelRock left={p.x - 9 * u} top={p.y - 12 * u} scale={u} />;
  if (thing.kind === 'stall') sprite = <PixelStall left={p.x - 14 * u} top={p.y - 22 * u} scale={u} color={thing.color ?? '#b94638'} />;
  if (thing.kind === 'npc') sprite = <PixelNpc left={p.x - 6 * u} top={p.y - 20 * u} scale={u} color={thing.color ?? '#cfb36f'} />;
  if (thing.kind === 'obelisk') sprite = <PixelObelisk left={p.x - 12 * u} top={p.y - 40 * u} scale={u} />;

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: rect.width, height: rect.height }}>
      <Box style={{ position: 'absolute', left: shadowLeft, top: shadowTop, width: shadowW, height: shadowH, backgroundColor: SHADOW }} />
      {sprite}
    </Box>
  );
}

function Hud({ yaw, pitch, walking }: { yaw: number; pitch: number; walking: boolean }) {
  const deg = Math.round((((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * 180 / Math.PI);
  return (
    <Box style={{ position: 'absolute', left: 20, top: 20, width: 168, backgroundColor: '#101820dd', borderWidth: 2, borderColor: '#e0c36e', padding: 10, gap: 6 }}>
      <Text style={{ color: '#f4e8bf', fontSize: 14, fontWeight: '700' }}>CLICKSCAPE</Text>
      <Text style={{ color: '#bac8b8', fontSize: 11 }}>CAM {String(deg).padStart(3, '0')}</Text>
      <Text style={{ color: '#bac8b8', fontSize: 11 }}>TILT {Math.round(pitch * 100)}</Text>
      <Text style={{ color: walking ? '#f2d36b' : '#8fa18e', fontSize: 11 }}>{walking ? 'PATHING' : 'IDLE'}</Text>
    </Box>
  );
}

export default function ClickscapeMvp() {
  const things = useMemo(() => makeThings(), []);
  const blocked = useMemo(() => makeBlocked(things), [things]);
  const keysRef = useRef<Record<KeyName, boolean>>({ w: false, a: false, s: false, d: false });
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1120, height: 720 });
  const simRef = useRef({
    player: { x: 14.5, y: 11.5 },
    yaw: Math.PI * 0.25,
    pitch: 0.64,
    zoom: 1.12,
    path: [] as Vec[],
    facing: Math.PI * 0.5,
    pulse: 0,
  });
  const [view, setView] = useState(() => ({ ...simRef.current, player: { ...simRef.current.player }, path: [] as Vec[] }));

  useKeyboard(keysRef);

  useEffect(() => {
    let last = Number((globalThis as any).performance?.now?.() ?? Date.now());
    const id = setInterval(() => {
      const now = Number((globalThis as any).performance?.now?.() ?? Date.now());
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const sim = simRef.current;
      const keys = keysRef.current;

      if (keys.a) sim.yaw -= KEY_ROTATE_SPEED * dt;
      if (keys.d) sim.yaw += KEY_ROTATE_SPEED * dt;
      if (keys.w) sim.pitch += PITCH_SPEED * dt;
      if (keys.s) sim.pitch -= PITCH_SPEED * dt;
      sim.pitch = clamp(sim.pitch, 0.42, 0.86);
      sim.pulse += dt;

      if (sim.path.length > 0) {
        const next = sim.path[0];
        const d = dist(sim.player, next);
        if (d <= PLAYER_SPEED * dt) {
          sim.player = { ...next };
          sim.path = sim.path.slice(1);
        } else {
          const t = (PLAYER_SPEED * dt) / d;
          sim.facing = Math.atan2(next.y - sim.player.y, next.x - sim.player.x);
          sim.player = {
            x: sim.player.x + (next.x - sim.player.x) * t,
            y: sim.player.y + (next.y - sim.player.y) * t,
          };
        }
      }

      setView({
        player: { ...sim.player },
        yaw: sim.yaw,
        pitch: sim.pitch,
        zoom: sim.zoom,
        path: sim.path.slice(0),
        facing: sim.facing,
        pulse: sim.pulse,
      });
    }, 33);
    return () => clearInterval(id);
  }, []);

  const handleMouseDown = (payload: any) => {
    const rect = rectRef.current;
    const sx = Number(payload?.x ?? 0) - rect.x;
    const sy = Number(payload?.y ?? 0) - rect.y;
    if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) return;
    if (sx < 210 && sy < 125) return;
    if (sx > rect.width - 170 && sy < 170) return;
    const world = unproject({ x: sx, y: sy }, simRef.current.player, simRef.current.yaw, simRef.current.pitch, simRef.current.zoom, rect);
    const path = findPath(simRef.current.player, world, blocked);
    simRef.current.path = path;
    if (path.length > 0) {
      simRef.current.facing = Math.atan2(path[0].y - simRef.current.player.y, path[0].x - simRef.current.player.x);
    }
  };

  const rect = rectRef.current;
  const groundTiles = [];
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const path = tilePath(x, y, view.player, view.yaw, view.pitch, view.zoom, rect);
      if (!path.visible) continue;
      const kind = tileKind(x, y);
      const opacity = kind === 'water' ? 0.94 : 1;
      groundTiles.push({ x, y, kind, d: path.d, depth: path.depth, opacity });
    }
  }
  groundTiles.sort((a, b) => a.depth - b.depth);

  const pathMarkers = view.path.map((step, i) => {
    const p = project(step, view.player, view.yaw, view.pitch, view.zoom, rect);
    const size = i === view.path.length - 1 ? 9 : 5;
    return { key: `${i}-${step.x}-${step.y}`, x: p.x - size * 0.5, y: p.y - size * 0.5, size, opacity: i === 0 ? 0.9 : 0.62 };
  });

  const visibleThings = things
    .map((thing) => ({ thing, p: project({ x: thing.x, y: thing.y }, view.player, view.yaw, view.pitch, view.zoom, rect) }))
    .filter((entry) => entry.p.x >= -100 && entry.p.x <= rect.width + 100 && entry.p.y >= -120 && entry.p.y <= rect.height + 90)
    .sort((a, b) => a.p.y - b.p.y);

  const center = centerFor(rect);
  const pulseSize = 22 + Math.sin(view.pulse * 6) * 3;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0e1518' }}>
      <Pressable
        onLayout={(r: any) => { rectRef.current = { x: r.x, y: r.y, width: r.width, height: r.height }; }}
        onMouseDown={handleMouseDown}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#0e1518' }}
      >
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: rect.width, height: rect.height }}>
          <Graph.Path d={`M 0 0 L ${rect.width} 0 L ${rect.width} ${rect.height} L 0 ${rect.height} Z`} fill="#10191f" />
          {groundTiles.map((tile) => (
            <Graph.Path
              key={`${tile.x}-${tile.y}`}
              d={tile.d}
              fill={shiftedColor(tile.kind, tile.x, tile.y)}
              fillOpacity={tile.opacity}
              stroke={tile.kind === 'water' ? '#19546f' : '#233025'}
              strokeWidth={tile.kind === 'plaza' ? 1.3 : 0.8}
            />
          ))}
        </Graph>

        {view.path.length > 0 ? (
          <Graph style={{ position: 'absolute', left: 0, top: 0, width: rect.width, height: rect.height }}>
            <Graph.Path
              d={`M ${(center.x - pulseSize * 0.5).toFixed(1)} ${center.y.toFixed(1)} L ${center.x.toFixed(1)} ${(center.y - pulseSize * 0.38).toFixed(1)} L ${(center.x + pulseSize * 0.5).toFixed(1)} ${center.y.toFixed(1)} L ${center.x.toFixed(1)} ${(center.y + pulseSize * 0.38).toFixed(1)} Z`}
              fill="#f2d36b"
              fillOpacity={0.2}
              stroke="#f2d36b"
              strokeWidth={1.5}
            />
          </Graph>
        ) : null}

        {pathMarkers.map((m) => (
          <Box key={m.key} style={{ position: 'absolute', left: m.x, top: m.y, width: m.size, height: m.size, backgroundColor: '#f2d36b', opacity: m.opacity }} />
        ))}

        {visibleThings.map(({ thing }) => (
          <ThingSprite key={thing.id} thing={thing} player={view.player} yaw={view.yaw} pitch={view.pitch} zoom={view.zoom} rect={rect} />
        ))}

        <PixelPlayer rect={rect} yaw={view.yaw} facing={view.facing} />
        <Hud yaw={view.yaw} pitch={view.pitch} walking={view.path.length > 0} />
        <MiniMap player={view.player} path={view.path} yaw={view.yaw} blocked={blocked} />
      </Pressable>
    </Box>
  );
}
