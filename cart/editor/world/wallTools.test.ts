import {
  beginWallDraw,
  commitWallDraw,
  IDLE_WALL_GESTURE,
  snapWallPoint,
  wallDrawCommand,
  wallPointerRelease,
  wallVertexMagnet,
  WALL_SNAP_U,
} from './wallTools';
import { emptyArchitectureSource, type ArchitectureSource } from './architecture';
import type { ArchitectureCatalogEntry } from './architectureHost';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    log(`not ok - ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sourceWithVertex(id: string, floor: number, xU: number, zU: number): ArchitectureSource {
  const source = emptyArchitectureSource();
  return {
    ...source,
    walls: { ...source.walls, vertices: [{ id, floor, xU, zU }] },
  };
}

const measuredStyle: ArchitectureCatalogEntry = {
  catalogId: 'build:wall:style:basic',
  contentHash: 'a'.repeat(64),
  packageId: 'package:wall-basic',
  label: 'Basic Wall',
  family: 'wall',
  role: 'style',
  categoryPath: ['Walls', 'Basic'],
  themeTags: [],
  gameplayTags: [],
  measurement: {
    sourceBoundsU: { minXU: -24, minYU: 0, minZU: -2, maxXU: 24, maxYU: 48, maxZU: 2 },
    clearanceMask: [],
    pivotU: { xU: 0, yU: 0, zU: 0 },
  },
  wallStyleDefaults: { heightU: 48, thicknessU: 4, profile: 'full' },
  assetRefs: { meshContentHash: 'b'.repeat(64), materialContentHashes: [] },
};

test('ground picks snap to the one-meter lattice by default', () => {
  const snapped = snapWallPoint(1.4, -2.6);
  assert(snapped !== null && snapped.xU === 16 && snapped.zU === -48, `snap drifted: ${JSON.stringify(snapped)}`);
  assert(WALL_SNAP_U === 16, 'default snap is not one meter');
  const fine = snapWallPoint(1.4, -2.6, 1);
  assert(fine !== null && fine.xU === 22 && fine.zU === -42, 'whole-u fine snap drifted');
});

test('non-finite picks and invalid snap sizes are dropped, never guessed', () => {
  assert(snapWallPoint(Number.NaN, 0) === null, 'NaN pick was accepted');
  assert(snapWallPoint(0, Number.POSITIVE_INFINITY) === null, 'infinite pick was accepted');
  assert(snapWallPoint(1, 1, 0) === null, 'zero snap was accepted');
  assert(snapWallPoint(1, 1, 2.5) === null, 'fractional snap was accepted');
});

test('a click near an existing vertex magnetizes to its exact position and id', () => {
  const source = sourceWithVertex('v:corner', 0, 48, 0);
  const magnet = wallVertexMagnet(source, 0, { xU: 52, zU: 4 });
  assert(magnet !== null && magnet.id === 'v:corner', 'nearby vertex was not magnetized');
  assert(wallVertexMagnet(source, 0, { xU: 64, zU: 0 }) === null, 'magnet radius is too permissive');
  assert(wallVertexMagnet(source, 1, { xU: 48, zU: 0 }) === null, 'magnet crossed floors');
});

test('click-click draw commits one span with magnetized endpoints', () => {
  const source = sourceWithVertex('v:corner', 0, 96, 0);
  const gesture = beginWallDraw(source, 0, { xU: 0, zU: 0 });
  assert(gesture.kind === 'anchored' && gesture.start.xU === 0, 'first click did not anchor');
  const outcome = commitWallDraw(source, gesture, { xU: 92, zU: 4 });
  assert(outcome.status === 'committed', `commit rejected: ${outcome.status === 'rejected' ? outcome.reason : ''}`);
  assert(outcome.commit.end.xU === 96 && outcome.commit.end.zU === 0, 'end did not magnetize to the exact vertex');
  assert(outcome.commit.endMagnetVertexId === 'v:corner', 'magnet vertex id was dropped');
});

test('zero-length spans and unanchored commits reject before the host', () => {
  const source = emptyArchitectureSource();
  const gesture = beginWallDraw(source, 0, { xU: 16, zU: 16 });
  const zero = commitWallDraw(source, gesture, { xU: 16, zU: 16 });
  assert(zero.status === 'rejected', 'zero-length span was committed');
  const unanchored = commitWallDraw(source, IDLE_WALL_GESTURE, { xU: 32, zU: 0 });
  assert(unanchored.status === 'rejected', 'commit without an anchor was accepted');
});

test('one committed gesture becomes one command measured entirely by the style', () => {
  const source = emptyArchitectureSource();
  const gesture = beginWallDraw(source, 0, { xU: 0, zU: 0 });
  const outcome = commitWallDraw(source, gesture, { xU: 48, zU: 0 });
  assert(outcome.status === 'committed', 'draw did not commit');
  const command = wallDrawCommand('draw:1', 0, outcome.commit, measuredStyle);
  assert(command.kind === 'drawWall', 'command kind drifted');
  assert(command.kind === 'drawWall' && command.heightU === 48 && command.thicknessU === 4 && command.profile === 'full',
    'style measurements did not flow into the command');
  assert(command.kind === 'drawWall' && command.styleId === 'build:wall:style:basic', 'style id drifted');
});

test('a non-style catalog entry is refused as a draw source', () => {
  const source = emptyArchitectureSource();
  const gesture = beginWallDraw(source, 0, { xU: 0, zU: 0 });
  const outcome = commitWallDraw(source, gesture, { xU: 48, zU: 0 });
  assert(outcome.status === 'committed', 'draw did not commit');
  const notStyle = { ...measuredStyle, role: 'opening' } as ArchitectureCatalogEntry;
  let threw = false;
  try {
    wallDrawCommand('draw:2', 0, outcome.commit, notStyle);
  } catch {
    threw = true;
  }
  assert(threw, 'an opening kit was accepted as a wall style');
});

test('a jittery click anchors — the drag flag alone never eats the release (req_4474)', () => {
  const source = emptyArchitectureSource();
  // 8px of mouse jitter resolves down and up to the SAME lattice point.
  const routed = wallPointerRelease(source, 0, null, { xU: 32, zU: 0 }, { xU: 32, zU: 0 }, true);
  assert(routed.kind === 'anchor', `jittery click did not anchor: ${routed.kind}`);
  assert(routed.kind === 'anchor' && routed.gesture.start.xU === 32, 'anchor drifted off the click point');
});

test('press-drag-release draws the whole span in one gesture', () => {
  const source = emptyArchitectureSource();
  const routed = wallPointerRelease(source, 0, null, { xU: 0, zU: 0 }, { xU: 96, zU: 0 }, true);
  assert(routed.kind === 'commit', `drag did not commit: ${routed.kind}`);
  assert(routed.kind === 'commit' && routed.commit.start.xU === 0 && routed.commit.end.xU === 96, 'drag span endpoints drifted');
});

test('a stationary click waits, then the second release commits from the anchor', () => {
  const source = emptyArchitectureSource();
  const first = wallPointerRelease(source, 0, null, { xU: 0, zU: 0 }, { xU: 0, zU: 0 }, false);
  assert(first.kind === 'anchor', 'first click did not anchor');
  const anchor = first.kind === 'anchor' ? first.gesture : null;
  const second = wallPointerRelease(source, 0, anchor, { xU: 48, zU: 48 }, { xU: 48, zU: 48 }, false);
  assert(second.kind === 'commit', `second click did not commit: ${second.kind}`);
  assert(second.kind === 'commit' && second.commit.start.xU === 0 && second.commit.end.zU === 48, 'committed span drifted');
});

test('off-map releases miss without disturbing an absent anchor', () => {
  const source = emptyArchitectureSource();
  const offMapClick = wallPointerRelease(source, 0, null, null, null, false);
  assert(offMapClick.kind === 'miss', 'off-map click did not miss');
  const anchor = beginWallDraw(source, 0, { xU: 0, zU: 0 });
  const offMapCommit = wallPointerRelease(source, 0, anchor, { xU: 0, zU: 0 }, null, true);
  assert(offMapCommit.kind === 'miss', 'off-map release did not miss');
});

test('a drag that ends off the map or on its own start falls back to anchoring', () => {
  const source = emptyArchitectureSource();
  const offMapDrag = wallPointerRelease(source, 0, null, { xU: 16, zU: 16 }, null, true);
  assert(offMapDrag.kind === 'anchor', 'off-map drag did not fall back to anchoring');
  assert(offMapDrag.kind === 'anchor' && offMapDrag.gesture.start.xU === 16, 'fallback anchor drifted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
