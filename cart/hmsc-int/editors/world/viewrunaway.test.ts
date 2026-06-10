import { CANVAS_PAN_FOCUS_LOCK_KEY, CANVAS_PAN_SPEED, canvasPanDriftForHeldKeys, canvasPanOwnsWasd, effectiveCanvasPanDrift, isCanvasPanFocusLockKey } from '../../PaintCanvas';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

test('VIEWRUNAWAY-0607: stale canvas drift cannot keep the host camera moving', () => {
  const live = canvasPanDriftForHeldKeys(['d', 'w']);
  const active = effectiveCanvasPanDrift(live, 2, true);
  const orphanedByHotReload = effectiveCanvasPanDrift(live, 0, true);
  const hiddenByRouteOverlay = effectiveCanvasPanDrift(live, 2, false);
  const graphUnitsPerSecondAtUserZoom = CANVAS_PAN_SPEED / 0.13;

  console.log(`[VIEWRUNAWAY-0607-SOURCE] buildPayload reads PaintCanvas.getView via __canvas_screen_to_graph; Canvas drift=${CANVAS_PAN_SPEED}px/s at zoom=0.13 moves ${graphUnitsPerSecondAtUserZoom.toFixed(0)} graph-units/s`);
  console.log(`[VIEWRUNAWAY-0607-DRIFT] held=2 focused=true active=${active.active} drift=${active.x},${active.y}; held=0 staleState=${orphanedByHotReload.x},${orphanedByHotReload.y} active=${orphanedByHotReload.active}; focused=false active=${hiddenByRouteOverlay.active}`);

  assertEqual(live.x, CANVAS_PAN_SPEED, 'D pans right at the engine drift speed');
  assertEqual(live.y, -CANVAS_PAN_SPEED, 'W pans up at the engine drift speed');
  assert(active.active, 'held keys in the focused pane still pan normally');
  assertEqual(orphanedByHotReload.x, 0, 'stale drift state is zeroed before reaching Canvas');
  assertEqual(orphanedByHotReload.y, 0, 'stale drift state is zeroed before reaching Canvas');
  assert(!orphanedByHotReload.active, 'hot-reload/orphaned drift does not keep moving');
  assert(!hiddenByRouteOverlay.active, 'a mounted editor hidden behind another route cannot drift');
  assertClose(graphUnitsPerSecondAtUserZoom, 5384.615, 0.01, 'the reported runaway magnitude matches engine-side drift at zoom 0.13');
});

test('F8 locks the painter as the WASD owner even when host focus is stuck on canvas chrome', () => {
  const locked = effectiveCanvasPanDrift(canvasPanDriftForHeldKeys(['a']), 1, canvasPanOwnsWasd(false, true));
  const unlocked = effectiveCanvasPanDrift(canvasPanDriftForHeldKeys(['a']), 1, canvasPanOwnsWasd(false, false));

  assert(isCanvasPanFocusLockKey('F8'), 'the global painter pan lock accepts host key names case-insensitively');
  assertEqual(CANVAS_PAN_FOCUS_LOCK_KEY, 'f8', 'the pan lock key is stable for the editor shell');
  assert(locked.active, 'a locked painter continues receiving WASD without click focus');
  assert(!unlocked.active, 'unlocked painter still obeys the normal quad focus owner');
});

finish('editors/world/viewrunaway');
