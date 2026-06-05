// vehicles.test.ts — P4 behavior tests for the vehicle editor's pure edit
// steps (the headless half of every control in editors/vehicles/). The
// behavior bar is cart/vehicle_lab/index.tsx's handlers; the docs these steps
// produce are exactly what the 'vehicles' stream persists.

import { GAME_VEHICLE, type VehicleDoc } from '@game';

const makeVehicle = GAME_VEHICLE.make;
import {
  VEHICLE_EDITOR_TUNING,
  editGasSide,
  editRole,
  editStyle,
  generateVehicle,
  gasZKnobSpec,
  setGasZ,
  nudgeDamage,
  repaint,
  repairAll,
  setPartDamage,
  wreck,
} from './edits';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

function civilianDoc(): VehicleDoc {
  // seed 3 generates a civilian in the captured role pool — pin it so the
  // role-coercion tests start from a known role.
  const doc = makeVehicle(3);
  return doc.role === 'civilian' ? doc : { ...doc, role: 'civilian', style: 'sedan' };
}

test('generate is the captured deterministic generator', () => {
  assertEqual(JSON.stringify(generateVehicle(20260604)), JSON.stringify(makeVehicle(20260604)),
    'generateVehicle(seed) must be makeVehicle(seed)');
});

test('a style switch keeps the doc but re-fits the gas port (refit clamp)', () => {
  const doc: VehicleDoc = { ...civilianDoc(), style: 'van', gasZ: 1.9 };
  const next = editStyle(doc, 'sports');
  assertEqual(next.style, 'sports', 'style switches');
  const sportsLength = GAME_VEHICLE.tables.styles.sports.length;
  assertClose(next.gasZ, sportsLength * VEHICLE_EDITOR_TUNING.gasZ.refit.maxLengthScale, 1e-9,
    'an out-of-range port clamps to the refit max for the NEW style');
  assertEqual(next.color, doc.color, 'paint survives a style switch');
});

test('a role switch coerces style into the role pool and repaints services', () => {
  const doc = civilianDoc();
  const medical = editRole(doc, 'medical');
  assert((GAME_VEHICLE.tables.roles.medical.styles as readonly string[]).includes(medical.style),
    'style must land in the medical pool');
  assertEqual(medical.color, GAME_VEHICLE.tables.roles.medical.color, 'service roles take the livery color');
  assertEqual(medical.trim, GAME_VEHICLE.tables.roles.medical.trim, 'service roles take the livery trim');
  assertEqual(medical.style, 'ambulance', 'a style outside the pool coerces to the pool head');
  const backToCivilian = editRole({ ...medical, color: '#7a4f86', trim: '#263238' }, 'civilian');
  assertEqual(backToCivilian.color, '#7a4f86', 'civilian keeps the current paint');
  assertEqual(backToCivilian.style, GAME_VEHICLE.tables.roles.civilian.styles[0],
    'ambulance is not a civilian style — it coerces to the civilian pool head (reference behavior)');
  const vanMedic = editRole({ ...civilianDoc(), style: 'van' }, 'medical');
  assertEqual(vanMedic.style, 'van', 'a style already in the pool is kept');
});

