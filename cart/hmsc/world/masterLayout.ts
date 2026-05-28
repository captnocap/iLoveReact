import type { GridCell, TileKind, WorldSurfaceRegion } from '../design';
import { commandCell } from './grid';

export type HmscLayoutPlacement = {
  key: string;
  label: string;
  kind: 'lab-building';
  origin: GridCell;
  width: number;
  depth: number;
  labName: string;
  triggerCommand: string;
  triggerLabel: string;
  door: { dx: number; dz: number };
  placements?: HmscLayoutPlacement[];
};

export type HmscLayoutZone = {
  key: string;
  label: string;
  origin: GridCell;
  width: number;
  depth: number;
  surface: TileKind;
  zones?: HmscLayoutZone[];
  placements?: HmscLayoutPlacement[];
};

export type HmscMasterLayout = {
  key: string;
  label: string;
  widthCells: number;
  depthCells: number;
  zones: HmscLayoutZone[];
};

export type HmscLayoutCell = {
  kind: TileKind;
  cell: GridCell;
  triggerCommand?: string;
  triggerLabel?: string;
};

const HMSC_LARGE_MAP_CELLS = 1200;
const HMSC_MAP_HALF_CELLS = HMSC_LARGE_MAP_CELLS / 2;
const LAB_BUILDING_WIDTH_CELLS = 9;
const LAB_BUILDING_DEPTH_CELLS = 7;
const SCALE_MUSEUM_ORIGIN = commandCell(-430, -250);
const MATERIALS_ANNEX_ORIGIN = commandCell(65, 70);
const AIM_RANGE_ORIGIN = commandCell(390, -335);

function labBuilding(
  key: string,
  label: string,
  labName: string,
  origin: GridCell,
): HmscLayoutPlacement {
  return {
    key,
    label,
    kind: 'lab-building',
    origin,
    width: LAB_BUILDING_WIDTH_CELLS,
    depth: LAB_BUILDING_DEPTH_CELLS,
    labName,
    triggerCommand: `lab_spawn ${labName}`,
    triggerLabel: label,
    door: {
      dx: Math.floor(LAB_BUILDING_WIDTH_CELLS / 2),
      dz: LAB_BUILDING_DEPTH_CELLS - 1,
    },
  };
}

function zone(
  key: string,
  label: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  surface: TileKind,
  options: Pick<HmscLayoutZone, 'zones' | 'placements'> = {},
): HmscLayoutZone {
  return {
    key,
    label,
    origin: commandCell(x, z),
    width,
    depth,
    surface,
    ...options,
  };
}

export const HMSC_MASTER_LAYOUT: HmscMasterLayout = {
  key: 'hmsc.shitcity.three-islands.v1',
  label: 'HMSC three-island district sketch',
  widthCells: HMSC_LARGE_MAP_CELLS,
  depthCells: HMSC_LARGE_MAP_CELLS,
  zones: [
    zone('surrounding-water', 'Surrounding water', -HMSC_MAP_HALF_CELLS, -HMSC_MAP_HALF_CELLS, HMSC_LARGE_MAP_CELLS, HMSC_LARGE_MAP_CELLS, 'water', {
      zones: [
        zone('west-island', 'West island residential shelf', -505, -485, 235, 630, 'residential', {
          zones: [
            zone('west-island-south-mixed', 'West island dense mixed south', -510, -80, 205, 475, 'mixed'),
            zone('west-island-downtown-spine', 'West island downtown spine', -300, -210, 210, 620, 'downtown'),
            zone('west-island-beach-northwalk', 'West island beach northwalk', -420, -540, 200, 90, 'sand'),
            zone('west-island-pocket-beach', 'West island pocket beach', -160, 410, 130, 90, 'sand'),
          ],
          placements: [
            labBuilding('scale-museum', 'Human Measurement Standards Council', 'scale', SCALE_MUSEUM_ORIGIN),
          ],
        }),
        zone('central-island', 'Central island residential core', -220, -560, 360, 360, 'residential', {
          zones: [
            zone('central-downtown-tower', 'Central downtown tower strip', -90, -550, 52, 325, 'downtown'),
            zone('central-beach-north-market', 'Central north beach market', -35, -545, 150, 175, 'sand'),
            zone('central-beach-small-block', 'Central small beach block', -40, -370, 72, 90, 'sand'),
            zone('central-mixed-society-block', 'Central HMSC mixed society block', -18, -215, 215, 205, 'mixed', {
              placements: [
                labBuilding('materials-annex', 'HMSC Materials Annex', 'textures', MATERIALS_ANNEX_ORIGIN),
              ],
            }),
            zone('central-residential-plaza', 'Central residential plaza', -80, -30, 190, 160, 'residential'),
            zone('central-mixed-south-block', 'Central mixed south block', -130, 220, 165, 150, 'mixed'),
            zone('central-beach-causeway-west', 'West central beach causeway', -90, -35, 185, 18, 'sand'),
            zone('central-beach-causeway-south', 'South central beach causeway', -130, 445, 190, 18, 'sand'),
          ],
        }),
        zone('east-island', 'East island residential coast', 205, -430, 255, 760, 'residential', {
          zones: [
            zone('east-island-north-mixed', 'East island north mixed district', 185, -410, 170, 255, 'mixed'),
            zone('east-island-central-residential', 'East island canal residential', 210, -155, 150, 250, 'residential'),
            zone('east-island-south-residential', 'East island south residential', 175, 95, 150, 250, 'residential'),
            zone('east-island-inner-mixed', 'East island inner mixed district', 85, -160, 150, 145, 'mixed'),
            zone('east-island-inner-mixed-south', 'East island inner mixed south', 115, -15, 120, 140, 'mixed'),
            zone('east-island-long-beach', 'East island long beach', 360, -410, 120, 610, 'sand', {
              placements: [
                labBuilding('aim-range', 'HMSC Coastal Range', 'aim', AIM_RANGE_ORIGIN),
              ],
            }),
            zone('east-island-south-beach', 'East island south beach', 320, 200, 155, 270, 'sand'),
            zone('east-island-lower-beach', 'East island lower beach', 280, 470, 200, 105, 'sand'),
            zone('east-island-pocket-mixed', 'East island pocket mixed block', 280, 350, 52, 42, 'mixed'),
            zone('east-island-east-causeway', 'East island east causeway', 95, -285, 95, 18, 'sand'),
          ],
        }),
      ],
    }),
  ],
};

