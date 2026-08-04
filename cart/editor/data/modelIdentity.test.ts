// cart/editor/data/modelIdentity.test.ts — disk identities are never reused.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/modelIdentity.test.ts --bundle \
//     --outfile=/tmp/editor-model-identity.test.js --format=iife --platform=neutral \
//     --target=es2022
//   tools/v8cli /tmp/editor-model-identity.test.js

import {
  allocateBuildStarterModelId,
  allocatePlayerModelId,
  allocatePrimitiveModelId,
} from './modelIdentity';
import type { WorkspaceDocument } from './types';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

test('disk truth reserves a primitive id even when the browser catalog omitted it', () => {
  const next = allocatePrimitiveModelId('cylinder', [], [], (id) => id === 'primitive:cylinder:1');
  assert(next === 'primitive:cylinder:2', `reused stored cylinder id: ${next}`);
});

test('disk truth also reserves player starter identities', () => {
  const docs: WorkspaceDocument[] = [];
  const next = allocatePlayerModelId(docs, [], (id) => id === 'character:player:1');
  assert(next === 'character:player:2', `reused stored player id: ${next}`);
});

// req_3773/req_3774: a document closed before its first save leaves no tab, no
// package, and no file. Re-minting its id handed the next New Mesh the dead
// document's live-mesh lease — it opened the model the user had just closed —
// and later put two documents on one identity (duplicate outliner, no visible
// parts). The session ledger is the only witness that id was ever used.
test('an identity minted this session is never re-minted after its document closes', () => {
  const minted = ['primitive:cube:1'];
  const next = allocatePrimitiveModelId('cube', [], [], () => false, minted);
  assert(next === 'primitive:cube:2', `re-minted a closed document's id: ${next}`);
});

test('the session ledger reserves starter and player identities too', () => {
  const player = allocatePlayerModelId([], [], () => false, ['character:player:1']);
  assert(player === 'character:player:2', `re-minted a closed player id: ${player}`);
  const wall = allocateBuildStarterModelId('wall', [], [], () => false, ['starter:build:wall:1']);
  assert(wall === 'starter:build:wall:2', `re-minted a closed starter id: ${wall}`);
});

test('the ledger is per-identity, not a blanket counter bump', () => {
  // A retired cube must not push an untouched cone off its first identity.
  const cone = allocatePrimitiveModelId('cone', [], [], () => false, ['primitive:cube:1']);
  assert(cone === 'primitive:cone:2', `expected the shared Model N numbering to skip 1: ${cone}`);
  const player = allocatePlayerModelId([], [], () => false, ['primitive:cube:1']);
  assert(player === 'character:player:1', `a primitive id leaked into player numbering: ${player}`);
});

test('build starters reserve identities per semantic kind', () => {
  const docs: WorkspaceDocument[] = [{ id: 'model:starter:build:wall:1', kind: 'model', title: 'Wall Piece 1', sourceId: 'starter:build:wall:1' }];
  const wall = allocateBuildStarterModelId('wall', docs, [], () => false);
  const floor = allocateBuildStarterModelId('floor', docs, [], (id) => id === 'starter:build:floor:1');
  assert(wall === 'starter:build:wall:2', `reused open wall starter id: ${wall}`);
  assert(floor === 'starter:build:floor:2', `reused stored floor starter id: ${floor}`);
  const door = allocateBuildStarterModelId('door-wall', docs, [], (id) => id === 'starter:build:door-wall:1');
  assert(door === 'starter:build:door-wall:2', `door variant collided with the base wall identity: ${door}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
