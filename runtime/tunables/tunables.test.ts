// runtime/tunables/tunables.test.ts — locks the defaults/tunables contract:
// preset→value resolution (factor × base), custom-override resolution, the
// (material, variant, slot) override key, ranked palette search (global/exact
// first, then related), and that an override edit dispatches the expected
// editorbus event. Self-contained micro-harness — the repo has no test framework.
//
//   tools/esbuild runtime/tunables/tunables.test.ts --bundle \
//     --outfile=/tmp/tun.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/tun.test.js

import {
  defineTunable, resolve, resolveCurrent, overrideKey, parseOverrideKey,
  searchTunables, registeredTunables, isOverride, getSelection,
} from './tunable';
import {
  setTunableOverride, clearTunableOverride, fillMaterialSlot,
} from './events';
import { tunableGet } from './host';
import { onEvent } from '../editorbus/bus';
import { type EditorEvent } from '../editorbus/event';

// ── micro harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ── sample tunables (the registry ships no catalog; systems register their own) ─
defineTunable({
  id: 'gravity', label: 'Gravity', base: 9.81, group: 'physics', global: true,
  presets: { default: 1, moon: 0.16, heavy: 2 },
  keywords: ['fall', 'acceleration'],
});
defineTunable({
  id: 'walkSpeed', label: 'Walk Speed', base: 3.0, group: 'movement',
  presets: { default: 1, fast: 1.5, slow: 0.6 },
  related: ['gravity'],
});
defineTunable({
  id: 'npcReaction', label: 'NPC Reaction', base: 0.4, group: 'pathing',
  presets: { default: 1, sharp: 0.5, dull: 2 },
});

// ── definition + registry ────────────────────────────────────────────────────
test('a tunable without a default preset is rejected', () => {
  let threw = false;
  try { defineTunable({ id: 'noDefault', label: 'x', base: 1, group: 'g', presets: { fast: 2 } }); }
  catch { threw = true; }
  assert(threw, 'missing default preset must throw');
});

test('re-registering an id is rejected (the anti-collision seam)', () => {
  let threw = false;
  try { defineTunable({ id: 'gravity', label: 'dup', base: 1, group: 'g', presets: { default: 1 } }); }
  catch { threw = true; }
  assert(threw, 'duplicate id registration must throw');
  assert(registeredTunables().some((d) => d.id === 'gravity'), 'gravity listed for the overlay');
});

// ── preset → value resolution (factor × base) ────────────────────────────────
test('a named preset resolves to factor × base', () => {
  assert(near(resolve('walkSpeed', 'default'), 3.0), 'default = base');
  assert(near(resolve('walkSpeed', 'fast'), 4.5), 'fast = 1.5 × 3.0');
  assert(near(resolve('walkSpeed', 'slow'), 1.8), 'slow = 0.6 × 3.0');
  assert(near(resolve('gravity', 'moon'), 9.81 * 0.16), 'moon gravity factor');
});

test('an omitted selection falls back to the default preset', () => {
  assert(near(resolve('gravity'), 9.81), 'omitted → default preset');
});

test('a custom override resolves to the raw number, bypassing factors', () => {
  const ov = { custom: 7.25 };
  assert(isOverride(ov), 'override guard narrows the object form');
  assert(!isOverride('fast'), 'a preset name is not an override');
  assert(near(resolve('walkSpeed', ov), 7.25), 'custom override is raw, not × base');
});

test('an unknown id or preset throws (authoring-bug guard)', () => {
  let a = false, b = false;
  try { resolve('nope'); } catch { a = true; }
  try { resolve('walkSpeed', 'turbo'); } catch { b = true; }
  assert(a, 'unknown id throws');
  assert(b, 'unknown preset throws');
});

// ── override keying (material, variant, slot) ────────────────────────────────
test('overrideKey is stable and reversible per (material, variant, slot)', () => {
  const k = overrideKey('RotSiding', 'weathered', 'plank');
  assert(k === 'RotSiding::weathered::plank', `key shape, got "${k}"`);
  assert(overrideKey('m', 'a', 0) !== overrideKey('m', 'b', 0), 'variant disambiguates');
  const p = parseOverrideKey(k);
  assert(p.material === 'RotSiding' && p.variant === 'weathered' && p.slot === 'plank', 'round-trips');
});

// ── ranked palette search ────────────────────────────────────────────────────
test('search ranks the global exact match first, then related values', () => {
  const ids = searchTunables('gravity').map((d) => d.id);
  assert(ids[0] === 'gravity', `global exact id first, got ${JSON.stringify(ids)}`);
  assert(ids.includes('walkSpeed'), 'related value (walkSpeed depends on gravity) surfaces');
  assert(ids.indexOf('gravity') < ids.indexOf('walkSpeed'), 'exact outranks related');
});

test('search matches group and keywords', () => {
  assert(searchTunables('movement').some((d) => d.id === 'walkSpeed'), 'group match');
  assert(searchTunables('fall').some((d) => d.id === 'gravity'), 'keyword match');
  assert(searchTunables('').length === 0, 'empty query returns nothing');
});

// ── override edit dispatches the expected editorbus event ─────────────────────
test('setTunableOverride dispatches tunable.override.set and updates state', () => {
  const seen: EditorEvent[] = [];
  const off = onEvent((e) => seen.push(e));
  const seq = setTunableOverride('walkSpeed', { custom: 9 });
  off();
  assert(seq > 0, 'dispatch returned an authoritative seq (local fallback)');
  const ev = seen.find((e) => e.type === 'tunable.override.set');
  assert(!!ev, 'a tunable.override.set event was broadcast');
  assert((ev!.payload as any).id === 'walkSpeed', 'payload carries the tunable id');
  assert(ev!.targets.some((t) => t.kind === 'tunable' && t.id === 'walkSpeed'), 'targets carry the tunable ref');
  assert(isOverride(getSelection('walkSpeed')), 'active selection became the override');
  assert(near(resolveCurrent('walkSpeed'), 9), 'resolveCurrent reflects the override');
  assert(near(tunableGet('walkSpeed'), 9), 'host door falls back to the resolved value (no Zig door)');
});

test('clearTunableOverride reverts to default and logs the edit', () => {
  const seen: EditorEvent[] = [];
  const off = onEvent((e) => seen.push(e));
  clearTunableOverride('walkSpeed');
  off();
  assert(seen.some((e) => e.type === 'tunable.override.clear'), 'clear event broadcast');
  assert(near(resolveCurrent('walkSpeed'), 3.0), 'reverted to default preset');
});

test('fillMaterialSlot dispatches material.slot.fill keyed by override key', () => {
  const seen: EditorEvent[] = [];
  const off = onEvent((e) => seen.push(e));
  fillMaterialSlot('PoolTile', 'cracked', 'grout', '#3344aa');
  off();
  const ev = seen.find((e) => e.type === 'material.slot.fill');
  assert(!!ev, 'a material.slot.fill event was broadcast');
  const key = overrideKey('PoolTile', 'cracked', 'grout');
  assert(ev!.targets.some((t) => t.kind === 'material' && t.id === key), 'targets carry the (material,variant,slot) key');
  assert((ev!.payload as any).value === '#3344aa', 'payload carries the fill value');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
