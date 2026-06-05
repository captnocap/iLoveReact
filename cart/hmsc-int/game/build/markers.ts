// game/build/markers — the WorldMarker union: the SEMANTIC OVERLAY data
// family (V24 addendum 3). "Pathing and triggers are not geometry. They are
// semantic overlays." Markers ANNOTATE the physical world — they reference
// pieces/rooms by id; they are the THIRD data family beside pieces and
// prefabs, under the same one-model rule: ANY authoring mode reads/edits
// them; the Sims/Plan view is just their natural editor (which is later work
// — this file is the data model, declared now).
//
// This is what the NPC system consumes: V21 deterministic schedules and
// micro-path tokens read authored semantic points ("cashier counter",
// "smoking spot", "bus stop", "staff door", "apartment bed").
//
// RECONCILIATION LAW (V24): where a marker kind overlaps a captured system,
// the marker is the AUTHORING representation that bakes into / references
// that system's data — never a second source of truth:
//   • trigger.event IS a console command line (the V19 command vocabulary);
//     the bake lands it as game/world's cell triggerCommand (spawn.ts).
//   • camera_marker.shot names a rig in the camera registry's vocabulary
//     (game/camera CAMERA_RIGS / the cutscene camera cues) — never a new
//     camera model.
//   • portal/room markers are the authored seam the bake reconciles against
//     the piece-derived room volumes/nav portals (a door WallEdit already
//     means portal; the marker names WHICH rooms it connects).
//   • mission objective markers stay game/missions' own (objectiveMarker) —
//     not this union.

// Positions/bounds are world meters on the 1m substrate (R4), mode-agnostic.
export type MarkerPos = { x: number; y: number; z: number };

export type MarkerBounds = {
  x: number; // min corner
  y: number;
  z: number;
  widthMeters: number;
  heightMeters: number;
  depthMeters: number;
};

// Room roles — the user's authoring-loop vocabulary. Extend by table row.
export type RoomRole = 'public' | 'private' | 'staff' | 'home';
export const ROOM_ROLES: RoomRole[] = ['public', 'private', 'staff', 'home'];

// Interest-point roles — the user-specified behavior-anchor vocabulary.
export type InterestPointRole = 'sit' | 'work' | 'shop' | 'guard' | 'smoke';
export const INTEREST_POINT_ROLES: InterestPointRole[] = ['sit', 'work', 'shop', 'guard', 'smoke'];

export type PathNodeMarker = {
  type: 'path_node';
  id: string;
  pos: MarkerPos;
  // Free semantic tags the pathing/token systems condition on ('patrol',
  // 'sidewalk', 'bus_stop', ...). Tags are data, never code.
  tags: string[];
};

export type TriggerMarker = {
  type: 'trigger';
  id: string;
  bounds: MarkerBounds;
  // A console command line (V19: anything testable is scriptable) — the bake
  // lands it on the covered cells as game/world triggerCommand.
  event: string;
};

export type RoomMarker = {
  type: 'room';
  id: string;
  // The floorplan outline in world meters (x/z), ≥3 points; y is the room's
  // floor level. Authored in Plan view; reconciled against piece-derived
  // room volumes at bake.
  polygon: Array<{ x: number; z: number }>;
  y: number;
  role: RoomRole;
};

export type PortalMarker = {
  type: 'portal';
  id: string;
  fromRoom: string; // room marker id
  toRoom: string; // room marker id
  // The placed piece (a wall carrying a door/arch/garageDoor edit) this
  // portal rides; optional — an open threshold needs no door.
  doorId?: string;
};

export type InterestPointMarker = {
  type: 'interest_point';
  id: string;
  pos: MarkerPos;
  role: InterestPointRole;
};

export type CameraMarker = {
  type: 'camera_marker';
  id: string;
  pos: MarkerPos;
  target: MarkerPos;
  // A shot name resolved through the camera registry's rig vocabulary
  // (GAME_CAMERA / cutscene cues) — the marker references, never redefines.
  shot: string;
};

export type WorldMarker =
  | PathNodeMarker
  | TriggerMarker
  | RoomMarker
  | PortalMarker
  | InterestPointMarker
  | CameraMarker;

