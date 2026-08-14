// cart/editor/data/roleNamer.test.ts — the vehicle role-naming plan (req_3263).
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

test('the sole role contract is the complete vehicle formation', () => {
  const roles = roleContract('car').roles;
  expect(roles.includes('body'), 'vehicle root is present');
  expect(roles.includes('door_driver'), 'vehicle panels are present');
  expect(roles.includes('wheel_back_right'), 'all four wheels are present');
});

test('retired character naming contracts are rejected at the runtime boundary', () => {
  let error = '';
  try { (roleContract as (id: string) => unknown)('body'); }
  catch (caught) { error = (caught as Error).message; }
  expect(error.includes('unknown role-naming contract'), 'body must not enter a compatibility path');
});

test('plan recognizes vehicle role spelling and asks only for missing roles', () => {
  const plan = roleNamerPlan('car', ['Door Driver', 'Wheel Front.L', 'Cube 1']);
  expect(plan.claimed.get('door_driver') === 'Door Driver', 'spaces normalize for vehicle panels');
  expect(plan.claimed.get('wheel_front_left') === 'Wheel Front.L', 'vehicle side suffix normalizes');
  expect(!plan.open.includes('door_driver') && !plan.open.includes('wheel_front_left'), 'claimed roles are not asked');
  expect(plan.open.includes('door_passenger') && plan.open.includes('wheel_front_right'), 'missing roles are asked');
});

test('first claimant wins a role — a duplicate name never double-claims', () => {
  const plan = roleNamerPlan('car', ['hood', 'HOOD']);
  expect(plan.claimed.get('hood') === 'hood', 'first row claims');
  expect(!plan.open.includes('hood'), 'role stays satisfied');
});

log(`${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
