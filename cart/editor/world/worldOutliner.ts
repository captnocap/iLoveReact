// editor/world/worldOutliner.ts — the world outliner's pure read-model (req_4737).
//
// Everything PLACED on the active map, projected as one grouped tree: semantic
// wall components as BUILDINGS, touching placed-piece components as STRUCTURES,
// lone placements as PROPS, and painted flora as species → patch → plant
// groups. This is a PROJECTION over the slices world.json already persists —
// no parallel store, no new ids. Rows carry the selection target the existing
// world selection state understands plus a camera focus point, so the panel and
// the viewport stay two views over the same selection.
//
// Grouping laws (USER ASK req_4737):
//  - flora never floods the top level: a patch is ALWAYS a nested group and its
//    derived plants are its children (worldFloraPatchInstances — the renderer's
//    exact scatter, so a row and a drawn tree can never disagree);
//  - detectably-connected walls form one building group (shared wall vertices);
//  - detectably-touching placed pieces form one structure group
//    (pieceVolumesTouch — the same contact law Shift-click selection uses).
import {
  ARCHITECTURE_UNITS_PER_METER,
  type ArchitectureSource,
  type WallEdge,
  type WallVertex,
} from './architecture';
import { pieceFloorOf, pieceLook, type PlacedPiece } from './pieces';
import { pieceSelectionVolume, pieceVolumesTouch } from './selection';
import {
  worldFloraPatchInstances,
  builtinFloraKindFromId,
  floraLaneForSpeciesId,
  type WorldFloraPatch,
} from './surfaceFlora';
import { FLORA_KIND_DEFINITIONS } from './floraKinds';
import type { AuthoredFloraSpecies } from './floraSpecies';

/** What clicking a row selects — every variant maps onto selection state the
 * world surface already renders (pieces, walls, openings) or the flora patch
 * selection introduced with this panel. */
export type WorldOutlinerTarget =
  | { kind: 'piece'; id: string }
  | { kind: 'pieceGroup'; ids: readonly string[] }
  | { kind: 'wallEdge'; edgeId: string }
  | { kind: 'building'; edgeIds: readonly string[] }
  | { kind: 'wallOpening'; edgeId: string; openingId: string }
  | { kind: 'floraPatch'; id: string };

/** Where a Locate verb should recenter the camera. `floor` null keeps the
 * current storey (flora sits on terrain; jumping storeys would be noise). */
export type WorldOutlinerFocus = { x: number; z: number; floor: number | null; label: string };

export type WorldOutlinerRow = {
  key: string;
  label: string;
  /** faint right-aligned facts (counts, length, storey) */
  meta: string;
  icon: string;
  target: WorldOutlinerTarget | null;
  focus: WorldOutlinerFocus | null;
  children: readonly WorldOutlinerRow[];
};

export type WorldOutlinerSectionKey = 'buildings' | 'structures' | 'props' | 'flora';

export type WorldOutlinerSection = {
  key: WorldOutlinerSectionKey;
  label: string;
  icon: string;
  /** leaf entity count shown beside the section label */
  count: number;
  rows: readonly WorldOutlinerRow[];
};

