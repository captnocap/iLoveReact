// Focused transaction tests for the Color Studio command domain.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/material/colorStudioCommand.test.ts --bundle \
//     --outfile=/tmp/color-studio-command.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/color-studio-command.test.js
import {
  ColorStudioRejected,
  planCurrentColorChoice,
  planPaletteAdd,
  planPaletteLoad,
  planSlotFill,
  planSlotsReset,
  planVariantChoice,
  type ColorStudioPolicy,
  type ColorStudioSnapshot,
} from './colorStudioCommand';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const policy: ColorStudioPolicy = {
  qualityCount: 5,
  seedMax: 999,
  spec: (id) => id === 'brick' ? {
    id: 'brick', label: 'Brick', variants: [{ label: 'Clean' }, { label: 'Dirty' }],
    slots: [
      { name: 'Mortar', baked: [0.6, 0.6, 0.6] },
      { name: 'Face', baked: [0.7, 0.1, 0.05] },
    ],
  } : null,
};

function snapshot(overrides: ColorStudioSnapshot['overrides'] = {}): ColorStudioSnapshot {
  return {
    materialId: 'brick', variant: 1, seed: 4, quality: 3, activeSlot: 1,
    view: 'materialPalette', currentColor: { l: 0.6, c: 0.1, h: 20 }, scenePick: null,
    overrides,
    palette: [{ l: 0.5, c: 0.1, h: 10 }],
  };
}

test('slot fill carries an exact inverse and does not mutate its input snapshot', () => {
  const start = snapshot({ 'brick:1:1': [0.2, 0.3, 0.4] });
  const plan = planSlotFill(start, {
    specId: 'brick', variant: 1, slot: 1, rgb: [0.8, 0.7, 0.6], source: 'hex #ccb399',
  }, policy);
  assert(plan.transaction.action === 'slot.fill', 'wrong transaction kind');
  assert(plan.transaction.action === 'slot.fill' && plan.transaction.before?.[0] === 0.2, 'previous override disappeared');
  assert(plan.after.overrides['brick:1:1']?.[0] === 0.8, 'forward color disappeared');
  assert(start.overrides['brick:1:1']?.[0] === 0.2, 'planner mutated source state');
});

test('reset removes only the active material variant and preserves every other override', () => {
  const plan = planSlotsReset(snapshot({
    'brick:1:0': [0.1, 0.2, 0.3],
    'brick:1:1': [0.4, 0.5, 0.6],
    'brick:0:1': [0.7, 0.8, 0.9],
  }), { specId: 'brick', variant: 1 }, policy);
  assert(plan.transaction.action === 'slots.reset' && plan.transaction.changes.length === 2, 'reset inverse is incomplete');
  assert(plan.after.overrides['brick:1:0'] === undefined && plan.after.overrides['brick:1:1'] === undefined, 'active variant survived reset');
  assert(plan.after.overrides['brick:0:1']?.[0] === 0.7, 'another variant was erased');
  assert(plan.before.overrides['brick:1:0']?.[0] === 0.1, 'undo snapshot lost a slot');
});

test('tray add and library load are reversible workspace actions', () => {
  const added = planPaletteAdd(snapshot(), { color: { l: 0.8, c: 0.2, h: 90 }, source: 'current color' });
  assert(added.transaction.action === 'palette.add' && added.after.palette.length === 2, 'tray add did not append once');
  assert(added.before.palette.length === 1, 'tray inverse was not retained');

  const loaded = planPaletteLoad(snapshot(), {
    setName: 'Dune Dusk', colors: [{ l: 0.2, c: 0.05, h: 30 }, { l: 0.9, c: 0.02, h: 80 }],
  });
  assert(loaded.transaction.action === 'palette.load' && loaded.after.palette.length === 2, 'library set did not replace the tray');
  assert(loaded.after.currentColor.l === 0.2 && loaded.before.currentColor.l === 0.6, 'current-color inverse drifted');
});

test('report-only color selection is idempotent and never produces an action plan', () => {
  const same = planCurrentColorChoice(snapshot(), { l: 0.6, c: 0.1, h: 20 }, 'color map');
  assert(!same.changed && same.kind === 'color', 'same settled color claimed a transition');
  const changed = planCurrentColorChoice(snapshot(), { l: 0.7, c: 0.1, h: 20 }, 'color map');
  assert(changed.changed && changed.patch.currentColor?.l === 0.7, 'settled color choice disappeared');
});

test('invalid, stale, and no-op requests reject before an action can commit', () => {
  const calls = [
    () => planSlotFill(snapshot(), { specId: 'gone', variant: 0, slot: 0, rgb: [1, 0, 0], source: 'test' }, policy),
    () => planSlotFill(snapshot({ 'brick:1:1': [1, 0, 0] }), { specId: 'brick', variant: 1, slot: 1, rgb: [1, 0, 0], source: 'test' }, policy),
    () => planSlotsReset(snapshot(), { specId: 'brick', variant: 1 }, policy),
    () => planVariantChoice(snapshot(), 99, policy),
  ];
  for (const call of calls) {
    let rejected = false;
    try { call(); } catch (error) { rejected = error instanceof ColorStudioRejected; }
    assert(rejected, 'invalid request did not reject');
  }
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