function regionFromZone(zone: HmscLayoutZone): WorldSurfaceRegion {
  return {
    id: zone.key,
    label: zone.label,
    kind: zone.surface,
    x: zone.origin.x,
    y: zone.origin.y,
    z: zone.origin.z,
    width: zone.width,
    depth: zone.depth,
    zoneKey: zone.key,
  };
}

function flattenZones(zones: HmscLayoutZone[]): HmscLayoutZone[] {
  return zones.flatMap((zone) => [zone, ...flattenZones(zone.zones ?? [])]);
}

function ringCells(placement: HmscLayoutPlacement): HmscLayoutCell[] {
  const cells: HmscLayoutCell[] = [];
  for (let z = 0; z < placement.depth; z += 1) {
    for (let x = 0; x < placement.width; x += 1) {
      const isDoor = x === placement.door.dx && z === placement.door.dz;
      const isEdge = x === 0 || x === placement.width - 1 || z === 0 || z === placement.depth - 1;
      if (!isEdge) continue;
      cells.push({
        kind: isDoor ? 'door' : 'wall',
        cell: commandCell(placement.origin.x + x, placement.origin.z + z, placement.origin.y),
        ...(isDoor ? { triggerCommand: placement.triggerCommand, triggerLabel: placement.triggerLabel } : {}),
      });
    }
  }
  return cells;
}

function markerCell(): HmscLayoutCell {
  return { kind: 'marker', cell: commandCell(0, 0) };
}

function zoneContainsZone(parent: HmscLayoutZone | undefined, child: HmscLayoutZone): boolean {
  if (!parent) return false;
  return child.origin.x >= parent.origin.x
    && child.origin.z >= parent.origin.z
    && child.origin.x + child.width <= parent.origin.x + parent.width
    && child.origin.z + child.depth <= parent.origin.z + parent.depth;
}

function surfaceRegionsFromZones(zones: HmscLayoutZone[], parentZone?: HmscLayoutZone): WorldSurfaceRegion[] {
  return zones.flatMap((zone) => [
    ...(zone.surface === parentZone?.surface && zoneContainsZone(parentZone, zone) ? [] : [regionFromZone(zone)]),
    ...surfaceRegionsFromZones(zone.zones ?? [], zone),
  ]);
}

export function surfaceRegionsFromMasterLayout(layout: HmscMasterLayout = HMSC_MASTER_LAYOUT): WorldSurfaceRegion[] {
  return surfaceRegionsFromZones(layout.zones);
}

export function cellsFromMasterLayout(layout: HmscMasterLayout = HMSC_MASTER_LAYOUT): HmscLayoutCell[] {
  const zones = flattenZones(layout.zones);
  return [
    markerCell(),
    ...zones.flatMap((zone) => (zone.placements ?? []).flatMap(ringCells)),
  ];
}
