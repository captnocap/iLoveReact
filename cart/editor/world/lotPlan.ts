// lotPlan.ts — the 2D grid-template document for building lots (req_4514).
//
// A lot plan is the LLM-facing, data-only view of a build: a W×H tile grid
// (1 u = 1 tile = 1 meter, scale ruling R4) carrying room zones per cell,
// wall runs on cell edges, openings on walled edges, and placements whose
// footprints come from MEASURED placeable facts — never guessed. It is the
// authoring layer above the architecture engine: `auditLotPlan` returns every
// refusal at once (a feedback loop wants the full list, not the first throw),
// and the bake leg later executes a valid plan into real wall/opening/prop
// commands (bake-by-execution, MAPFORMAT-0607 V29).
//
// Edge addressing: cell (c,r) has c in [0,widthU), r in [0,heightU).
//   horizontal edge (c,r) — the border between cell (c,r-1) and cell (c,r); r in [0,heightU]
//   vertical   edge (c,r) — the border between cell (c-1,r) and cell (c,r); c in [0,widthU]
// Boundary edges (r=0, r=heightU, c=0, c=widthU) face the lot exterior.

export type LotEdgeOrientation = 'h' | 'v';
export type LotEdge = { orientation: LotEdgeOrientation; columnU: number; rowU: number };

export type LotRoom = { id: string; name: string };

export type LotWall = { edge: LotEdge; styleId: string | null };

export type LotOpeningKind = 'door' | 'window';
export type LotOpening = { edge: LotEdge; kind: LotOpeningKind; kitId: string | null };

/** Quarter turns clockwise. Odd rotations swap a footprint's width and depth. */
export type LotRotation = 0 | 1 | 2 | 3;

export type LotPlacement = {
  id: string;
  placeableId: string;
  columnU: number;
  rowU: number;
  rotation: LotRotation;
};

export type LotPlan = {
  version: 1;
  name: string;
  widthU: number;
  heightU: number;
  rooms: LotRoom[];
  /** widthU×heightU row-major room indices into `rooms`; -1 = unzoned. */
  cells: number[];
  walls: LotWall[];
  openings: LotOpening[];
  placements: LotPlacement[];
};

/** The measured truth about one placeable, supplied by a catalog adapter
 * (model-package bounds or the architecture catalog) — a plan never carries
 * sizes of its own, so a re-measured model corrects every plan that uses it. */
export type LotPlaceableFacts = {
  id: string;
  name: string;
  /** Footprint in whole tiles at rotation 0, outward-rounded from measured bounds. */
  widthU: number;
  depthU: number;
  mount: 'floor' | 'wall';
};

export type LotFindingSeverity = 'refusal' | 'warning';
export type LotFinding = {
  severity: LotFindingSeverity;
  code:
    | 'placement-unknown-placeable'
    | 'placement-out-of-bounds'
    | 'placement-overlap'
    | 'placement-blocks-door'
    | 'wall-mount-without-wall'
    | 'opening-without-wall'
    | 'room-sealed';
  message: string;
  /** Placement id, room id, or `h:c,r` / `v:c,r` edge key the finding is about. */
  subject: string;
};

export const LOT_LIMITS = {
  maxSideU: 1024,
  maxRooms: 512,
  maxNameLength: 120,
} as const;

export class LotPlanValidationError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`${path} ${reason}`);
    this.path = path;
  }
}

const fail = (path: string, reason: string): never => {
  throw new LotPlanValidationError(path, reason);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asWhole = (value: unknown, path: string, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    fail(path, `must be an integer in [0, ${max}]`);
  }
  return value as number;
};

const asName = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > LOT_LIMITS.maxNameLength) {
    fail(path, `must be a non-empty string of at most ${LOT_LIMITS.maxNameLength} characters`);
  }
  return value as string;
};

export const lotEdgeKey = (edge: LotEdge): string => `${edge.orientation}:${edge.columnU},${edge.rowU}`;

/** An edge is addressable when it borders at least one in-lot cell. */
const edgeInLot = (plan: Pick<LotPlan, 'widthU' | 'heightU'>, edge: LotEdge): boolean =>
  edge.orientation === 'h'
    ? edge.columnU < plan.widthU && edge.rowU <= plan.heightU
    : edge.columnU <= plan.widthU && edge.rowU < plan.heightU;

