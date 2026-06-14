// Behavior tests for the STATS_CONFIG bake (P4): assert the flat layout the
// no-V8 loader reads — fixed 43-float order, header version, factor runs in the
// documented positions. The Zig twin is framework/world/constructor.zig
// decodeStatsConfig; this test is the field-order contract both sides honor.

import { statsConfigFloats, encodeStatsConfigLump, STATS_CONFIG_FLOATS, STATS_CONFIG_LUMP_VERSION } from './playerStats';
import { STATS_TUNING } from '@game';
import { assert, assertClose, assertEqual, finish, test } from '../game/_testkit';

function decode(bytes: Uint8Array): { version: number; floats: number[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  const floats: number[] = [];
  for (let i = 0; i < (bytes.byteLength - 4) / 4; i += 1) floats.push(view.getFloat32(4 + i * 4, true));
  return { version, floats };
}

test('the lump is a fixed 43-float payload with a version header', () => {
  const bytes = encodeStatsConfigLump();
  assertEqual(STATS_CONFIG_FLOATS, 43, '43 floats');
  assertEqual(bytes.byteLength, 4 + 43 * 4, 'header + 43 floats');
  const { version, floats } = decode(bytes);
  assertEqual(version, STATS_CONFIG_LUMP_VERSION, 'version header');
  assertEqual(floats.length, 43, 'decoded 43 floats');
  assert(floats.every((n) => Number.isFinite(n)), 'no non-finite floats');
});

test('field order matches the documented positions the loader reads', () => {
  const f = statsConfigFloats();
  assertClose(f[0], STATS_TUNING.health.max, 1e-4, 'health.max at 0');
  assertClose(f[2], STATS_TUNING.armor.start, 1e-4, 'armor.start at 2');
  assertClose(f[4], STATS_TUNING.energy.start, 1e-4, 'energy.start at 4');
  assertClose(f[10], STATS_TUNING.wanted.decayPerSecond, 1e-4, 'wanted decay at 10');
  // star thresholds occupy 11..16
  assertClose(f[11], STATS_TUNING.wanted.starThresholds[0], 1e-4, 'first threshold at 11');
  assertClose(f[16], STATS_TUNING.wanted.starThresholds[5], 1e-4, 'sixth threshold at 16');
  assertClose(f[17], STATS_TUNING.inventory.handsSlots, 1e-4, 'hands slots at 17');
  // pants[7] at 18..24 — index 3 is 'jeans'
  assertClose(f[18 + 3], STATS_TUNING.inventory.pocketByPants.jeans, 1e-4, 'jeans pocket factor');
  // packs[4] at 25..28 — index 3 is 'suitcase'
  assertClose(f[25 + 3], STATS_TUNING.inventory.packByBackpack.suitcase, 1e-4, 'suitcase pack factor');
  assertClose(f[29], STATS_TUNING.skills.xpBase, 1e-4, 'xp base at 29');
  assertClose(f[42], STATS_TUNING.skills.xpRates.stealthPerSecondUnseen, 1e-4, 'last float at 42');
});

finish('playerStats');
