import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Canvas, Col, Row, Text } from '@reactjit/runtime/primitives';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';

// ── Constants ───────────────────────────────────────────────────────────

const TILE = 32;
const WORLD_W = 64;
const WORLD_H = 64;
const VIEW_W = 1280;
const VIEW_H = 860;
const CHUNK = 8;

const C = {
  grass: '#5d8a3e', grass2: '#528234',
  water: '#4a90a4', water2: '#3d7d8f',
  dirt: '#a08b6d', dirt2: '#947f62',
  stone: '#8a8a8a', stone2: '#7d7d7d',
  sand: '#d4c594', sand2: '#c9b888',
  wood: '#5c3a1e',
  leaves: '#2d5a1e', leaves2: '#366822',
  playerBody: '#3b82f6', playerHead: '#f5d0a9',
  npc1: '#c44b4b', npc2: '#4b7cc4', npc3: '#7cc44b', npc4: '#c4a44b',
  shadow: '#00000044',
  uiBg: '#1a1a1a', uiPanel: '#2a2a2a', uiBorder: '#444444',
  hp: '#ef4444', xp: '#3b82f6', energy: '#22c55e',
};

// ── Types ───────────────────────────────────────────────────────────────

 type Tile = 'grass' | 'water' | 'dirt' | 'stone' | 'sand' | 'tree';
interface Entity {
  id: string; x: number; y: number; color: string;
  name: string; hp: number; maxHp: number;
  state: 'idle' | 'wander'; timer: number;
  tx?: number; ty?: number;
}
interface GameState {
  player: Entity; npcs: Entity[]; tick: number;
  messages: string[];
}

// ── World gen ───────────────────────────────────────────────────────────

function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateMap(seed: number): Tile[][] {
  const rand = mulberry32(seed);
  const map: Tile[][] = [];
  for (let y = 0; y < WORLD_H; y++) {
    map[y] = [];
    for (let x = 0; x < WORLD_W; x++) {
      const n = rand();
      if (n < 0.06) map[y][x] = 'water';
      else if (n < 0.10) map[y][x] = 'sand';
      else if (n < 0.16) map[y][x] = 'dirt';
      else if (n < 0.20) map[y][x] = 'stone';
      else if (n < 0.28) map[y][x] = 'tree';
      else map[y][x] = 'grass';
    }
  }
  // Clear spawn area (33,33)
  for (let y = 30; y < 37; y++) {
    for (let x = 30; x < 37; x++) {
      map[y][x] = 'grass';
    }
  }
  // A little pond near spawn
  map[28][29] = 'water'; map[28][30] = 'water'; map[29][29] = 'water';
  return map;
}

function tileColor(t: Tile, x: number, y: number): string {
  const alt = (x + y) % 2 === 1;
  switch (t) {
    case 'grass': return alt ? C.grass2 : C.grass;
    case 'water': return alt ? C.water2 : C.water;
    case 'dirt': return alt ? C.dirt2 : C.dirt;
    case 'stone': return alt ? C.stone2 : C.stone;
    case 'sand': return alt ? C.sand2 : C.sand;
    case 'tree': return alt ? C.grass2 : C.grass;
  }
}

function isSolid(t: Tile | undefined): boolean {
  return t === 'water' || t === 'tree';
}

// ── Sprites ─────────────────────────────────────────────────────────────

function TreeSprite() {
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Box style={{ position: 'absolute', bottom: 2, left: 10, width: 12, height: 16, backgroundColor: C.wood }} />
      <Box style={{ position: 'absolute', top: 0, left: 2, width: 28, height: 22, borderRadius: 6, backgroundColor: C.leaves, borderWidth: 1, borderColor: '#1a3a10' }} />
      <Box style={{ position: 'absolute', top: 4, left: 6, width: 10, height: 10, borderRadius: 4, backgroundColor: C.leaves2 }} />
    </Box>
  );
}

function PlayerSprite() {
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Box style={{ position: 'absolute', bottom: 0, left: 4, width: 24, height: 10, borderRadius: 12, backgroundColor: C.shadow }} />
      <Box style={{ position: 'absolute', bottom: 10, left: 8, width: 16, height: 18, backgroundColor: C.playerBody, borderWidth: 1, borderColor: '#1e3a5f' }} />
      <Box style={{ position: 'absolute', top: 0, left: 9, width: 14, height: 14, borderRadius: 4, backgroundColor: C.playerHead, borderWidth: 1, borderColor: '#8a6a4a' }} />
    </Box>
  );
}

