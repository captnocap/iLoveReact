// cart/editor/shell/destinations.test.ts — the navigation model (req_4464).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/shell/destinations.test.ts --bundle \
//     --outfile=/tmp/editor-destinations.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-destinations.test.js
//
// The invariant: EVERY DESTINATION IS REACHABLE AND EVERY DESTINATION GOES
// SOMEWHERE. Before this the model studio, the animation foundry and the
// material lab had no front door at all — you arrived at them sideways or not
// at all — so a regression here is a studio becoming unreachable again.
import {
  DESTINATIONS,
  activeDestination,
  destinationById,
  destinationForKey,
  newestRecentFor,
  openDocumentForDestination,
  recentKeyPrefixFor,
} from './destinations';
import {
  ANIMATION_DOCUMENT,
  HOME_DOCUMENT,
  PLAYTEST_DOCUMENT,
  WORLD_BIBLE_DOCUMENT,
  WORLD_DOCUMENT,
} from '../data/documents';
import type { WorkspaceDocument } from '../data/types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const modelDoc: WorkspaceDocument = { id: 'model:car', kind: 'model', title: 'Car', sourceId: 'car' };
const otherModelDoc: WorkspaceDocument = { id: 'model:tree', kind: 'model', title: 'Tree', sourceId: 'tree' };
const materialDoc: WorkspaceDocument = { id: 'material:brick', kind: 'material', title: 'Brick', sourceId: 'brick' };

test('every studio the editor has is on the strip', () => {
  const ids = DESTINATIONS.map((destination) => destination.id).join(',');
  assert(ids === 'home,world,model,motion,material,playtest,bible', `the destination strip drifted: ${ids}`);
});

test('every destination carries a label, an icon, a key and a reason to exist', () => {
  for (const destination of DESTINATIONS) {
    assert(destination.label.length > 0, `${destination.id} has no label`);
    assert(destination.icon.length > 0, `${destination.id} has no icon`);
    assert(/^F[1-9]$/.test(destination.key), `${destination.id} has no function key`);
    assert(destination.does.length > 10, `${destination.id} does not say what you do there`);
  }
});

test('function keys are unique and map back to their destination', () => {
  const keys = new Set(DESTINATIONS.map((destination) => destination.key));
  assert(keys.size === DESTINATIONS.length, 'two destinations claim the same key');
  for (const destination of DESTINATIONS) {
    assert(destinationForKey(destination.key)?.id === destination.id, `${destination.key} did not resolve`);
    assert(destinationForKey(destination.key.toLowerCase())?.id === destination.id, `${destination.key} is case-sensitive`);
  }
  assert(destinationForKey('F9') === null, 'an unbound function key resolved to a destination');
  assert(destinationForKey('a') === null, 'a letter key resolved to a destination');
});

test('destinationById refuses an unknown id', () => {
  assert(destinationById('model')?.label === 'Model', 'a known id did not resolve');
  assert(destinationById('nowhere') === null, 'an unknown id resolved');
});

test('the open document decides which destination is lit', () => {
  assert(activeDestination(HOME_DOCUMENT) === 'home', 'home did not light');
  assert(activeDestination(WORLD_DOCUMENT) === 'world', 'world did not light');
  assert(activeDestination(ANIMATION_DOCUMENT) === 'motion', 'motion did not light');
  assert(activeDestination(PLAYTEST_DOCUMENT) === 'playtest', 'playtest did not light');
  assert(activeDestination(WORLD_BIBLE_DOCUMENT) === 'bible', 'bible did not light');
  assert(activeDestination(modelDoc) === 'model', 'a model document did not light Model');
  assert(activeDestination(materialDoc) === 'material', 'a material document did not light Material');
  assert(activeDestination(null) === null, 'nothing open lit a destination');
});

test('a facade document belongs to Material — it is a painted surface, not its own place', () => {
  const facade: WorkspaceDocument = { id: 'facade:1', kind: 'facade', title: 'Facade', sourceId: '1' };
  assert(activeDestination(facade) === 'material', 'the facade painter lit no destination');
});

test('a destination you already used returns you to it, preferring the focused one', () => {
  const docs = [WORLD_DOCUMENT, modelDoc, otherModelDoc];
  assert(openDocumentForDestination('model', docs, 'model:car')?.id === 'model:car', 'the focused model was not preferred');
  // With nothing of that kind focused, the most recently opened tab wins.
  assert(openDocumentForDestination('model', docs, 'world:main')?.id === 'model:tree', 'the newest model tab did not win');
  assert(openDocumentForDestination('material', docs, null) === null, 'a destination with no open document claimed one');
});

test('a destination that needs a subject knows which history to read', () => {
  assert(recentKeyPrefixFor('model') === 'model:', 'the model history prefix drifted');
  assert(recentKeyPrefixFor('material') === 'asset:', 'the material history prefix drifted');
  assert(recentKeyPrefixFor(null) === null, 'a subjectless destination claimed a history');
  assert(recentKeyPrefixFor('map') === null, 'maps are documents, not library history');
});

test('the newest matching recent is what a subjectless destination opens', () => {
  const keys = ['asset:brick', 'model:car', 'model:tree'];
  assert(newestRecentFor('model', keys) === 'car', 'the newest model was not chosen');
  assert(newestRecentFor('material', keys) === 'brick', 'the newest material was not chosen');
  assert(newestRecentFor('model', ['asset:brick']) === null, 'an empty model history invented one');
  assert(newestRecentFor(null, keys) === null, 'a subjectless destination read a history');
});

test('only Model and Material can ever need a subject — the rest always open', () => {
  const needy = DESTINATIONS.filter((destination) => destination.needs !== null).map((destination) => destination.id);
  assert(needy.join(',') === 'model,material', `an unexpected destination can stall: ${needy.join(',')}`);
});

log(`\ndestinations: ${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
