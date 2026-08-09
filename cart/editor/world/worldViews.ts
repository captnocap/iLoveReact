// worldViews.ts — saved camera views for the iso build surface (req_4168).
//
// A 25×25-chunk map is 3 km on a side. Getting back to the block you were
// working on by panning is not navigation, it is a search, so the editor lets
// you PIN where you are standing and jump back to it by name.
//
// A view is the whole authoring context, not just a position: where the camera
// orbits (centre), how it is turned and tilted, how close it sits, AND which
// storey was active. Recalling one that dropped the floor would land you above
// or below the work you pinned, which is the failure the pin exists to prevent.
//
// The model surface pins views too (ModelView's camMarks, req_3067/req_3074) —
// same vocabulary, deliberately: Store View / Recall View / a VIEWS list. The
// difference is lifetime. A model bookmark lives in a hot twig and a cold start
// drops it; a world view rides world.json, because a map you return to next week
// is exactly the map that needed the pin.
//
// Pure module: it owns the shape, its validation, and the pose math. The stage
// applies a view; the store persists one; neither knows how the other works.

import type { IsoPose } from './isoStage';

export type WorldView = {
  /** Stable across renames and reorders — what a recall targets. */
  id: string;
  name: string;
  /** World metres the view orbits over. */
  centerX: number;
  centerZ: number;
  /** Compass rotation, degrees. */
  yaw: number;
  /** Elevation above the horizon, degrees. */
  pitch: number;
  /** 1 = the stage's base distance; larger is closer. */
  zoom: number;
  /** Active storey at pin time (0 = Ground). Recall restores it. */
  floor: number;
};

export const WORLD_VIEW_LIMITS = {
  /** Per map. Views are a navigation aid; past this the list is the problem. */
  maxViews: 64,
  maxNameChars: 48,
  /** Generous world bound — the coordinate is metres, not tiles. */
  maxCoordinateMeters: 1_000_000,
  maxFloor: 512,
} as const;

/** The pose fields a view carries, without the identity the store assigns. */
export type WorldViewPose = Omit<WorldView, 'id' | 'name'>;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedCoordinate(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= WORLD_VIEW_LIMITS.maxCoordinateMeters;
}

/** Strict shape check for a persisted view — the world.json parser's gate. */
export function validWorldView(value: unknown): value is WorldView {
  const view = value as Partial<WorldView> | null;
  return !!view
    && typeof view.id === 'string'
    && view.id.length > 0
    && typeof view.name === 'string'
    && view.name.length > 0
    && view.name.length <= WORLD_VIEW_LIMITS.maxNameChars
    && boundedCoordinate(view.centerX)
    && boundedCoordinate(view.centerZ)
    && finite(view.yaw)
    && finite(view.pitch)
    && finite(view.zoom)
    && view.zoom > 0
    && finite(view.floor)
    && Number.isInteger(view.floor)
    && view.floor >= 0
    && view.floor <= WORLD_VIEW_LIMITS.maxFloor;
}

/** Reject a saved list that repeats an id — two rows a recall cannot tell apart. */
export function validateUniqueViewIds(views: readonly WorldView[]): void {
  const ids = new Set<string>();
  for (const view of views) {
    if (ids.has(view.id)) throw new Error(`view '${view.id}' is duplicated`);
    ids.add(view.id);
  }
}

/** Capture the live authoring context as a view's pose. */
export function worldViewPoseFrom(pose: IsoPose, floor: number): WorldViewPose {
  return {
    centerX: pose.centerX,
    centerZ: pose.centerZ,
    yaw: pose.yaw,
    pitch: pose.pitch,
    zoom: pose.zoom,
    floor: Math.max(0, Math.round(floor)),
  };
}

/** The pose half of a view, as the partial IsoStage seeds/restores from. */
export function isoPoseFrom(view: WorldView): Partial<IsoPose> {
  return {
    centerX: view.centerX,
    centerZ: view.centerZ,
    yaw: view.yaw,
    pitch: view.pitch,
    zoom: view.zoom,
    level: view.floor,
  };
}

/** Number past the highest existing "View N" so removing one never reissues its
 *  name to a different place — the same rule the model surface's pins follow. */
export function nextWorldViewName(views: readonly WorldView[]): string {
  const top = views.reduce((highest, view) => {
    const match = /^View (\d+)$/.exec(view.name);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `View ${top + 1}`;
}

/** Append a pin, or refuse at the cap. `mintId` supplies the editor's sequence.
 *  A refusal returns the list UNCHANGED — same reference, so it cannot masquerade
 *  as an edit and schedule a pointless write. */
export function storeWorldView(
  views: readonly WorldView[],
  pose: WorldViewPose,
  mintId: () => string,
  name?: string,
): { views: WorldView[]; stored: WorldView | null } {
  if (views.length >= WORLD_VIEW_LIMITS.maxViews) return { views: views as WorldView[], stored: null };
  const trimmed = (name ?? '').trim();
  const stored: WorldView = {
    id: mintId(),
    name: trimmed.length > 0 ? trimmed.slice(0, WORLD_VIEW_LIMITS.maxNameChars) : nextWorldViewName(views),
    ...pose,
  };
  return { views: [...views, stored], stored };
}

export function removeWorldView(views: readonly WorldView[], id: string): WorldView[] {
  return views.filter((view) => view.id !== id);
}

export function renameWorldView(views: readonly WorldView[], id: string, name: string): WorldView[] {
  const trimmed = name.trim().slice(0, WORLD_VIEW_LIMITS.maxNameChars);
  if (trimmed.length === 0) return views as WorldView[];
  return views.map((view) => (view.id === id ? { ...view, name: trimmed } : view));
}

/** The view a bare Recall returns to: the one last stored or jumped to, falling
 *  back to the most recent pin so the key still works before anything is active. */
export function activeWorldView(views: readonly WorldView[], activeId: string | null): WorldView | null {
  if (views.length === 0) return null;
  return views.find((view) => view.id === activeId) ?? views[views.length - 1] ?? null;
}
