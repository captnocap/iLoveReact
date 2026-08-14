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
  normalizeContentFolderId,
  normalizeLeftPanelId,
  normalizeRightPanelId,
  pressPanelButton,
  resolvedPanelId,
  resolvedPanelIdOrNull,
  rightPanelsFor,
} from './panelSystem';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('model browse context exposes one Asset Explorer and focus tools', () => {
  assert(leftPanelsFor('model').map((button) => button.id).join(',') === 'assets', 'model left rail duplicated the Asset Explorer');
  assert(rightPanelsFor('model').map((button) => button.id).join(',') === 'inspector,paint,names,rig,recovery', 'model right rail drifted');
  const recovery = rightPanelsFor('model').find((button) => button.id === 'recovery');
  assert(recovery?.label === 'Recovery' && recovery.icon === 'DatabaseBackup', 'Recovery pane has no rail presentation');
});

test('category shortcuts never reappear as duplicate library rail panes', () => {
  for (const kind of ['world', 'model', 'material', 'playtest', 'animation', 'facade'] as const) {
    const libraries = leftPanelsFor(kind).filter((button) => button.renderer === 'library');
    assert(libraries.length === 1 && libraries[0]!.id === 'assets', `${kind} exposes more than the one Asset Explorer`);
  }
});

test('paint is one peer pane and the Asset Explorer remains reachable', () => {
  const modelPaint = leftPanelsFor('model', true);
  const facadePaint = leftPanelsFor('facade', true);
  assert(modelPaint.map((button) => button.id).join(',') === 'paint,assets', 'model paint panes drifted');
  assert(facadePaint.map((button) => button.id).join(',') === 'paint,assets', 'facade paint panes drifted');
  assert(modelPaint.map((button) => button.renderer).join(',') === 'paint,library', 'paint pane renderers are not explicit');
  assert(leftPanelsFor('world', true)[0]!.id === 'assets', 'unsupported world paint context replaced its library');
});

test('non-model documents never advertise unimplemented right panes', () => {
  for (const kind of ['world', 'material', 'playtest', 'animation', 'facade'] as const) {
    assert(rightPanelsFor(kind).map((button) => button.id).join(',') === 'inspector', `${kind} advertised a dead focus pane`);
  }
});

test('World Bible owns one explicit index pane and no generic world inspector', () => {
  const left = leftPanelsFor('knowledge');
  assert(left.length === 1 && left[0]!.id === 'world-bible' && left[0]!.renderer === 'world-bible', 'knowledge fell into the world asset browser');
  assert(rightPanelsFor('knowledge').length === 0, 'knowledge advertised the world-object inspector');
});

test('pressing the active rail button toggles collapse', () => {
  const closed = pressPanelButton('assets', 'assets', false);
  assert(closed.active === 'assets' && closed.collapsed, 'active press did not collapse');
  const opened = pressPanelButton(closed.active, 'assets', closed.collapsed);
  assert(opened.active === 'assets' && !opened.collapsed, 'second active press did not reopen');
});

test('pressing a different button selects it and opens its panel', () => {
  const result = pressPanelButton('paint', 'assets', true);
  assert(result.active === 'assets' && !result.collapsed, 'different pane stayed collapsed or unselected');
});

test('invalid pane state resolves to the context default without inventing a renderer', () => {
  assert(resolvedPanelId(leftPanelsFor('model'), 'missions') === 'assets', 'model left default was not the Asset Explorer');
  assert(resolvedPanelId(rightPanelsFor('world'), 'rig') === 'inspector', 'world right default was not contextual');
  assert(resolvedPanelId(rightPanelsFor('world'), 'recovery') === 'inspector', 'Recovery escaped the model-only renderer');
  assert(resolvedPanelIdOrNull(rightPanelsFor('knowledge'), 'inspector') === null, 'empty World Bible focus rail did not resolve safely');
});

test('tree navigation never changes rail icon inside the Asset Explorer', () => {
  assert(leftPanelForFolder('world', 'model-prop-chair', 'assets') === 'assets', 'model folder changed the rail destination');
  assert(leftPanelForFolder('world', 'materials-generated', 'assets') === 'assets', 'material folder changed the rail destination');
  assert(leftPanelForFolder('world', 'build-pieces', 'assets') === 'assets', 'build folder changed the rail destination');
  assert(leftPanelForFolder('model', 'missions', 'assets') === 'assets', 'model context invented a category rail destination');
});

test('retired model storage folders migrate back to the model asset', () => {
  assert(normalizeContentFolderId('model-prop-chair/paints') === 'model-prop-chair', 'retired child folder survived');
  assert(normalizeContentFolderId('models-props') === 'models-props', 'live category was rewritten');
  assert(normalizeContentFolderId('materials-core') === 'materials-core', 'non-model folder was rewritten');
});

test('mock-era hot state migrates into the live pane vocabulary', () => {
  assert(normalizeLeftPanelId('grid') === 'assets', 'legacy grid did not migrate into Assets');
  assert(normalizeLeftPanelId('actors') === 'assets', 'legacy actors did not migrate into Assets');
  assert(normalizeLeftPanelId('materials') === 'assets', 'retired Materials alias survived hot reload');
  assert(normalizeLeftPanelId('tool-options') === 'paint', 'split tool-options state did not migrate to Paint');
  assert(normalizeLeftPanelId('ink') === 'paint', 'split Ink state did not migrate to Paint');
  assert(normalizeLeftPanelId('paint') === 'paint', 'live Paint pane did not survive hot reload');
  assert(normalizeRightPanelId('layers') === 'inspector', 'inert legacy right pane became live content unexpectedly');
  assert(normalizeRightPanelId('rig') === 'rig', 'live rig pane did not survive hot reload');
  assert(normalizeRightPanelId('recovery') === 'recovery', 'persisted Recovery pane did not survive reload');
});

log(`\npanel system: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} panel-system test(s) failed`);