const parseEdge = (value: unknown, path: string, plan: Pick<LotPlan, 'widthU' | 'heightU'>): LotEdge => {
  if (!isRecord(value)) fail(path, 'must be an object');
  const record = value as Record<string, unknown>;
  const orientation = record.orientation;
  if (orientation !== 'h' && orientation !== 'v') fail(`${path}.orientation`, "must be 'h' or 'v'");
  const edge: LotEdge = {
    orientation: orientation as LotEdgeOrientation,
    columnU: asWhole(record.columnU, `${path}.columnU`, LOT_LIMITS.maxSideU),
    rowU: asWhole(record.rowU, `${path}.rowU`, LOT_LIMITS.maxSideU),
  };
  if (!edgeInLot(plan, edge)) fail(path, 'must border at least one lot cell');
  return edge;
};

export function emptyLotPlan(name: string, widthU: number, heightU: number): LotPlan {
  const plan: LotPlan = {
    version: 1,
    name: asName(name, 'name'),
    widthU: asWhole(widthU, 'widthU', LOT_LIMITS.maxSideU),
    heightU: asWhole(heightU, 'heightU', LOT_LIMITS.maxSideU),
    rooms: [],
    cells: [],
    walls: [],
    openings: [],
    placements: [],
  };
  if (plan.widthU === 0 || plan.heightU === 0) fail('widthU', 'lot must be at least 1×1 tiles');
  plan.cells = new Array(plan.widthU * plan.heightU).fill(-1);
  return plan;
}

export function parseLotPlan(value: unknown): LotPlan {
  if (!isRecord(value)) fail('plan', 'must be an object');
  const record = value as Record<string, unknown>;
  if (record.version !== 1) fail('plan.version', 'must be 1');
  const plan = emptyLotPlan(
    asName(record.name, 'plan.name'),
    asWhole(record.widthU, 'plan.widthU', LOT_LIMITS.maxSideU),
    asWhole(record.heightU, 'plan.heightU', LOT_LIMITS.maxSideU),
  );

  const rooms = Array.isArray(record.rooms) ? record.rooms : fail('plan.rooms', 'must be an array');
  if (rooms.length > LOT_LIMITS.maxRooms) fail('plan.rooms', `must hold at most ${LOT_LIMITS.maxRooms} rooms`);
  const roomIds = new Set<string>();
  plan.rooms = rooms.map((room, index) => {
    const path = `plan.rooms[${index}]`;
    if (!isRecord(room)) fail(path, 'must be an object');
    const row: LotRoom = { id: asName(room.id, `${path}.id`), name: asName(room.name, `${path}.name`) };
    if (roomIds.has(row.id)) fail(`${path}.id`, `duplicates room id '${row.id}'`);
    roomIds.add(row.id);
    return row;
  });

  const cells = Array.isArray(record.cells) ? record.cells : fail('plan.cells', 'must be an array');
  if (cells.length !== plan.widthU * plan.heightU) {
    fail('plan.cells', `must hold exactly widthU×heightU (${plan.widthU * plan.heightU}) entries`);
  }
  plan.cells = cells.map((cell, index) => {
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < -1 || cell >= plan.rooms.length) {
      fail(`plan.cells[${index}]`, `must be -1 or a room index below ${plan.rooms.length}`);
    }
    return cell as number;
  });

  const walls = Array.isArray(record.walls) ? record.walls : fail('plan.walls', 'must be an array');
  const wallKeys = new Set<string>();
  plan.walls = walls.map((wall, index) => {
    const path = `plan.walls[${index}]`;
    if (!isRecord(wall)) fail(path, 'must be an object');
    const edge = parseEdge(wall.edge, `${path}.edge`, plan);
    const key = lotEdgeKey(edge);
    if (wallKeys.has(key)) fail(`${path}.edge`, `duplicates wall edge ${key}`);
    wallKeys.add(key);
    const styleId = wall.styleId === null ? null : asName(wall.styleId, `${path}.styleId`);
    return { edge, styleId };
  });

  const openings = Array.isArray(record.openings) ? record.openings : fail('plan.openings', 'must be an array');
  const openingKeys = new Set<string>();
  plan.openings = openings.map((opening, index) => {
    const path = `plan.openings[${index}]`;
    if (!isRecord(opening)) fail(path, 'must be an object');
    const edge = parseEdge(opening.edge, `${path}.edge`, plan);
    const key = lotEdgeKey(edge);
    if (openingKeys.has(key)) fail(`${path}.edge`, `duplicates opening edge ${key}`);
    openingKeys.add(key);
    const kind = opening.kind;
    if (kind !== 'door' && kind !== 'window') fail(`${path}.kind`, "must be 'door' or 'window'");
    const kitId = opening.kitId === null ? null : asName(opening.kitId, `${path}.kitId`);
    return { edge, kind: kind as LotOpeningKind, kitId };
  });

  const placements = Array.isArray(record.placements) ? record.placements : fail('plan.placements', 'must be an array');
  const placementIds = new Set<string>();
  plan.placements = placements.map((placement, index) => {
    const path = `plan.placements[${index}]`;
    if (!isRecord(placement)) fail(path, 'must be an object');
    const id = asName(placement.id, `${path}.id`);
    if (placementIds.has(id)) fail(`${path}.id`, `duplicates placement id '${id}'`);
    placementIds.add(id);
    const rotation = placement.rotation;
    if (rotation !== 0 && rotation !== 1 && rotation !== 2 && rotation !== 3) {
      fail(`${path}.rotation`, 'must be 0, 1, 2, or 3 quarter turns');
    }
    return {
      id,
      placeableId: asName(placement.placeableId, `${path}.placeableId`),
      columnU: asWhole(placement.columnU, `${path}.columnU`, LOT_LIMITS.maxSideU),
      rowU: asWhole(placement.rowU, `${path}.rowU`, LOT_LIMITS.maxSideU),
      rotation: rotation as LotRotation,
    };
  });

  return plan;
}