export type WorldMarkerType = WorldMarker['type'];

export const WORLD_MARKER_TYPES: WorldMarkerType[] = [
  'path_node',
  'trigger',
  'room',
  'portal',
  'interest_point',
  'camera_marker',
];

export function isWorldMarkerType(value: string): value is WorldMarkerType {
  return (WORLD_MARKER_TYPES as string[]).includes(value);
}

// ── validation (the boundary, P3) ────────────────────────────────────────────

function isFinitePos(pos: MarkerPos): boolean {
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
}

/** Every way ONE marker can be malformed in isolation. Empty = valid. */
export function validateMarker(marker: WorldMarker): string[] {
  const problems: string[] = [];
  if (!marker.id) problems.push(`marker (${marker.type}): missing id`);
  switch (marker.type) {
    case 'path_node':
      if (!isFinitePos(marker.pos)) problems.push(`${marker.id}: non-finite pos`);
      if (!Array.isArray(marker.tags)) problems.push(`${marker.id}: tags must be an array`);
      break;
    case 'trigger': {
      const b = marker.bounds;
      if (!(b.widthMeters > 0) || !(b.heightMeters > 0) || !(b.depthMeters > 0))
        problems.push(`${marker.id}: trigger bounds must have positive extent`);
      if (!marker.event.trim())
        problems.push(`${marker.id}: trigger event must be a command line (V19 vocabulary)`);
      break;
    }
    case 'room':
      if (marker.polygon.length < 3)
        problems.push(`${marker.id}: a room polygon needs at least 3 points`);
      if (!(ROOM_ROLES as string[]).includes(marker.role))
        problems.push(`${marker.id}: unknown room role '${marker.role}'`);
      break;
    case 'portal':
      if (!marker.fromRoom || !marker.toRoom)
        problems.push(`${marker.id}: a portal references two rooms`);
      if (marker.fromRoom === marker.toRoom)
        problems.push(`${marker.id}: a portal connects two DIFFERENT rooms`);
      if (marker.doorId !== undefined && !marker.doorId)
        problems.push(`${marker.id}: doorId, when present, must reference a placed piece`);
      break;
    case 'interest_point':
      if (!isFinitePos(marker.pos)) problems.push(`${marker.id}: non-finite pos`);
      if (!(INTEREST_POINT_ROLES as string[]).includes(marker.role))
        problems.push(`${marker.id}: unknown interest-point role '${marker.role}'`);
      break;
    case 'camera_marker':
      if (!isFinitePos(marker.pos) || !isFinitePos(marker.target))
        problems.push(`${marker.id}: non-finite pos/target`);
      if (!marker.shot.trim())
        problems.push(`${marker.id}: shot must name a camera-registry rig/shot`);
      break;
  }
  return problems;
}

/** Validate a marker SET: per-marker shape plus the cross-references —
 *  unique ids; every portal's fromRoom/toRoom resolves to a room marker in
 *  the set. (doorId targets live in the V20 placement streams, so piece
 *  existence is the bake's check, not a static one.) */
export function validateMarkers(markers: WorldMarker[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const roomIds = new Set<string>();
  for (const marker of markers) {
    if (seen.has(marker.id)) problems.push(`${marker.id}: duplicate marker id`);
    seen.add(marker.id);
    if (marker.type === 'room') roomIds.add(marker.id);
    problems.push(...validateMarker(marker));
  }
  for (const marker of markers) {
    if (marker.type !== 'portal') continue;
    if (!roomIds.has(marker.fromRoom))
      problems.push(`${marker.id}: fromRoom '${marker.fromRoom}' is not a room marker in this set`);
    if (!roomIds.has(marker.toRoom))
      problems.push(`${marker.id}: toRoom '${marker.toRoom}' is not a room marker in this set`);
  }
  return problems;
}

export function markersOfType<T extends WorldMarkerType>(
  markers: WorldMarker[],
  type: T,
): Extract<WorldMarker, { type: T }>[] {
  return markers.filter((marker) => marker.type === type) as Extract<WorldMarker, { type: T }>[];
}

export function markerTypeNamesForConsole(): string {
  return WORLD_MARKER_TYPES.join(', ');
}
