import { CANVAS_PAN_SPEED, canvasPanDriftForHeldKeys, effectiveCanvasPanDrift } from '../../PaintCanvas';
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

finish('editors/world/viewrunaway');