export const cloneLotPlan = (plan: LotPlan): LotPlan => parseLotPlan(JSON.parse(JSON.stringify(plan)));

/** A placement's occupied tile rectangle after rotation. */
export function lotPlacementRect(
  placement: LotPlacement,
  facts: LotPlaceableFacts,
): { columnU: number; rowU: number; widthU: number; depthU: number } {
  const swapped = placement.rotation === 1 || placement.rotation === 3;
  return {
    columnU: placement.columnU,
    rowU: placement.rowU,
    widthU: swapped ? facts.depthU : facts.widthU,
    depthU: swapped ? facts.widthU : facts.depthU,
  };
}

/** The edges on a placement rectangle's boundary — where a wall-mounted
 * placeable must find a wall, and what a door needs kept clear beyond. */
function rectBoundaryEdges(rect: { columnU: number; rowU: number; widthU: number; depthU: number }): LotEdge[] {
  const edges: LotEdge[] = [];
  for (let c = rect.columnU; c < rect.columnU + rect.widthU; c += 1) {
    edges.push({ orientation: 'h', columnU: c, rowU: rect.rowU });
    edges.push({ orientation: 'h', columnU: c, rowU: rect.rowU + rect.depthU });
  }
  for (let r = rect.rowU; r < rect.rowU + rect.depthU; r += 1) {
    edges.push({ orientation: 'v', columnU: rect.columnU, rowU: r });
    edges.push({ orientation: 'v', columnU: rect.columnU + rect.widthU, rowU: r });
  }
  return edges;
}

/** The two cells an edge separates; out-of-lot neighbors are omitted. */
function edgeCells(plan: LotPlan, edge: LotEdge): { columnU: number; rowU: number }[] {
  const cells = edge.orientation === 'h'
    ? [
      { columnU: edge.columnU, rowU: edge.rowU - 1 },
      { columnU: edge.columnU, rowU: edge.rowU },
    ]
    : [
      { columnU: edge.columnU - 1, rowU: edge.rowU },
      { columnU: edge.columnU, rowU: edge.rowU },
    ];
  return cells.filter((cell) =>
    cell.columnU >= 0 && cell.columnU < plan.widthU && cell.rowU >= 0 && cell.rowU < plan.heightU);
}

/** Every refusal and warning in one pass — the feedback loop reads the whole
 * list, fixes, and re-audits. `catalog` supplies measured placeable facts. */
