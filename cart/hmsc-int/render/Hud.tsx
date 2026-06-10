import { useEffect, useRef, useState } from 'react';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { Box, Effect, Text } from '@reactjit/primitives';
import type { GameState, GridCell } from '../design';
import { tileKindAtCell } from '../world/grid';
import { worldMarkers } from '../world/worldView';
import { hexToRgb01, swatchRgb01ForId } from '../world/placeables';

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
const MINIMAP_DATA_HEADER = 5;
const MINIMAP_MIN_FRAME_SECONDS = 0.001;
const MINIMAP_MAX_FRAME_SECONDS = 0.05;
const MINIMAP_SMOOTHING_PER_SECOND = 18;
const MINIMAP_SETTLED_DISTANCE_CELLS = 0.002;
const MINIMAP_SETTLED_YAW_RADIANS = 0.002;

// Per-cell colors are supplied as 3 floats (rgb) straight from the Placeable
// registry's swatchColor — no kind->int->color table in here anymore (that
// duplicated CPU minimapTileCode + this WGSL switch). One color source now.
const HMSC_MINIMAP_WGSL = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
const WIN: i32 = ${MINIMAP_CELL_SPAN};
const HDR: i32 = ${MINIMAP_DATA_HEADER};

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let lx = clamp(i32(in.uv.x * f32(WIN) + D[3]), 0, WIN - 1);
  let ly = clamp(i32(in.uv.y * f32(WIN) + D[4]), 0, WIN - 1);
  let base = HDR + (ly * WIN + lx) * 3;
  var col = vec3f(D[base], D[base + 1], D[base + 2]);

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

