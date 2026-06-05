// vehicle.test.ts - P4 behavior tests for the V10 vehicle capture.

import {
  GAME_VEHICLE,
  VEHICLE_DAMAGE_LABELS,
  VEHICLE_PART_IDS,
  VEHICLE_PART_LABELS,
  VEHICLE_POSES,
  VEHICLE_ROLES,
  VEHICLE_STYLES,
  buildVehicle,
  makeVehicle,
  panelMaterial,
  type DamageLevel,
  type VehicleDoc,
  type VehiclePartId,
  type VehicleRoleId,
  type VehicleStyleId,
} from './index';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const EPS = 1e-9;
const REFERENCE_COUNTS = Object.freeze({
  parts: 18,
  styles: 8,
  roles: 4,
  poses: 5,
});

function doc(overrides: Partial<VehicleDoc> = {}): VehicleDoc {
  return {
    style: 'sedan',
    role: 'civilian',
    seed: 1,
    color: '#2f6fb0',
    trim: '#171a1f',
    gasSide: -1,
    gasZ: 0.5,
    damage: {},
    ...overrides,
  };
}

function idsIn<T extends { id: VehiclePartId }>(xs: readonly T[]): Set<VehiclePartId> {
  return new Set(xs.map((x) => x.id));
}

function meshCountsByPart(source: VehicleDoc): Record<VehiclePartId, number> {
  const counts = Object.fromEntries(VEHICLE_PART_IDS.map((id) => [id, 0])) as Record<VehiclePartId, number>;
  for (const mesh of buildVehicle(source).meshes) counts[mesh.id] += 1;
  return counts;
}

function firstMesh(source: VehicleDoc, id: VehiclePartId) {
  const mesh = buildVehicle(source).meshes.find((m) => m.id === id);
  assert(mesh != null, `${id} mesh must exist`);
  return mesh!;
}

test('reference vocabulary counts are fully captured', () => {
  assertEqual(VEHICLE_PART_IDS.length, REFERENCE_COUNTS.parts, 'VehiclePartId count');
  assertEqual(Object.keys(VEHICLE_STYLES).length, REFERENCE_COUNTS.styles, 'VehicleStyleId count');
  assertEqual(Object.keys(VEHICLE_ROLES).length, REFERENCE_COUNTS.roles, 'VehicleRoleId count');
  assertEqual(Object.keys(VEHICLE_POSES).length, REFERENCE_COUNTS.poses, 'VehiclePoseId count');
  assertEqual(Object.keys(VEHICLE_DAMAGE_LABELS).length, 4, 'damage levels');

  for (const id of VEHICLE_PART_IDS) {
    assertEqual(VEHICLE_PART_LABELS[id].length > 0, true, `${id} must have a label`);
  }
});

test('makeVehicle is deterministic and role-constrained', () => {
  const a = makeVehicle(20260604);
  const b = makeVehicle(20260604);
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'same seed must regenerate the same vehicle doc');
  assertEqual(a.seed, 20260604, 'seed rides the document');
  assertEqual(Object.keys(a.damage).length, 0, 'generated docs start with sparse empty damage');

  for (let seed = 1; seed <= 96; seed++) {
    const generated = makeVehicle(seed);
    assert(VEHICLE_ROLES[generated.role].styles.includes(generated.style), `seed ${seed} style must be legal for role`);
    assert(generated.gasSide === -1 || generated.gasSide === 1, `seed ${seed} gas side must be signed`);
  }
});

test('buildVehicle sweeps the doc space with all semantic parts present', () => {
  const styles = Object.keys(VEHICLE_STYLES) as VehicleStyleId[];
  const roles = Object.keys(VEHICLE_ROLES) as VehicleRoleId[];
  let cases = 0;
  for (const style of styles) {
    for (const role of roles) {
      for (const gasSide of [-1, 1] as const) {
        const built = buildVehicle(doc({ style, role, gasSide, gasZ: 0.25 }));
        const meshIds = idsIn(built.meshes);
        const hitboxIds = idsIn(built.hitboxes);
        for (const id of VEHICLE_PART_IDS) {
          assert(meshIds.has(id), `${style}/${role}/${gasSide} must render ${id}`);
          assert(hitboxIds.has(id), `${style}/${role}/${gasSide} must hitbox ${id}`);
        }
        assertEqual(built.hitboxes.length, 19, `${style}/${role}/${gasSide} keeps the reference hitbox count`);
        assertEqual(built.hitboxes.filter((h) => h.id === 'bumper').length, 2, 'front and rear bumpers share the semantic bumper id');
        assertEqual(built.hitboxes.filter((h) => h.critical).map((h) => h.id).sort().join(','),
          'front_left_wheel,front_right_wheel,gas_tank,hood,rear_left_wheel,rear_right_wheel',
          'critical hitbox vocabulary');
        assertClose(built.anchors.gasPort[0], built.hitboxes.find((h) => h.id === 'gas_tank')!.position[0], EPS, 'gas anchor x');
        assertClose(built.anchors.gasPort[2], 0.25, EPS, 'gas anchor z follows VehicleDoc.gasZ');
        cases += 1;
      }
    }
  }
  assertEqual(cases, 64, 'case sweep size');
});