export function auditLotPlan(plan: LotPlan, catalog: Map<string, LotPlaceableFacts>): LotFinding[] {
  const findings: LotFinding[] = [];
  const wallKeys = new Set(plan.walls.map((wall) => lotEdgeKey(wall.edge)));
  const doorKeys = new Set(plan.openings.filter((o) => o.kind === 'door').map((o) => lotEdgeKey(o.edge)));

  for (const opening of plan.openings) {
    const key = lotEdgeKey(opening.edge);
    if (!wallKeys.has(key)) {
      findings.push({
        severity: 'refusal',
        code: 'opening-without-wall',
        message: `${opening.kind} at ${key} has no wall to cut through`,
        subject: key,
      });
    }
  }

  // Placement occupancy, measured against catalog facts.
  const occupancy = new Map<number, string>();
  for (const placement of plan.placements) {
    const facts = catalog.get(placement.placeableId);
    if (!facts) {
      findings.push({
        severity: 'refusal',
        code: 'placement-unknown-placeable',
        message: `placement '${placement.id}' references unmeasured placeable '${placement.placeableId}'`,
        subject: placement.id,
      });
      continue;
    }
    const rect = lotPlacementRect(placement, facts);
    if (rect.columnU + rect.widthU > plan.widthU || rect.rowU + rect.depthU > plan.heightU) {
      findings.push({
        severity: 'refusal',
        code: 'placement-out-of-bounds',
        message: `placement '${placement.id}' (${facts.name}, ${rect.widthU}×${rect.depthU} u) leaves the ${plan.widthU}×${plan.heightU} lot`,
        subject: placement.id,
      });
      continue;
    }
    for (let r = rect.rowU; r < rect.rowU + rect.depthU; r += 1) {
      for (let c = rect.columnU; c < rect.columnU + rect.widthU; c += 1) {
        const index = r * plan.widthU + c;
        const holder = occupancy.get(index);
        if (holder !== undefined && holder !== placement.id) {
          findings.push({
            severity: 'refusal',
            code: 'placement-overlap',
            message: `placement '${placement.id}' overlaps '${holder}' at tile ${c},${r}`,
            subject: placement.id,
          });
        } else {
          occupancy.set(index, placement.id);
        }
      }
    }
    if (facts.mount === 'wall') {
      const backed = rectBoundaryEdges(rect).some((edge) => wallKeys.has(lotEdgeKey(edge)));
      if (!backed) {
        findings.push({
          severity: 'refusal',
          code: 'wall-mount-without-wall',
          message: `placement '${placement.id}' (${facts.name}) is wall-mounted but no wall touches its footprint`,
          subject: placement.id,
        });
      }
    }
  }

  // A door's two flanking cells stay walkable.
  for (const opening of plan.openings) {
    if (opening.kind !== 'door') continue;
    for (const cell of edgeCells(plan, opening.edge)) {
      const holder = occupancy.get(cell.rowU * plan.widthU + cell.columnU);
      if (holder !== undefined) {
        findings.push({
          severity: 'refusal',
          code: 'placement-blocks-door',
          message: `placement '${holder}' blocks the door at ${lotEdgeKey(opening.edge)}`,
          subject: holder,
        });
      }
    }
  }

  // Reachability: flood from the exterior through unwalled edges and doors.
  // A walled edge without a door does not connect; windows do not connect.
  const reachable = new Set<number>();
  const queue: number[] = [];
  const traversable = (edge: LotEdge): boolean => !wallKeys.has(lotEdgeKey(edge)) || doorKeys.has(lotEdgeKey(edge));
  for (let c = 0; c < plan.widthU; c += 1) {
    if (traversable({ orientation: 'h', columnU: c, rowU: 0 })) queue.push(c);
    if (traversable({ orientation: 'h', columnU: c, rowU: plan.heightU })) queue.push((plan.heightU - 1) * plan.widthU + c);
  }
  for (let r = 0; r < plan.heightU; r += 1) {
    if (traversable({ orientation: 'v', columnU: 0, rowU: r })) queue.push(r * plan.widthU);
    if (traversable({ orientation: 'v', columnU: plan.widthU, rowU: r })) queue.push(r * plan.widthU + plan.widthU - 1);
  }
  while (queue.length > 0) {
    const index = queue.pop()!;
    if (reachable.has(index)) continue;
    reachable.add(index);
    const c = index % plan.widthU;
    const r = (index - c) / plan.widthU;
    if (c > 0 && traversable({ orientation: 'v', columnU: c, rowU: r })) queue.push(index - 1);
    if (c + 1 < plan.widthU && traversable({ orientation: 'v', columnU: c + 1, rowU: r })) queue.push(index + 1);
    if (r > 0 && traversable({ orientation: 'h', columnU: c, rowU: r })) queue.push(index - plan.widthU);
    if (r + 1 < plan.heightU && traversable({ orientation: 'h', columnU: c, rowU: r + 1 })) queue.push(index + plan.widthU);
  }
  const sealedRooms = new Set<number>();
  plan.cells.forEach((room, index) => {
    if (room >= 0 && !reachable.has(index)) sealedRooms.add(room);
  });
  for (const room of sealedRooms) {
    findings.push({
      severity: 'warning',
      code: 'room-sealed',
      message: `room '${plan.rooms[room]!.name}' cannot be reached from outside the lot — no door leads in`,
      subject: plan.rooms[room]!.id,
    });
  }

  return findings;
}
