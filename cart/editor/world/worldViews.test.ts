// Saved camera views (req_4168). Run with the same esbuild aliases as pieces.test.ts.
import {
  activeWorldView,
  isoPoseFrom,
  nextWorldViewName,
  removeWorldView,
  renameWorldView,
  storeWorldView,
  validWorldView,
  validateUniqueViewIds,
  worldViewPoseFrom,
  WORLD_VIEW_LIMITS,
  type WorldView,
} from './worldViews';
import type { IsoPose } from './isoStage';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

const pose: IsoPose = { centerX: 412.5, centerZ: -87.25, yaw: 135, pitch: 41, zoom: 0.4, level: 2 };

// ── capture keeps the WHOLE authoring context, storey included ──────────────
const captured = worldViewPoseFrom(pose, 2);
assert(captured.centerX === 412.5 && captured.centerZ === -87.25, 'capture lost the orbit centre');
assert(captured.yaw === 135 && captured.pitch === 41 && captured.zoom === 0.4, 'capture lost facing/tilt/zoom');
assert(captured.floor === 2, 'capture lost the active storey — a recall would land a floor off');

// The action bar's floor is the authority, not the stage's mirror of it.
assert(worldViewPoseFrom(pose, 5).floor === 5, 'capture preferred the stage level over the active floor');
assert(worldViewPoseFrom(pose, -3).floor === 0, 'capture kept a below-ground storey');

// ── store / name / cap ─────────────────────────────────────────────────────
let ids = 0;
const mint = () => `view-${ids++}`;
const first = storeWorldView([], captured, mint);
assert(first.stored?.name === 'View 1', 'first pin was not View 1');
const second = storeWorldView(first.views, captured, mint);
assert(second.stored?.name === 'View 2', 'second pin did not number past the first');

// Removing a pin must not reissue its name to a different place.
const afterRemove = removeWorldView(second.views as WorldView[], first.stored!.id);
assert(afterRemove.length === 1, 'remove did not drop exactly one pin');
assert(nextWorldViewName(afterRemove) === 'View 3', 'a removed pin\'s name was reissued');

const named = storeWorldView([], captured, mint, '  Downtown core  ');
assert(named.stored?.name === 'Downtown core', 'an explicit name was not trimmed and kept');

const full: WorldView[] = Array.from({ length: WORLD_VIEW_LIMITS.maxViews }, (_, i) => ({
  id: `full-${i}`, name: `View ${i + 1}`, ...captured,
}));
assert(storeWorldView(full, captured, mint).stored === null, 'the view cap did not refuse');

// ── recall targets ─────────────────────────────────────────────────────────
const views = second.views as WorldView[];
assert(activeWorldView(views, views[0]!.id)?.id === views[0]!.id, 'recall did not honour the active pin');
assert(activeWorldView(views, 'gone')?.id === views[1]!.id, 'a stale active id did not fall back to the newest pin');
assert(activeWorldView([], null) === null, 'recall invented a pin on an empty map');

// ── the pose a recall applies ──────────────────────────────────────────────
const applied = isoPoseFrom(views[0]!);
assert(applied.level === 2, 'recall dropped the storey');
assert(applied.centerX === 412.5 && applied.yaw === 135 && applied.zoom === 0.4, 'recall dropped part of the pose');

// ── rename ─────────────────────────────────────────────────────────────────
const renamed = renameWorldView(views, views[0]!.id, ' Harbor ');
assert(renamed[0]!.name === 'Harbor', 'rename did not trim');
assert(renameWorldView(views, views[0]!.id, '   ')[0]!.name === views[0]!.name, 'an empty rename erased a name');

// ── persistence gate: what world.json will and will not accept ─────────────
const sound: WorldView = { id: 'v', name: 'View 1', ...captured };
assert(validWorldView(sound), 'a sound view was rejected');
assert(!validWorldView({ ...sound, zoom: 0 }), 'a zero zoom was accepted');
assert(!validWorldView({ ...sound, zoom: Number.NaN }), 'NaN zoom was accepted');
assert(!validWorldView({ ...sound, floor: 1.5 }), 'a fractional storey was accepted');
assert(!validWorldView({ ...sound, floor: -1 }), 'a negative storey was accepted');
assert(!validWorldView({ ...sound, name: '' }), 'an empty name was accepted');
assert(!validWorldView({ ...sound, name: 'x'.repeat(WORLD_VIEW_LIMITS.maxNameChars + 1) }), 'an overlong name was accepted');
assert(!validWorldView({ ...sound, centerX: WORLD_VIEW_LIMITS.maxCoordinateMeters * 2 }), 'an out-of-world centre was accepted');
assert(!validWorldView(null) && !validWorldView({}), 'a malformed row was accepted');

let duplicateRejected = false;
try { validateUniqueViewIds([sound, { ...sound, name: 'View 2' }]); } catch { duplicateRejected = true; }
assert(duplicateRejected, 'two pins sharing an id were accepted — a recall could not tell them apart');

console.log('worldViews.test: ok');