test('damage tables mean darker panels, weaker glass, and sparse repair', () => {
  assertEqual(panelMaterial('#2f6fb0', 0), '#2f6fb0', 'clean panel stays base color');
  assertEqual(panelMaterial('#2f6fb0', 1), '#275b90', 'scuffed panel shade');
  assertEqual(panelMaterial('#2f6fb0', 2), '#1d456d', 'dented panel shade');
  assertEqual(panelMaterial('#2f6fb0', 3), '#122a43', 'broken panel shade');

  const source = doc({ damage: { body: 2, windshield: 3, gas_tank: 3 } });
  const built = buildVehicle(source);
  const cabin = built.meshes.find((m) => m.id === 'cabin')!;
  const windshield = built.meshes.find((m) => m.id === 'windshield')!;
  const gas = built.meshes.find((m) => m.id === 'gas_tank')!;
  assertEqual(cabin.material, panelMaterial(panelMaterial(source.color, 1), 2), 'body damage cascades through cabin paint');
  assertEqual(typeof windshield.material, 'object', 'damaged windshield stays material metadata');
  assertEqual((windshield.material as any).health, 0, 'broken glass health is data');
  assertEqual((gas.material as any).health, 0, 'broken gas port health is data');
});

test('actions drive wheel spin, steering, suspension bounce, and braking', () => {
  const moving = buildVehicle(doc(), [
    { target: 'wheels', action: 'spin_loop', phase: 0.25, weight: 1 },
    { target: 'front_wheels', action: 'steer_loop', phase: 0.25, weight: 1 },
    { target: 'suspension', action: 'bounce_loop', phase: 0.25, weight: 1 },
    { target: 'vehicle', action: 'brake', phase: 0.5, weight: 0.5 },
  ]);
  const frontWheel = moving.meshes.find((m) => m.id === 'front_left_wheel' && m.kind === 'cylinder')!;
  const rearWheel = moving.meshes.find((m) => m.id === 'rear_left_wheel' && m.kind === 'cylinder')!;
  const hood = moving.hitboxes.find((h) => h.id === 'hood')!;
  assertClose(frontWheel.rotation![0], 180, EPS, 'wheel spin phase maps to degrees');
  assertClose(frontWheel.rotation![1], 24, EPS, 'front wheels steer on steer_loop');
  assertClose(rearWheel.rotation![1], 0, EPS, 'rear wheels do not steer');
  assertClose(hood.rotation![0], -1.5, EPS, 'brake action pitches hood hitbox by weighted brake nose');

  const parked = buildVehicle(doc()).anchors.gasPort;
  assertClose(moving.anchors.gasPort[1] - parked[1], 0.045, EPS, 'suspension bounce raises the rig from table data');
});

test('service rigs preserve reference silhouette counts', () => {
  const civilianCounts = meshCountsByPart(doc({ style: 'sedan', role: 'civilian' }));
  const ambulanceCounts = meshCountsByPart(doc({ style: 'ambulance', role: 'medical' }));
  const fireCounts = meshCountsByPart(doc({ style: 'fire_truck', role: 'fire' }));
  assert(civilianCounts.body < ambulanceCounts.body, 'ambulance adds service body panels');
  assert(fireCounts.trunk > ambulanceCounts.trunk, 'fire truck carries compartment and hose geometry');
  assertEqual(fireCounts.rear_left_wheel, 9, 'fire-truck tandem rear-left wheel meshes keep the same semantic id');
  assertEqual(fireCounts.rear_right_wheel, 9, 'fire-truck tandem rear-right wheel meshes keep the same semantic id');
});

test('GAME_VEHICLE is the sealed door and carries the captured interface', () => {
  assert(Object.isFrozen(GAME_VEHICLE), 'GAME_VEHICLE must be sealed');
  assertEqual(typeof GAME_VEHICLE.make, 'function', 'make door');
  assertEqual(typeof GAME_VEHICLE.build, 'function', 'build door');
  assertEqual(GAME_VEHICLE.tables.parts.length, REFERENCE_COUNTS.parts, 'door exposes part table');
  assertEqual(firstMesh(doc(), 'body').label, VEHICLE_PART_LABELS.body, 'builder reads labels from the table');
});

finish('game/vehicle');