export type WorldOutlinerInput = {
  architecture: ArchitectureSource;
  pieces: readonly PlacedPiece[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
};

function formatMeters(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// ── union-find, shared by both connectivity passes ────────────────────────────
function findRoot(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root) root = parents[root]!;
  while (parents[index] !== root) {
    const next = parents[index]!;
    parents[index] = root;
    index = next;
  }
  return root;
}

function union(parents: number[], a: number, b: number): void {
  const rootA = findRoot(parents, a);
  const rootB = findRoot(parents, b);
  if (rootA !== rootB) parents[rootB] = rootA;
}

// ── BUILDINGS: connected wall components over shared vertices ─────────────────
type WallComponent = {
  edges: WallEdge[];
  /** the smallest member edge id — the component's stable sort anchor */
  anchorEdgeId: string;
};

export function wallComponents(architecture: ArchitectureSource): WallComponent[] {
  const edges = architecture.walls.edges;
  if (edges.length === 0) return [];
  const vertexSlot = new Map<string, number>();
  architecture.walls.vertices.forEach((vertex, index) => vertexSlot.set(vertex.id, index));
  const parents = architecture.walls.vertices.map((_, index) => index);
  for (const edge of edges) {
    const start = vertexSlot.get(edge.startVertexId);
    const end = vertexSlot.get(edge.endVertexId);
    if (start !== undefined && end !== undefined) union(parents, start, end);
  }
  const byRoot = new Map<number, WallEdge[]>();
  for (const edge of edges) {
    const slot = vertexSlot.get(edge.startVertexId) ?? vertexSlot.get(edge.endVertexId);
    const root = slot === undefined ? -1 : findRoot(parents, slot);
    byRoot.set(root, [...(byRoot.get(root) ?? []), edge]);
  }
  return [...byRoot.values()]
    .map((members) => ({
      edges: members,
      anchorEdgeId: members.reduce((least, edge) => (edge.id < least ? edge.id : least), members[0]!.id),
    }))
    .sort((a, b) => a.anchorEdgeId.localeCompare(b.anchorEdgeId));
}

function wallGeometry(edge: WallEdge, vertexById: Map<string, WallVertex>): {
  lengthM: number; midX: number; midZ: number; floor: number;
} | null {
  const start = vertexById.get(edge.startVertexId);
  const end = vertexById.get(edge.endVertexId);
  if (!start || !end) return null;
  const dx = (end.xU - start.xU) / ARCHITECTURE_UNITS_PER_METER;
  const dz = (end.zU - start.zU) / ARCHITECTURE_UNITS_PER_METER;
  return {
    lengthM: Math.hypot(dx, dz),
    midX: (start.xU + end.xU) / 2 / ARCHITECTURE_UNITS_PER_METER,
    midZ: (start.zU + end.zU) / 2 / ARCHITECTURE_UNITS_PER_METER,
    floor: start.floor,
  };
}

function buildingRows(architecture: ArchitectureSource): WorldOutlinerRow[] {
  const vertexById = new Map(architecture.walls.vertices.map((vertex) => [vertex.id, vertex]));
  return wallComponents(architecture).map((component, index) => {
    const label = `Building ${index + 1}`;
    let sumX = 0;
    let sumZ = 0;
    let placed = 0;
    let openings = 0;
    let minFloor = Number.POSITIVE_INFINITY;
    const children: WorldOutlinerRow[] = [];
    for (const edge of component.edges) {
      const geometry = wallGeometry(edge, vertexById);
      openings += edge.openings.length;
      if (geometry) {
        sumX += geometry.midX;
        sumZ += geometry.midZ;
        placed += 1;
        minFloor = Math.min(minFloor, geometry.floor);
      }
      const wallLabel = geometry ? `Wall · ${formatMeters(geometry.lengthM)}m` : 'Wall';
      const wallFocus: WorldOutlinerFocus | null = geometry
        ? { x: geometry.midX, z: geometry.midZ, floor: geometry.floor, label: wallLabel }
        : null;
      children.push({
        key: `wall:${edge.id}`,
        label: wallLabel,
        meta: geometry ? `F${geometry.floor} · ${edge.styleId}` : edge.styleId,
        icon: 'BrickWall',
        target: { kind: 'wallEdge', edgeId: edge.id },
        focus: wallFocus,
        children: edge.openings.map((opening) => ({
          key: `opening:${edge.id}:${opening.id}`,
          label: opening.kind,
          meta: opening.kitId,
          icon: opening.kind === 'window' ? 'AppWindow' : 'DoorOpen',
          target: { kind: 'wallOpening', edgeId: edge.id, openingId: opening.id },
          focus: wallFocus ? { ...wallFocus, label: opening.kind } : null,
          children: [],
        })),
      });
    }
    return {
      key: `building:${component.anchorEdgeId}`,
      label,
      meta: openings > 0
        ? `${plural(component.edges.length, 'wall')} · ${plural(openings, 'opening')}`
        : plural(component.edges.length, 'wall'),
      icon: 'House',
      target: { kind: 'building', edgeIds: component.edges.map((edge) => edge.id) },
      focus: placed > 0
        ? { x: sumX / placed, z: sumZ / placed, floor: Number.isFinite(minFloor) ? minFloor : null, label }
        : null,
      children,
    };
  });
}

// ── STRUCTURES + PROPS: touching-piece components ─────────────────────────────
export function pieceComponents(pieces: readonly PlacedPiece[]): PlacedPiece[][] {
  if (pieces.length === 0) return [];
  const volumes = pieces.map(pieceSelectionVolume);
  const parents = pieces.map((_, index) => index);
  for (let a = 0; a < pieces.length; a += 1) {
    if (!volumes[a]) continue;
    for (let b = a + 1; b < pieces.length; b += 1) {
      if (!volumes[b]) continue;
      if (pieceVolumesTouch(volumes[a]!, volumes[b]!)) union(parents, a, b);
    }
  }
  const byRoot = new Map<number, PlacedPiece[]>();
  pieces.forEach((piece, index) => {
    const root = findRoot(parents, index);
    byRoot.set(root, [...(byRoot.get(root) ?? []), piece]);
  });
  return [...byRoot.values()]
    .sort((a, b) => a[0]!.id.localeCompare(b[0]!.id));
}

function pieceRow(
  piece: PlacedPiece,
  speciesLabelFor: (speciesId: string) => string,
): WorldOutlinerRow {
  const label = pieceLook(piece.pieceId)?.label ?? piece.pieceId;
  const floor = pieceFloorOf(piece);
  const surfacePatches = piece.surfaceFlora ?? [];
  return {
    key: `piece:${piece.id}`,
    label,
    meta: surfacePatches.length > 0
      ? `F${floor} · ${plural(surfacePatches.length, 'flora patch')}`
      : `F${floor}`,
    icon: 'Box',
    target: { kind: 'piece', id: piece.id },
    focus: { x: piece.x, z: piece.z, floor, label },
    // Flora painted ON the piece nests under it — selecting locates the owner.
    children: surfacePatches.map((patch) => ({
      key: `surface-flora:${piece.id}:${patch.id}`,
      label: speciesLabelFor(patch.speciesId),
      meta: `r ${formatMeters(patch.radiusM)}m`,
      icon: 'Sprout',
      target: { kind: 'piece', id: piece.id },
      focus: { x: piece.x, z: piece.z, floor, label },
      children: [],
    })),
  };
}

// ── FLORA: species → patch → derived plants ───────────────────────────────────
function floraRows(
  worldFlora: readonly WorldFloraPatch[],
  floraSpecies: readonly AuthoredFloraSpecies[],
  speciesLabelFor: (speciesId: string) => string,
): WorldOutlinerRow[] {
  const bySpecies = new Map<string, WorldFloraPatch[]>();
  for (const patch of worldFlora) {
    bySpecies.set(patch.speciesId, [...(bySpecies.get(patch.speciesId) ?? []), patch]);
  }
  return [...bySpecies.entries()]
    .sort(([a], [b]) => speciesLabelFor(a).localeCompare(speciesLabelFor(b)))
    .map(([speciesId, patches]) => {
      const speciesLabel = speciesLabelFor(speciesId);
      const lane = floraLaneForSpeciesId(speciesId, floraSpecies);
      let plantTotal = 0;
      const children = patches.map((patch, index) => {
        const plants = lane ? worldFloraPatchInstances(patch, lane) : [];
        plantTotal += lane ? plants.length : 0;
        const patchLabel = `Patch ${index + 1}`;
        return {
          key: `flora:${patch.id}`,
          label: patchLabel,
          meta: `${plural(plants.length, 'plant')} · r ${formatMeters(patch.radiusM)}m`,
          icon: 'Shrub',
          target: { kind: 'floraPatch', id: patch.id } as const,
          focus: { x: patch.x, z: patch.z, floor: null, label: `${speciesLabel} ${patchLabel.toLowerCase()}` },
          children: plants.map((point, plantIndex) => ({
            key: `flora:${patch.id}:plant:${plantIndex}`,
            label: `${speciesLabel} ${plantIndex + 1}`,
            meta: '',
            icon: 'TreePine',
            // A derived plant has no identity of its own — selecting it selects
            // its patch; locating it still lands on the exact scattered spot.
            target: { kind: 'floraPatch', id: patch.id } as const,
            focus: { x: point.x, z: point.z, floor: null, label: `${speciesLabel} ${plantIndex + 1}` },
            children: [],
          })),
        };
      });
      return {
        key: `flora-species:${speciesId}`,
        label: speciesLabel,
        meta: `${plural(patches.length, 'patch')} · ${plural(plantTotal, 'plant')}`,
        icon: 'Trees',
        target: null,
        focus: null,
        children,
      };
    });
}

function speciesLabelResolver(floraSpecies: readonly AuthoredFloraSpecies[]): (speciesId: string) => string {
  return (speciesId) => {
    const authored = floraSpecies.find((species) => species.id === speciesId);
    if (authored) return authored.label;
    const kind = builtinFloraKindFromId(speciesId);
    return FLORA_KIND_DEFINITIONS.find((definition) => definition.kind === kind)?.label ?? speciesId;
  };
}

export function buildWorldOutliner(input: WorldOutlinerInput): WorldOutlinerSection[] {
  const speciesLabelFor = speciesLabelResolver(input.floraSpecies);
  const buildings = buildingRows(input.architecture);
  const components = pieceComponents(input.pieces);
  const grouped = components.filter((component) => component.length > 1);
  const single = components.filter((component) => component.length === 1).map((component) => component[0]!);
  const structureRows = grouped.map((component, index) => {
    const label = `Structure ${index + 1}`;
    const floors = component.map(pieceFloorOf);
    return {
      key: `structure:${component[0]!.id}`,
      label,
      meta: plural(component.length, 'piece'),
      icon: 'Blocks',
      target: { kind: 'pieceGroup', ids: component.map((piece) => piece.id) } as const,
      focus: {
        x: component.reduce((sum, piece) => sum + piece.x, 0) / component.length,
        z: component.reduce((sum, piece) => sum + piece.z, 0) / component.length,
        floor: Math.min(...floors),
        label,
      },
      children: component.map((piece) => pieceRow(piece, speciesLabelFor)),
    };
  });
  const propRows = single.map((piece) => pieceRow(piece, speciesLabelFor));
  const flora = floraRows(input.worldFlora, input.floraSpecies, speciesLabelFor);
  return [
    { key: 'buildings', label: 'BUILDINGS', icon: 'House', count: buildings.length, rows: buildings },
    { key: 'structures', label: 'STRUCTURES', icon: 'Blocks', count: structureRows.length, rows: structureRows },
    { key: 'props', label: 'PROPS', icon: 'Box', count: propRows.length, rows: propRows },
    { key: 'flora', label: 'FLORA', icon: 'Trees', count: input.worldFlora.length, rows: flora },
  ];
}

/** The row keys a selection state highlights — the reverse direction of the
 * two-way contract: a viewport pick lights (and auto-expands to) its row. */
export function selectedOutlinerKeys(selection: {
  selectedPieceIds: readonly string[];
  architectureSelection:
    | { kind: 'none' }
    | { kind: 'wallVertex'; vertexId: string }
    | { kind: 'wallEdge'; edgeId: string; side: 'a' | 'b' }
    | { kind: 'wallOpening'; edgeId: string; openingId: string }
    | { kind: 'wallAnchor'; anchorId: string };
  selectedFloraPatchId: string | null;
}): Set<string> {
  const keys = new Set<string>();
  for (const id of selection.selectedPieceIds) keys.add(`piece:${id}`);
  const architecture = selection.architectureSelection;
  if (architecture.kind === 'wallEdge') keys.add(`wall:${architecture.edgeId}`);
  if (architecture.kind === 'wallOpening') keys.add(`opening:${architecture.edgeId}:${architecture.openingId}`);
  if (selection.selectedFloraPatchId) keys.add(`flora:${selection.selectedFloraPatchId}`);
  return keys;
}

/** Ancestor group keys for every selected row, so the panel can auto-expand the
 * path to a viewport pick that is currently folded away. */
export function outlinerExpansionForSelection(
  sections: readonly WorldOutlinerSection[],
  selectedKeys: ReadonlySet<string>,
): Set<string> {
  const expand = new Set<string>();
  const visit = (row: WorldOutlinerRow, ancestors: readonly string[]): void => {
    if (selectedKeys.has(row.key)) for (const key of ancestors) expand.add(key);
    for (const child of row.children) visit(child, [...ancestors, row.key]);
  };
  for (const section of sections) {
    for (const row of section.rows) visit(row, []);
  }
  return expand;
}
