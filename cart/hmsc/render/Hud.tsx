import { useEffect, useRef, useState } from 'react';
import { Box, Effect, Text } from '@reactjit/runtime/primitives';
import type { GameState, GridCell } from '../design';
import { cellKey, worldToCell } from '../world/grid';

const HUD = {
  panelBg: '#0c0614ee',
  border: '#ff2d95',
  borderCyan: '#18e0d8',
  text: '#ffd8ec',
  textFaint: '#5e4a5a',
  accent: '#18e0d8',
  money: '#5fe08c',
  health: '#ff5ea0',
  armor: '#8a6cff',
  ledShadow: '#070310',
  star: '#18e0d8',
  starDim: '#3a2540',
  surround: '#0b0618',
};

const MINIMAP_CELL_SPAN = 15;
const MINIMAP_PIXELS = 144;
const MINIMAP_DATA_HEADER = 3;
const GAME_START_HOUR = 20;

const HMSC_MINIMAP_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
const WIN: i32 = ${MINIMAP_CELL_SPAN};
const HDR: i32 = ${MINIMAP_DATA_HEADER};

fn tileColor(kind: i32) -> vec3f {
  if (kind == 0) { return vec3f(0.126, 0.141, 0.176); }
  if (kind == 1) { return vec3f(0.349, 0.380, 0.439); }
  if (kind == 2) { return vec3f(0.796, 0.835, 0.882); }
  if (kind == 3) { return vec3f(0.961, 0.620, 0.043); }
  if (kind == 4) { return vec3f(0.133, 0.827, 0.933); }
  return vec3f(0.071, 0.035, 0.106);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let lx = clamp(i32(in.uv.x * f32(WIN)), 0, WIN - 1);
  let ly = clamp(i32(in.uv.y * f32(WIN)), 0, WIN - 1);
  let kind = i32(D[HDR + ly * WIN + lx] + 0.5);
  var col = tileColor(kind);

  let player = vec2f(D[0] / f32(WIN), D[1] / f32(WIN));
  let yaw = D[2];
  let facing = player + vec2f(-sin(yaw), -cos(yaw)) * (1.15 / f32(WIN));
  if (distance(in.uv, facing) * f32(WIN) < 0.55) { col = vec3f(0.12, 0.92, 0.86); }
  if (distance(in.uv, player) * f32(WIN) < 0.85) { col = vec3f(1.0, 1.0, 1.0); }

  let dc = distance(in.uv, vec2f(0.5, 0.5));
  if (dc > 0.5) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  if (dc > 0.44) {
    col = mix(col, vec3f(1.0, 0.16, 0.55), smoothstep(0.44, 0.5, dc));
  }
  return vec4f(col, 1.0);
}
`;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ledClockFromElapsed(elapsedSeconds: number): string {
  const minutes = GAME_START_HOUR * 60 + Math.floor(elapsedSeconds);
  const hour = Math.floor(minutes / 60) % 24;
  const minute = ((minutes % 60) + 60) % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function useHudClock(): string {
  const startMsRef = useRef(Date.now());
  const [clock, setClock] = useState(() => ledClockFromElapsed(0));

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(ledClockFromElapsed((Date.now() - startMsRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return clock;
}

function Led(props: { text: string; color: string; size: number; track?: number }) {
  const base = { fontFamily: 'mono' as const, fontSize: props.size, fontWeight: '700' as const, letterSpacing: props.track ?? 1 };
  return (
    <Box style={{ position: 'relative' }}>
      <Text style={{ ...base, position: 'absolute', left: 2, top: 2, color: HUD.ledShadow }}>{props.text}</Text>
      <Text style={{ ...base, color: props.color }}>{props.text}</Text>
    </Box>
  );
}

function MeterStat(props: { label: string; value: number; color: string }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', left: 1, top: 1, fontFamily: 'mono', fontSize: 14, fontWeight: '700', color: HUD.ledShadow }}>{props.label}</Text>
        <Text style={{ fontFamily: 'mono', fontSize: 14, fontWeight: '700', color: props.color }}>{props.label}</Text>
      </Box>
      <Led text={String(props.value)} color={props.color} size={22} />
    </Box>
  );
}

function WantedStars(props: { lit: number }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 1 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Box key={i} style={{ position: 'relative' }}>
          <Text style={{ position: 'absolute', left: 1, top: 1, fontSize: 16, color: HUD.ledShadow }}>*</Text>
          <Text style={{ fontSize: 16, color: i < props.lit ? HUD.star : HUD.starDim }}>*</Text>
        </Box>
      ))}
    </Box>
  );
}

function ItemBox(props: { itemLabel: string }) {
  return (
    <Box style={{ width: 92, height: 92, borderRadius: 8, borderWidth: 2, borderColor: HUD.border, backgroundColor: HUD.surround, padding: 3 }}>
      <Box style={{ width: '100%', height: '100%', borderRadius: 6, borderWidth: 2, borderColor: HUD.borderCyan, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        <Text style={{ color: props.itemLabel === 'FISTS' ? HUD.textFaint : HUD.text, fontSize: 12, fontWeight: '700', letterSpacing: 1, textAlign: 'center' }}>
          {props.itemLabel}
        </Text>
      </Box>
    </Box>
  );
}

function visibleMinimapCells(center: GridCell): GridCell[] {
  const radius = Math.floor(MINIMAP_CELL_SPAN / 2);
  const cells: GridCell[] = [];
  for (let z = center.z - radius; z <= center.z + radius; z += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      cells.push({ x, y: center.y, z });
    }
  }
  return cells;
}

function minimapTileCode(kind: string | undefined): number {
  if (kind === 'asphalt') return 0;
  if (kind === 'sidewalk') return 1;
  if (kind === 'wall') return 2;
  if (kind === 'door') return 3;
  if (kind === 'marker') return 4;
  return 5;
}

function MiniMap(props: { state: GameState }) {
  const playerCell = worldToCell(props.state.player.position, props.state.world.cellSizeMeters);
  const cells = visibleMinimapCells(playerCell);
  const placedCellsByKey = props.state.world.placedCells;
  const radius = Math.floor(MINIMAP_CELL_SPAN / 2);
  const playerLocalX = clampNumber(props.state.player.position.x / props.state.world.cellSizeMeters - (playerCell.x - radius), 0, MINIMAP_CELL_SPAN);
  const playerLocalY = clampNumber(props.state.player.position.z / props.state.world.cellSizeMeters - (playerCell.z - radius), 0, MINIMAP_CELL_SPAN);
  const yawRadians = props.state.player.yawDegrees * Math.PI / 180;
  const minimapData = [
    playerLocalX,
    playerLocalY,
    yawRadians,
    ...cells.map((cell) => minimapTileCode(placedCellsByKey[cellKey(cell)]?.kind)),
  ];

  return (
    <Box style={{ position: 'absolute', right: 18, bottom: 18, width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: HUD.border, backgroundColor: HUD.surround, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Effect shader={HMSC_MINIMAP_WGSL} data={minimapData} style={{ width: MINIMAP_PIXELS, height: MINIMAP_PIXELS }} />
    </Box>
  );
}

export function Hud(props: { state: GameState }) {
  const clock = useHudClock();
  const player = props.state.player;
  const money = String(Math.max(0, Math.round(player.money))).padStart(8, '0');
  const armor = Math.max(0, Math.round((player as any).armor ?? 0));
  const health = Math.max(0, Math.round(player.health));
  const wanted = Math.min(6, Math.round((Math.max(0, player.heat) / 100) * 6));
  const itemLabel = player.inventory[0]?.toUpperCase() ?? 'FISTS';

  return (
    <>
      <Box style={{ position: 'absolute', right: 18, top: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <Box style={{ alignItems: 'flex-end', gap: 4 }}>
          <Led text={clock} color={HUD.accent} size={32} />
          <Led text={`$${money}`} color={HUD.money} size={24} />
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <MeterStat label="AR" value={armor} color={HUD.armor} />
            <MeterStat label="HP" value={health} color={HUD.health} />
          </Box>
          <WantedStars lit={wanted} />
        </Box>
        <ItemBox itemLabel={itemLabel} />
      </Box>
      <MiniMap state={props.state} />
    </>
  );
}