function angleDeltaRadians(target: number, current: number): number {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function ledClockFromSkyHour(skyHour: number): string {
  const totalMinutes = Math.floor((((skyHour % 24) + 24) % 24) * 60);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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

const MINIMAP_VOID_RGB: [number, number, number] = [0.071, 0.035, 0.106];

type FootprintMarker = { x: number; z: number; width: number; depth: number; swatchColor: string };

function cellInFootprint(m: FootprintMarker, cell: GridCell): boolean {
  return cell.x >= m.x && cell.x < m.x + m.width && cell.z >= m.z && cell.z < m.z + m.depth;
}

// Per-cell minimap color: a SOLID footprint wins (buildings, props — read as
// solid blocks), else the tile swatch, then any TINT footprints (zones,
// mountains) blended on top. All come from worldMarkers, so the minimap and the
// internal map draw the SAME landmarks from one source — no per-map tables.
function minimapCellRgb(state: GameState, solids: FootprintMarker[], tints: FootprintMarker[], cell: GridCell): [number, number, number] {
  for (const m of solids) {
    if (cellInFootprint(m, cell)) return hexToRgb01(m.swatchColor);
  }
  const kind = tileKindAtCell(state, cell);
  let rgb = kind ? swatchRgb01ForId(`tile:${kind}`) : MINIMAP_VOID_RGB;
  for (const z of tints) {
    if (!cellInFootprint(z, cell)) continue;
    const [zr, zg, zb] = hexToRgb01(z.swatchColor);
    const a = 0.28;
    rgb = [rgb[0] * (1 - a) + zr * a, rgb[1] * (1 - a) + zg * a, rgb[2] * (1 - a) + zb * a];
    break;
  }
  return rgb;
}

function useSmoothedMinimapView(state: GameState): { x: number; z: number; yawRadians: number } {
  const targetRef = useRef({
    x: state.player.position.x / state.world.cellSizeMeters,
    z: state.player.position.z / state.world.cellSizeMeters,
    yawRadians: state.player.yawDegrees * Math.PI / 180,
  });
  const [view, setView] = useState(targetRef.current);

  useEffect(() => {
    targetRef.current = {
      x: state.player.position.x / state.world.cellSizeMeters,
      z: state.player.position.z / state.world.cellSizeMeters,
      yawRadians: state.player.yawDegrees * Math.PI / 180,
    };
  }, [
    state.player.position.x,
    state.player.position.z,
    state.player.yawDegrees,
    state.world.cellSizeMeters,
  ]);

  useEffect(() => {
    const host: any = globalThis;
    const schedule = host.requestAnimationFrame ? host.requestAnimationFrame.bind(host) : (fn: any) => setTimeout(fn, 16);
    const cancel = host.cancelAnimationFrame ? host.cancelAnimationFrame.bind(host) : clearTimeout;
    let handle: any = 0;
    let lastNow = host.performance?.now?.() ?? Date.now();

    const tick = () => {
      const now = host.performance?.now?.() ?? Date.now();
      const frameSeconds = Math.max(MINIMAP_MIN_FRAME_SECONDS, Math.min(MINIMAP_MAX_FRAME_SECONDS, (now - lastNow) / 1000));
      lastNow = now;
      const smoothing = 1 - Math.exp(-MINIMAP_SMOOTHING_PER_SECOND * frameSeconds);
      setView((current) => {
        const target = targetRef.current;
        const dx = target.x - current.x;
        const dz = target.z - current.z;
        const dyaw = angleDeltaRadians(target.yawRadians, current.yawRadians);
        if (
          Math.abs(dx) < MINIMAP_SETTLED_DISTANCE_CELLS
          && Math.abs(dz) < MINIMAP_SETTLED_DISTANCE_CELLS
          && Math.abs(dyaw) < MINIMAP_SETTLED_YAW_RADIANS
        ) {
          return current;
        }
        return {
          x: current.x + dx * smoothing,
          z: current.z + dz * smoothing,
          yawRadians: current.yawRadians + dyaw * smoothing,
        };
      });
      handle = schedule(tick);
    };

    handle = schedule(tick);
    return () => cancel(handle);
  }, []);

  return view;
}

function MiniMap(props: { state: GameState }) {
  const smoothedView = useSmoothedMinimapView(props.state);
  const radius = Math.floor(MINIMAP_CELL_SPAN / 2);
  const centerCell: GridCell = {
    x: Math.floor(smoothedView.x),
    y: 0,
    z: Math.floor(smoothedView.z),
  };
  const cells = visibleMinimapCells(centerCell);
  const markers = worldMarkers(props.state);
  const toFootprint = (m: typeof markers[number]) => ({ x: m.x, z: m.z, width: m.width, depth: m.depth, swatchColor: m.swatchColor });
  // Solids (buildings, props) paint over the cell; tints (zones, mountains) blend.
  const solidFootprints = markers.filter((m) => m.layer === 'building' || m.layer === 'prop').map(toFootprint);
  const tintFootprints = markers.filter((m) => m.layer === 'zone' || m.layer === 'mountain').map(toFootprint);
  const smoothedOriginX = smoothedView.x - radius;
  const smoothedOriginZ = smoothedView.z - radius;
  const playerX = props.state.player.position.x / props.state.world.cellSizeMeters;
  const playerZ = props.state.player.position.z / props.state.world.cellSizeMeters;
  const playerLocalX = clampNumber(playerX - smoothedOriginX, 0, MINIMAP_CELL_SPAN);
  const playerLocalY = clampNumber(playerZ - smoothedOriginZ, 0, MINIMAP_CELL_SPAN);
  const scrollX = smoothedView.x - centerCell.x;
  const scrollZ = smoothedView.z - centerCell.z;
  // Header (5 floats) then 3 floats (rgb) per cell, row-major over the window.
  const minimapData = [
    playerLocalX,
    playerLocalY,
    smoothedView.yawRadians,
    scrollX,
    scrollZ,
    ...cells.flatMap((cell) => minimapCellRgb(props.state, solidFootprints, tintFootprints, cell)),
  ];

  return (
    <Box style={{ position: 'absolute', right: 18, bottom: 18, width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: HUD.border, backgroundColor: HUD.surround, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Effect shader={HMSC_MINIMAP_WGSL} data={minimapData} style={{ width: MINIMAP_PIXELS, height: MINIMAP_PIXELS }} />
    </Box>
  );
}

// GTA-style district title: listens for zone.entered on the event bus and flashes
// the zone's name, fading out after a beat. Driven purely by the event, so EVERY
// zone flashes its name on entry regardless of any onEnterCommand.
function ZoneNameFlash() {
  const [name, setName] = useState<string | null>(null);
  const timerRef = useRef<any>(null);
  useEffect(() => {
    const off = busOn('hmsc:event:zone.entered', (event: any) => {
      const zoneName = String(event?.payload?.name ?? event?.subject?.label ?? '').trim();
      if (!zoneName) return;
      setName(zoneName);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setName(null), 3200);
    });
    return () => {
      off?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  if (!name) return null;
  return (
    <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center', pointerEvents: 'none' }}>
      <Box style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', left: 2, top: 2, fontFamily: 'mono', fontSize: 30, fontWeight: '800', letterSpacing: 2, color: HUD.ledShadow }}>{name}</Text>
        <Text style={{ fontFamily: 'mono', fontSize: 30, fontWeight: '800', letterSpacing: 2, color: HUD.text }}>{name}</Text>
      </Box>
    </Box>
  );
}

export function Hud(props: { state: GameState }) {
  const clock = ledClockFromSkyHour(props.state.config.sky.hour);
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
      <ZoneNameFlash />
    </>
  );
}
