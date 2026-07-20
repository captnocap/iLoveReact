// cart/editor/data/roleNamer.test.ts — the guided role-naming plan (req_3263).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/roleNamer.test.ts --bundle \
//     --outfile=/tmp/editor-role-namer.test.js --format=iife --platform=neutral \
//     --target=es2022
//   tools/v8cli /tmp/editor-role-namer.test.js

import { roleContract, roleNamerPlan } from './roleNamer';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function expect(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

test('head contract is the head subtree, not the whole body', () => {
  const roles = roleContract('head').roles;
  expect(roles.includes('head'), 'head itself is in');
  expect(roles.includes('eye_left') && roles.includes('eye_right'), 'eye pair is in');
  expect(roles.includes('lips') && roles.includes('teeth'), 'mouth chain is in');
  expect(!roles.includes('toes_left') && !roles.includes('chest'), 'body-only bones are out');
});

test('body and car contracts carry their full formations', () => {
  expect(roleContract('body').roles.includes('toes_left'), 'body reaches the toes');
  expect(roleContract('car').roles.includes('door_driver'), 'car has its panels');
});

test('plan marks claimed roles via bone-name normalization and asks only the rest', () => {
  const plan = roleNamerPlan('head', ['Eye.L', 'nose', 'Cube 1', 'Cone 4']);
  expect(plan.claimed.get('eye_left') === 'Eye.L', 'Eye.L normalizes to eye_left');
  expect(plan.claimed.get('nose') === 'nose', 'exact name claims');
  expect(!plan.open.includes('eye_left') && !plan.open.includes('nose'), 'claimed roles are not asked');
  expect(plan.open.includes('eye_right') && plan.open.includes('mouth'), 'missing roles are asked');
});

test('first claimant wins a role — a duplicate name never double-claims', () => {
  const plan = roleNamerPlan('head', ['head', 'HEAD']);
  expect(plan.claimed.get('head') === 'head', 'first row claims');
  expect(!plan.open.includes('head'), 'role stays satisfied');
});

log(`${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
