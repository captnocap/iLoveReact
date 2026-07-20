// cart/editor/data/panelSystem.test.ts — contextual rail behavior (req_3266).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/panelSystem.test.ts --bundle \
//     --outfile=/tmp/editor-panel-system.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-panel-system.test.js
import {
  leftPanelForFolder,
  leftPanelsFor,
  normalizeLeftPanelId,
  normalizeRightPanelId,
  pressPanelButton,
  resolvedPanelId,
  rightPanelsFor,
} from './panelSystem';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('model browse context exposes source libraries and focus tools', () => {
  assert(leftPanelsFor('model').map((button) => button.id).join(',') === 'models,materials', 'model left rail drifted');
  assert(rightPanelsFor('model').map((button) => button.id).join(',') === 'inspector,paint,rig', 'model right rail drifted');
});

test('paint is one peer pane and source libraries remain reachable', () => {
  const modelPaint = leftPanelsFor('model', true);
  const facadePaint = leftPanelsFor('facade', true);
  assert(modelPaint.map((button) => button.id).join(',') === 'paint,models,materials', 'model paint panes drifted');
  assert(facadePaint.map((button) => button.id).join(',') === 'paint,materials,models', 'facade paint panes drifted');
  assert(modelPaint.map((button) => button.renderer).join(',') === 'paint,library,library', 'paint pane renderers are not explicit');
  assert(leftPanelsFor('world', true)[0]!.id === 'assets', 'unsupported world paint context replaced its library');
});

test('non-model documents never advertise unimplemented right panes', () => {
  for (const kind of ['world', 'material', 'playtest', 'animation', 'facade'] as const) {
    assert(rightPanelsFor(kind).map((button) => button.id).join(',') === 'inspector', `${kind} advertised a dead focus pane`);
  }
});

test('pressing the active rail button toggles collapse', () => {
  const closed = pressPanelButton('models', 'models', false);
  assert(closed.active === 'models' && closed.collapsed, 'active press did not collapse');
  const opened = pressPanelButton(closed.active, 'models', closed.collapsed);
  assert(opened.active === 'models' && !opened.collapsed, 'second active press did not reopen');
});

test('pressing a different button selects it and opens its panel', () => {
  const result = pressPanelButton('models', 'materials', true);
  assert(result.active === 'materials' && !result.collapsed, 'different pane stayed collapsed or unselected');
});

test('invalid pane state resolves to the context default without inventing a renderer', () => {
  assert(resolvedPanelId(leftPanelsFor('model'), 'missions') === 'models', 'model left default was not contextual');
  assert(resolvedPanelId(rightPanelsFor('world'), 'rig') === 'inspector', 'world right default was not contextual');
});

test('tree navigation updates the matching contextual rail family', () => {
  assert(leftPanelForFolder('world', 'model-prop-chair/paints', 'assets') === 'models', 'model subfolder did not select Models');
  assert(leftPanelForFolder('world', 'materials-generated', 'assets') === 'materials', 'material subfolder did not select Materials');
  assert(leftPanelForFolder('world', 'build-pieces', 'assets') === 'build', 'build folder did not select Build');
  assert(leftPanelForFolder('model', 'missions', 'materials') === 'materials', 'unavailable model pane discarded the valid fallback');
});

test('mock-era hot state migrates into the live pane vocabulary', () => {
  assert(normalizeLeftPanelId('grid') === 'materials', 'legacy grid did not migrate');
  assert(normalizeLeftPanelId('actors') === 'characters', 'legacy actors did not migrate');
  assert(normalizeLeftPanelId('tool-options') === 'paint', 'split tool-options state did not migrate to Paint');
  assert(normalizeLeftPanelId('ink') === 'paint', 'split Ink state did not migrate to Paint');
  assert(normalizeLeftPanelId('paint') === 'paint', 'live Paint pane did not survive hot reload');
  assert(normalizeRightPanelId('layers') === 'inspector', 'inert legacy right pane became live content unexpectedly');
  assert(normalizeRightPanelId('rig') === 'rig', 'live rig pane did not survive hot reload');
});

log(`\npanel system: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} panel-system test(s) failed`);