function NpcSprite({ color }: { color: string }) {
  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Box style={{ position: 'absolute', bottom: 0, left: 4, width: 24, height: 10, borderRadius: 12, backgroundColor: C.shadow }} />
      <Box style={{ position: 'absolute', bottom: 10, left: 8, width: 16, height: 18, backgroundColor: color, borderWidth: 1, borderColor: '#222222' }} />
      <Box style={{ position: 'absolute', top: 0, left: 9, width: 14, height: 14, borderRadius: 4, backgroundColor: '#f5d0a9', borderWidth: 1, borderColor: '#8a6a4a' }} />
    </Box>
  );
}

function NameTag({ name, color }: { name: string; color: string }) {
  return (
    <Box style={{ position: 'absolute', top: -15, left: 0, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <Box style={{ paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1, borderRadius: 3, backgroundColor: '#000000aa' }}>
        <Text fontSize={9} color={color} style={{ fontWeight: 700 }}>{name}</Text>
      </Box>
    </Box>
  );
}

// ── Main ────────────────────────────────────────────────────────────────

export default function PixelMMO() {
  const [, setTick] = useState(0);
  const keysRef = useRef(new Set<string>());
  const map = useMemo(() => generateMap(42), []);

  const gameRef = useRef<GameState>({
    player: {
      id: 'p1', x: 33 * TILE + 8, y: 33 * TILE + 8, color: C.playerBody,
      name: 'You', hp: 100, maxHp: 100, state: 'idle', timer: 0,
    },
    npcs: [
      { id: 'npc1', x: 28 * TILE + 8, y: 30 * TILE + 8, color: C.npc1, name: 'Bob', hp: 80, maxHp: 80, state: 'idle', timer: 30 },
      { id: 'npc2', x: 38 * TILE + 8, y: 32 * TILE + 8, color: C.npc2, name: 'Alice', hp: 90, maxHp: 90, state: 'idle', timer: 60 },
      { id: 'npc3', x: 35 * TILE + 8, y: 28 * TILE + 8, color: C.npc3, name: 'Zorb', hp: 60, maxHp: 60, state: 'idle', timer: 90 },
      { id: 'npc4', x: 25 * TILE + 8, y: 35 * TILE + 8, color: C.npc4, name: 'Gurk', hp: 120, maxHp: 120, state: 'idle', timer: 120 },
    ],
    tick: 0,
    messages: ['Welcome to PixelScape!', 'Use WASD or Arrow Keys to move.', 'Press SPACE to talk to NPCs.'],
  });

  // Pre-build ground chunks
  const chunks = useMemo(() => {
    const result: JSX.Element[] = [];
    const chunksX = WORLD_W / CHUNK;
    const chunksY = WORLD_H / CHUNK;
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const children: JSX.Element[] = [];
        for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++) {
          for (let x = cx * CHUNK; x < (cx + 1) * CHUNK; x++) {
            const color = tileColor(map[y][x], x, y);
            children.push(
              <Box
                key={`g-${x}-${y}`}
                style={{
                  position: 'absolute',
                  left: (x % CHUNK) * TILE,
                  top: (y % CHUNK) * TILE,
                  width: TILE,
                  height: TILE,
                  backgroundColor: color,
                }}
              />
            );
          }
        }
        result.push(
          <Canvas.Node
            key={`chunk-${cx}-${cy}`}
            gx={cx * CHUNK * TILE}
            gy={cy * CHUNK * TILE}
            gw={CHUNK * TILE}
            gh={CHUNK * TILE}
          >
            <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
              {children}
            </Box>
          </Canvas.Node>
        );
      }
    }
    return result;
  }, [map]);

  // Pre-build trees
  const allTrees = useMemo(() => {
    const trees: { x: number; y: number; el: JSX.Element }[] = [];
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (map[y][x] === 'tree') {
          trees.push({
            x,
            y,
            el: (
              <Canvas.Node key={`tree-${x}-${y}`} gx={x * TILE} gy={y * TILE} gw={TILE} gh={TILE}>
                <TreeSprite />
              </Canvas.Node>
            ),
          });
        }
      }
    }
    return trees;
  }, [map]);

  // Game loop
  useEffect(() => {
    const interval = setInterval(() => {
      const game = gameRef.current;
      const keys = keysRef.current;

      // Player movement
      const speed = 2.2;
      let dx = 0;
      let dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = game.player.x + (dx / len) * speed;
        const ny = game.player.y + (dy / len) * speed;
        const tx = Math.floor((nx + 16) / TILE);
        const ty = Math.floor((ny + 24) / TILE);
        if (tx >= 0 && tx < WORLD_W && ty >= 0 && ty < WORLD_H) {
          const tile = map[ty]?.[tx];
          if (!isSolid(tile)) {
            game.player.x = nx;
            game.player.y = ny;
          }
        }
      }

      // NPC AI
      for (const npc of game.npcs) {
        npc.timer--;
        if (npc.timer <= 0) {
          if (npc.state === 'idle') {
            npc.state = 'wander';
            const angle = Math.random() * Math.PI * 2;
            const dist = 30 + Math.random() * 70;
            npc.tx = Math.max(8, Math.min((WORLD_W - 1) * TILE - 8, npc.x + Math.cos(angle) * dist));
            npc.ty = Math.max(8, Math.min((WORLD_H - 1) * TILE - 8, npc.y + Math.sin(angle) * dist));
            npc.timer = 60 + Math.random() * 90;
          } else {
            npc.state = 'idle';
            npc.timer = 40 + Math.random() * 80;
          }
        }
        if (npc.state === 'wander' && npc.tx != null && npc.ty != null) {
          const ddx = npc.tx - npc.x;
          const ddy = npc.ty - npc.y;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < 2) {
            npc.state = 'idle';
            npc.timer = 40;
          } else {
            const nx = npc.x + (ddx / dist) * 0.7;
            const ny = npc.y + (ddy / dist) * 0.7;
            const tx = Math.floor((nx + 16) / TILE);
            const ty = Math.floor((ny + 24) / TILE);
            if (tx >= 0 && tx < WORLD_W && ty >= 0 && ty < WORLD_H && !isSolid(map[ty]?.[tx])) {
              npc.x = nx;
              npc.y = ny;
            } else {
              npc.state = 'idle';
              npc.timer = 20;
            }
          }
        }
      }

      game.tick++;
      setTick(t => t + 1);
    }, 33);
    return () => clearInterval(interval);
  }, [map]);

  // Keyboard
  useEffect(() => {
    const down = busOn('__keydown', (ev: any) => {
      keysRef.current.add(ev.key);
      const game = gameRef.current;
      if (ev.key === 'space') {
        let talked = false;
        for (const npc of game.npcs) {
          const d = Math.hypot(npc.x - game.player.x, npc.y - game.player.y);
          if (d < 36) {
            const lines = ['Hello adventurer!', 'Nice weather today.', 'Watch out for goblins east!', 'Need any supplies?', 'I heard there is treasure in the north.'];
            game.messages.push(`${npc.name}: ${lines[Math.floor(Math.random() * lines.length)]}`);
            talked = true;
            break;
          }
        }
        if (!talked) {
          game.messages.push('You: ...');
        }
        if (game.messages.length > 8) game.messages.shift();
      }
    });
    const up = busOn('__keyup', (ev: any) => keysRef.current.delete(ev.key));
    return () => { down(); up(); };
  }, []);

  // Camera
  const camX = gameRef.current.player.x;
  const camY = gameRef.current.player.y;

  // Cull visible chunks
  const camLeft = camX - VIEW_W / 2;
  const camTop = camY - VIEW_H / 2;
  const camRight = camLeft + VIEW_W;
  const camBottom = camTop + VIEW_H;
  const chunkSize = CHUNK * TILE;
  const chunksX = WORLD_W / CHUNK;
  const chunksY = WORLD_H / CHUNK;

  const visibleChunks = chunks.filter((_, i) => {
    const cx = i % chunksX;
    const cy = Math.floor(i / chunksX);
    const cl = cx * chunkSize;
    const cr = cl + chunkSize;
    const ct = cy * chunkSize;
    const cb = ct + chunkSize;
    return cr >= camLeft && cl <= camRight && cb >= camTop && ct <= camBottom;
  });

  // Cull & sort trees + entities by Y for depth
  const visibleTrees = allTrees
    .filter(t => {
      const tl = t.x * TILE;
      const tr = tl + TILE;
      const tt = t.y * TILE;
      const tb = tt + TILE;
      return tr >= camLeft && tl <= camRight && tb >= camTop && tt <= camBottom;
    })
    .map(t => ({ y: t.y * TILE + TILE, el: t.el }));

  const { player, npcs, messages, tick } = gameRef.current;
  const bobP = Math.sin(tick * 0.4) * 2;

  const entityRenderables = [
    {
      y: player.y + 24,
      el: (
        <Canvas.Node key={player.id} gx={player.x - 16} gy={player.y - 30 + bobP} gw={32} gh={44}>
          <PlayerSprite />
          <NameTag name={player.name} color="#fbbf24" />
        </Canvas.Node>
      ),
    },
    ...npcs.map((npc, i) => {
      const bob = Math.sin((tick + i * 100) * 0.25) * 1.5;
      return {
        y: npc.y + 24,
        el: (
          <Canvas.Node key={npc.id} gx={npc.x - 16} gy={npc.y - 30 + bob} gw={32} gh={44}>
            <NpcSprite color={npc.color} />
            <NameTag name={npc.name} color="#e5e7eb" />
          </Canvas.Node>
        ),
      };
    }),
  ];

  const sortedRenderables = [...visibleTrees, ...entityRenderables].sort((a, b) => a.y - b.y);

  // Minimap entity positions (percent of world)
  const mmPlayerX = (player.x / (WORLD_W * TILE)) * 100;
  const mmPlayerY = (player.y / (WORLD_H * TILE)) * 100;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0a0a0a' }}>
      {/* World Viewport */}
      <Box style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, position: 'relative' }}>
        <Canvas style={{ width: '100%', height: '100%' }} viewX={camX} viewY={camY} viewZoom={1}>
          {visibleChunks}
          {sortedRenderables.map(r => r.el)}
        </Canvas>

        {/* Minimap */}
        <Box
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: C.uiBg,
            borderWidth: 2,
            borderColor: C.uiBorder,
            overflow: 'hidden',
          }}
        >
          <Box style={{ position: 'absolute', inset: 4, borderRadius: 56, backgroundColor: C.grass2 }}>
            {/* Player dot */}
            <Box
              style={{
                position: 'absolute',
                left: mmPlayerX - 2,
                top: mmPlayerY - 2,
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: '#fbbf24',
                borderWidth: 1,
                borderColor: '#ffffff',
              }}
            />
            {/* NPC dots */}
            {npcs.map(npc => (
              <Box
                key={`mm-${npc.id}`}
                style={{
                  position: 'absolute',
                  left: (npc.x / (WORLD_W * TILE)) * 100 - 1.5,
                  top: (npc.y / (WORLD_H * TILE)) * 100 - 1.5,
                  width: 3,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: npc.color,
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Stats panel */}
        <Box style={{ position: 'absolute', top: 12, left: 12, width: 190 }}>
          <Box
            style={{
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 10,
              paddingBottom: 10,
              borderRadius: 8,
              backgroundColor: '#1a1a1add',
              borderWidth: 1,
              borderColor: C.uiBorder,
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <Text fontSize={12} color="#e5e7eb" style={{ fontWeight: 700 }}>PixelScape</Text>
            {/* HP */}
            <Box style={{ height: 10, borderRadius: 5, backgroundColor: '#333333' }}>
              <Box
                style={{
                  width: `${(player.hp / player.maxHp) * 100}%`,
                  height: '100%',
                  borderRadius: 5,
                  backgroundColor: C.hp,
                }}
              />
            </Box>
            <Text fontSize={9} color="#ef4444" style={{ fontWeight: 600 }}>{player.hp} / {player.maxHp} HP</Text>
            {/* XP */}
            <Box style={{ height: 8, borderRadius: 4, backgroundColor: '#333333' }}>
              <Box style={{ width: '62%', height: '100%', borderRadius: 4, backgroundColor: C.xp }} />
            </Box>
            <Text fontSize={9} color="#3b82f6" style={{ fontWeight: 600 }}>Level 12 · 62% XP</Text>
          </Box>
        </Box>

        {/* Chat */}
        <Box
          style={{
            position: 'absolute',
            bottom: 70,
            left: 12,
            width: 340,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 10,
            paddingBottom: 10,
            borderRadius: 8,
            backgroundColor: '#1a1a1add',
            borderWidth: 1,
            borderColor: C.uiBorder,
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {messages.slice(-6).map((msg, i) => (
            <Text key={`msg-${i}`} fontSize={11} color="#d1d5db">{msg}</Text>
          ))}
        </Box>
      </Box>

      {/* Action bar */}
      <Row
        style={{
          height: 56,
          backgroundColor: C.uiBg,
          borderTopWidth: 1,
          borderColor: C.uiBorder,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {['Attack', 'Fish', 'Mine', 'Chop', 'Cook', 'Magic', 'Pray', 'Emote'].map((label, i) => (
          <Box
            key={`slot-${i}`}
            style={{
              width: 44,
              height: 40,
              borderRadius: 6,
              backgroundColor: C.uiPanel,
              borderWidth: 1,
              borderColor: C.uiBorder,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text fontSize={9} color="#888888" style={{ fontWeight: 600 }}>{label}</Text>
            <Text fontSize={8} color="#555555" style={{ marginTop: 2 }}>{i + 1}</Text>
          </Box>
        ))}
      </Row>
    </Col>
  );
}
