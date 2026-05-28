import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState, PlacedCell } from '../design';

const FLOOR_HEIGHT_METERS = 0.08;
const ROAD_STRIPE_HEIGHT_METERS = 0.095;
const WALL_HEIGHT_METERS = 1.6;
const DOOR_HEIGHT_METERS = 1.2;
const PLAYER_MARKER_HEIGHT_METERS = 0.35;

type CellMeshStyle = {
  color: string;
  height: number;
};

const CELL_MESH_STYLES: Record<string, CellMeshStyle> = {
  asphalt: { color: '#20242d', height: FLOOR_HEIGHT_METERS },
  sidewalk: { color: '#596170', height: FLOOR_HEIGHT_METERS * 1.4 },
  wall: { color: '#cbd5e1', height: WALL_HEIGHT_METERS },
  door: { color: '#f59e0b', height: DOOR_HEIGHT_METERS },
  marker: { color: '#22d3ee', height: ROAD_STRIPE_HEIGHT_METERS },
};

type WorldMeshRect = {
  key: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
};

function meshStyleForKind(kind: string): CellMeshStyle {
  return CELL_MESH_STYLES[kind] ?? { color: '#7c3aed', height: FLOOR_HEIGHT_METERS };
}

function rectMeshPosition(rect: WorldMeshRect, height: number): [number, number, number] {
  return [
    rect.x + rect.width / 2,
    rect.y + height / 2,
    rect.z + rect.depth / 2,
  ];
}

function occupancyKey(x: number, z: number): string {
  return `${x},${z}`;
}

function coalesceCellsIntoWorldRects(placedCells: PlacedCell[]): WorldMeshRect[] {
  const groups = new Map<string, PlacedCell[]>();
  for (const placedCell of placedCells) {
    const groupKey = `${placedCell.kind}:${placedCell.cell.y}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), placedCell]);
  }

  const rects: WorldMeshRect[] = [];
  for (const cells of groups.values()) {
    const remaining = new Map<string, PlacedCell>();
    for (const placedCell of cells) remaining.set(occupancyKey(placedCell.cell.x, placedCell.cell.z), placedCell);

    while (remaining.size > 0) {
      const origin = [...remaining.values()].sort((a, b) => (
        a.cell.z === b.cell.z ? a.cell.x - b.cell.x : a.cell.z - b.cell.z
      ))[0];

      let width = 1;
      while (remaining.has(occupancyKey(origin.cell.x + width, origin.cell.z))) width += 1;

      let depth = 1;
      let canGrowDepth = true;
      while (canGrowDepth) {
        const nextZ = origin.cell.z + depth;
        for (let dx = 0; dx < width; dx += 1) {
          if (!remaining.has(occupancyKey(origin.cell.x + dx, nextZ))) {
            canGrowDepth = false;
            break;
          }
        }
        if (canGrowDepth) depth += 1;
      }

      for (let dz = 0; dz < depth; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          remaining.delete(occupancyKey(origin.cell.x + dx, origin.cell.z + dz));
        }
      }

      rects.push({
        key: `${origin.kind}:${origin.cell.y}:${origin.cell.x},${origin.cell.z}:${width}x${depth}`,
        kind: origin.kind,
        x: origin.cell.x,
        y: origin.cell.y,
        z: origin.cell.z,
        width,
        depth,
      });
    }
  }

  return rects;
}

function MapRectMesh(props: { rect: WorldMeshRect }) {
  const style = meshStyleForKind(props.rect.kind);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.rect.width, height: style.height, depth: props.rect.depth }}
      material={style.color}
      position={rectMeshPosition(props.rect, style.height)}
    />
  );
}

export function GameWorld3D(props: { state: GameState }) {
  const state = props.state;
  const placedCells = Object.values(state.world.placedCells);
  const worldRects = coalesceCellsIntoWorldRects(placedCells);
  const player = state.player.position;

  return (
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#070b12" showGrid={false} showAxes={false}>
      <Scene3D.Camera position={[5.8, 7.4, 8.4]} target={[0.8, 0, 0.2]} fov={48} />
      <Scene3D.AmbientLight color="#9fb0d6" intensity={0.55} />
      <Scene3D.DirectionalLight direction={[0.45, 0.9, 0.35]} color="#ffe0b0" intensity={0.82} />
      <Scene3D.PointLight position={[0, 3, 0]} color="#22d3ee" intensity={0.45} />
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 28, height: 0.04, depth: 22 }}
        material="#0d1320"
        position={[0.5, -0.03, 0.5]}
      />
      {worldRects.map((rect) => (
        <MapRectMesh key={rect.key} rect={rect} />
      ))}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 0.42, height: PLAYER_MARKER_HEIGHT_METERS, depth: 0.42 }}
        material="#22c55e"
        position={[player.x, player.y + PLAYER_MARKER_HEIGHT_METERS / 2, player.z]}
      />
    </Scene3D>
  );
}