test('the gas-Z law: setGasZ clamps to the nudge range, the knob spec follows the style', () => {
  const doc: VehicleDoc = { ...civilianDoc(), style: 'sedan', gasZ: 0 };
  const sedanLength = GAME_VEHICLE.tables.styles.sedan.length;
  assertClose(setGasZ(doc, VEHICLE_EDITOR_TUNING.gasZ.step).gasZ, VEHICLE_EDITOR_TUNING.gasZ.step, 1e-9,
    'an in-range value passes through');
  assertClose(setGasZ(doc, 99).gasZ, sedanLength * VEHICLE_EDITOR_TUNING.gasZ.nudge.maxLengthScale, 1e-9,
    'overshooting saturates at the nudge max');
  assertClose(setGasZ(doc, -99).gasZ, sedanLength * VEHICLE_EDITOR_TUNING.gasZ.nudge.minLengthScale, 1e-9,
    'and at the nudge min the other way');
  const spec = gasZKnobSpec('sedan');
  assertClose(spec.min, sedanLength * VEHICLE_EDITOR_TUNING.gasZ.nudge.minLengthScale, 1e-9, 'spec min follows length');
  assertClose(spec.max, sedanLength * VEHICLE_EDITOR_TUNING.gasZ.nudge.maxLengthScale, 1e-9, 'spec max follows length');
  assertEqual(spec.step, VEHICLE_EDITOR_TUNING.gasZ.step, 'spec step is the tuned step');
  assertEqual(editGasSide(doc, 1).gasSide, 1, 'gas side flips to passenger');
  assertEqual(editGasSide(doc, -1).gasSide, -1, 'and back to driver');
});

test('repaint is deterministic per seed and draws from the captured tables', () => {
  const doc = civilianDoc();
  const a = repaint(doc, 99);
  const b = repaint(doc, 99);
  assertEqual(a.color + a.trim, b.color + b.trim, 'same seed, same paint');
  assert((GAME_VEHICLE.tables.random.colors as readonly string[]).includes(a.color), 'color from the table');
  assert((GAME_VEHICLE.tables.random.trims as readonly string[]).includes(a.trim), 'trim from the table');
});

test('damage editing: explicit set, sparse clear, clamped nudge', () => {
  const doc = civilianDoc();
  const dented = setPartDamage(doc, 'windshield', 2);
  assertEqual(dented.damage.windshield, 2, 'explicit level set');
  const repaired = setPartDamage(dented, 'windshield', 0);
  assert(!('windshield' in repaired.damage), 'level 0 clears the sparse entry');
  const maxed = nudgeDamage(nudgeDamage(nudgeDamage(nudgeDamage(doc, 'hood', 1), 'hood', 1), 'hood', 1), 'hood', 1);
  assertEqual(maxed.damage.hood, 3, 'nudges clamp at broken');
  const floor = nudgeDamage(doc, 'hood', -1);
  assert(!('hood' in floor.damage), 'nudging below clean stays sparse');
});

test('wreck is a deterministic seeded spread over the part vocabulary; repair empties', () => {
  const doc = civilianDoc();
  const a = wreck(doc, 1234);
  const b = wreck(doc, 1234);
  assertEqual(JSON.stringify(a.damage), JSON.stringify(b.damage), 'same seed, same wreck');
  const parts = Object.keys(a.damage);
  assert(parts.length > 0, 'a wreck damages something');
  for (const part of parts) {
    assert((GAME_VEHICLE.tables.parts as readonly string[]).includes(part), `damaged part ${part} is in the vocabulary`);
    const level = (a.damage as any)[part];
    assert(level >= 1 && level <= 3, 'wreck levels are 1..3');
  }
  assertEqual(Object.keys(repairAll(a).damage).length, 0, 'repair clears every entry');
});

test('every edit step yields a doc the builder accepts (no editor-only fields)', () => {
  let doc = generateVehicle(42);
  doc = editRole(doc, 'fire');
  doc = editStyle(doc, 'pickup');
  doc = setGasZ(doc, doc.gasZ + VEHICLE_EDITOR_TUNING.gasZ.step);
  doc = repaint(doc, 7);
  doc = wreck(doc, 7);
  const build = GAME_VEHICLE.build(doc, []);
  assert(build.meshes.length > 0, 'the edited doc builds meshes');
  assert(build.hitboxes.length > 0, 'and hitboxes');
  assertEqual(JSON.stringify(Object.keys(doc).sort()),
    JSON.stringify(Object.keys(makeVehicle(1)).sort()),
    'edit steps never grow the VehicleDoc shape');
});

finish('editors/vehicles');
