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

test('model browse context exposes Asset Explorer, global Queue, and focus tools', () => {
  assert(leftPanelsFor('model').map((button) => button.id).join(',') === 'assets,animation-queue', 'model left rail lost its global queue peer');
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

test('animation owns Sources/Queue/Assets and Generate/Scene Context/Review gutters', () => {
  const left = leftPanelsFor('animation');
  const right = rightPanelsFor('animation');
  assert(left.map((button) => button.id).join(',') === 'animation-sources,animation-queue,assets', 'animation left gutter drifted');
  assert(left.map((button) => button.label).join(',') === 'Sources,Queue,Assets', 'animation left labels drifted');
  assert(left.map((button) => button.renderer).join(',') === 'animation-sources,animation-queue-manager,library', 'animation left panes lack explicit renderers');
  assert(right.map((button) => button.id).join(',') === 'animation-generate,animation-scene-context,animation-review', 'animation right gutter drifted');
  assert(right.map((button) => button.label).join(',') === 'Generate,Scene Context,Review', 'animation right labels drifted');
  assert(right.map((button) => button.renderer).join(',') === 'animation-generate,animation-scene-context,animation-review', 'animation right panes lack explicit renderers');
  assert(normalizeLeftPanelId('animation-capture') === 'animation-sources', 'retired Capture pane did not migrate to Sources');
  assert(normalizeLeftPanelId('animation-queue') === 'animation-queue', 'Queue pane did not survive hot reload');
  assert(normalizeRightPanelId('animation-generate') === 'animation-generate', 'Generate pane did not survive hot reload');
  assert(normalizeRightPanelId('animation-scene-context') === 'animation-scene-context', 'Scene Context pane did not survive hot reload');
  assert(normalizeRightPanelId('animation-review') === 'animation-review', 'Review pane did not survive hot reload');
});

test('paint is one peer pane and the Asset Explorer remains reachable', () => {
  const modelPaint = leftPanelsFor('model', true);
  const facadePaint = leftPanelsFor('facade', true);
  assert(modelPaint.map((button) => button.id).join(',') === 'paint,assets,animation-queue', 'model paint panes drifted');
  assert(facadePaint.map((button) => button.id).join(',') === 'paint,assets,animation-queue', 'facade paint panes drifted');
  assert(modelPaint.map((button) => button.renderer).join(',') === 'paint,library,animation-queue', 'paint pane renderers are not explicit');
  assert(leftPanelsFor('world', true)[0]!.id === 'assets', 'unsupported world paint context replaced its library');
});

test('non-model documents never advertise unimplemented right panes', () => {
  for (const kind of ['material', 'playtest', 'facade'] as const) {
    assert(rightPanelsFor(kind).map((button) => button.id).join(',') === 'inspector', `${kind} advertised a dead focus pane`);
  }
  // The world document's rail is Focus + the global outliner (req_4737).
  assert(rightPanelsFor('world').map((button) => button.id).join(',') === 'inspector,outliner', 'world right rail drifted');
  const outliner = rightPanelsFor('world').find((button) => button.id === 'outliner');
  assert(outliner?.renderer === 'world-outliner', 'the world outliner pane renderer is not explicit');
  assert(normalizeRightPanelId('outliner') === 'outliner', 'Outliner pane did not survive hot reload');
  assert(resolvedPanelId(rightPanelsFor('model'), 'outliner') === 'inspector', 'world outliner pane escaped the world-only renderer');
});

test('a Lab document mounts Layers and the Lab inspector on the rails', () => {
  const left = leftPanelsFor('material', false, true);
  assert(left.map((button) => button.id).join(',') === 'lab-stack,assets,animation-queue', 'lab left rail drifted');
  assert(left[0]!.renderer === 'lab-stack', 'the Layers pane renderer is not explicit');
  assert(left[0]!.label === 'Layers', 'the Lab rail still exposes its internal Stack name');
  assert(rightPanelsFor('material', true).map((button) => button.id).join(',') === 'lab', 'lab right rail drifted — the world-tile Focus panel must NOT be in the Lab set');
  assert(rightPanelsFor('material').map((button) => button.id).join(',') === 'inspector', 'non-recipe material document lost its Focus panel');
  assert(resolvedPanelId(rightPanelsFor('material', true), 'inspector') === 'lab', 'lab right rail did not auto-select from a world pane id');
  assert(resolvedPanelId(rightPanelsFor('world'), 'lab') === 'inspector', 'lab pane escaped the material-only renderer');
  assert(normalizeLeftPanelId('lab-stack') === 'lab-stack', 'Layers pane did not survive hot reload');
  assert(normalizeRightPanelId('lab') === 'lab', 'Lab pane did not survive hot reload');
});

test('World Bible retains its index plus the global Queue and no generic inspector', () => {
  const left = leftPanelsFor('knowledge');
  assert(left.map((button) => button.id).join(',') === 'world-bible,animation-queue', 'knowledge lost its index or global queue');
  assert(left[0]!.renderer === 'world-bible' && left[1]!.renderer === 'animation-queue', 'knowledge advertised an unrendered pane');
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
