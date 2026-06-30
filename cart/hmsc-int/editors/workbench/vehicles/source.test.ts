// source.test.ts -- vehicle WorkbenchSource population-table parity tests.

import { assert, assertClose, assertEqual, finish, test } from '../../../game/_testkit';
import { GAME_VEHICLE, vehiclesStream, type VehicleDoc, type VehiclesStreamState } from '../../../game';
import { createVehicleStore, VEHICLE_POPULATION_ROWS, type VehicleStoreDeps } from './store';
import { vehiclePanel, vehicleSourceCore as vehiclesSource } from './panel';
import type { FieldSpec, PanelSpec } from '../../../shell/fields';

type Rec = { commits: Array<{ e: any; label: string }>; notes: string[] };

function vehicleDoc(style: VehicleDoc['style'], role: VehicleDoc['role'] = 'civilian'): VehicleDoc {
  const base = GAME_VEHICLE.make(1);
  const preset = GAME_VEHICLE.tables.roles[role];
  return {
    ...base,
    style,
    role,
    color: role === 'civilian' ? base.color : preset.color,
    trim: role === 'civilian' ? base.trim : preset.trim,
  };
}

function fakeDeps(withDocs: boolean): { deps: VehicleStoreDeps; rec: Rec } {
  const rec: Rec = { commits: [], notes: [] };
  let state: VehiclesStreamState = vehiclesStream.initial();
  if (withDocs) {
    state = vehiclesStream.apply(state, { kind: 'authored', id: 'car-1', doc: vehicleDoc('ambulance', 'medical') });
    state = vehiclesStream.apply(state, { kind: 'authored', id: 'car-2', doc: vehicleDoc('pickup', 'civilian') });
  }
  const deps: VehicleStoreDeps = {
    channel: { state: () => state },
    session: {
      commit: ((e: any, label: string) => {
        rec.commits.push({ e, label });
        state = vehiclesStream.apply(state, e);
      }) as any,
      note: (label: string) => { rec.notes.push(label); },
    },
    error: null,
    twig: false,
    materials: () => [
      { id: 'a-brick', label: 'Brick' },
      { id: 'road', label: 'Road' },
    ],
    validMaterial: (id: string) => id === 'a-brick' || id === 'road',
    seed: (() => {
      let n = 40;
      return () => ++n;
    })(),
  };
  return { deps, rec };
}

function field(spec: PanelSpec, groupTitle: string, k: string): FieldSpec | undefined {
  const g = spec.groups.find((x) => x.title === groupTitle || x.title.startsWith(groupTitle));
  return g?.fields.find((f) => f.k === k);
}

test('C1/C2: vehicle source lists the fixed population roster and restores the active type', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const src = vehiclesSource(store);
  const rows = src.list();
  assertEqual(rows.map((r) => r.id).join(','), VEHICLE_POPULATION_ROWS.map((r) => r.id).join(','), 'roster rows are the ruled vehicle types');
  assertEqual(rows.map((r) => r.label).join(','), 'sedan,coupe,wagon,van,pickup,sports,fire truck,police car,ambulance', 'visible rows are type labels');
  assertEqual(src.defaultRow!(rows), 'pickup', 'latest legacy authored doc maps to its fixed population row');
  src.onPick!('ambulance');
  assertEqual(store.activeId, 'ambulance', 'onPick selects the fixed row through the store door');
  assertEqual(store.status, 'loaded ambulance', 'status names the vehicle type');
});

test('C3: save authors the active population row and new/remove are killed', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createVehicleStore(deps);
  const src = vehiclesSource(store);
  assertEqual(src.actions!(store).map((a) => a.id).join(','), 'save,reroll,paint', 'source actions keep old save/reroll/paint and drop new/remove');
  assertEqual(src.emptyActions!().map((a) => a.id).join(','), 'save', 'empty actions do not mint a car');
  src.actions!(store).find((a) => a.id === 'save')!.run();
  assertEqual(rec.commits.length, 1, 'save commits one authored event');
  assertEqual(rec.commits[0].e.kind, 'authored', 'event is the vehicles stream shape');
  assertEqual(rec.commits[0].e.id, 'sedan', 'saved row id is the fixed type id, never car-N');
  assertEqual(rec.commits[0].e.doc.style, 'sedan', 'saved doc style matches the row');
});

test('C4: legacy arbitrary docs feed matching fixed rows without preserving their ids', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  assertEqual(store.activeId, 'pickup', 'legacy latest car-2 maps to pickup row');
  assertEqual(store.doc!.style, 'pickup', 'active doc comes from the matching legacy source');
  store.pick('ambulance');
  assertEqual(store.doc!.role, 'medical', 'ambulance service is inferred');
  store.saveActive();
  assertEqual(rec.commits[0].e.id, 'ambulance', 'saving legacy source writes the fixed row id');
  assertEqual(rec.commits[0].e.doc.role, 'medical', 'saved doc keeps inferred medical service');
});

test('C5: identity is read-only type/service, with no type enum or service selector', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const spec = vehiclePanel(store);
  const vehicle = field(spec, 'IDENTITY', 'vehicle') as any;
  const service = field(spec, 'IDENTITY', 'service') as any;
  assertEqual(vehicle.t, 'val', 'vehicle identity is a roster row readout');
  assertEqual(service.t, 'val', 'service is a readout, not a selector');
  assertEqual(field(spec, 'IDENTITY', 'style'), undefined, 'style language is not a workbench field');
  assertEqual(typeof vehicle.set, 'undefined', 'vehicle cannot be manually changed inside the row');
  assertEqual(typeof service.set, 'undefined', 'service cannot be manually changed');
});

test('C6: service is inferred from each type', () => {
  const { deps } = fakeDeps(false);
  const store = createVehicleStore(deps);
  const expected: Record<string, VehicleDoc['role']> = {
    sedan: 'civilian',
    coupe: 'civilian',
    wagon: 'civilian',
    van: 'civilian',
    pickup: 'civilian',
    sports: 'civilian',
    'fire-truck': 'fire',
    'police-car': 'police',
    ambulance: 'medical',
  };
  for (const row of VEHICLE_POPULATION_ROWS) {
    store.pick(row.id);
    assertEqual(store.doc!.style, row.style, `${row.id} owns its style`);
    assertEqual(store.doc!.role, expected[row.id], `${row.id} service is inferred`);
  }
});

test('C15: population tuning and shared-material color variations author row data', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createVehicleStore(deps);
  const spec = vehiclePanel(store);
  (field(spec, 'POPULATION', 'spawn rate') as any).set(33);
  (field(vehiclePanel(store), 'POPULATION', 'rarity') as any).set(0.27);
  (field(vehiclePanel(store), 'POPULATION', 'speed') as any).set(44);
  assertEqual(store.doc!.spawnRate, 33, 'spawn rate authors onto the row');
  assertClose(store.doc!.rarity!, 0.27, 1e-9, 'rarity authors onto the row');
  assertEqual(store.doc!.speed, 44, 'speed authors onto the row');
  const addMaterial = field(vehiclePanel(store), 'COLOR VARIATIONS', 'add material') as any;
  assertEqual(addMaterial.opts()[0].group, 'Unsorted Materials', 'vehicle material picker uses the shared material grouping');
  addMaterial.set('a-brick');
  assertEqual(store.doc!.colorVariations![0].textureId, 'a-brick', 'color variation stores the chosen material id');
  assertEqual(store.doc!.activeColorVariationId, 'a-brick', 'added material becomes the preview variation');
  (field(vehiclePanel(store), 'COLOR VARIATIONS', 'preview material') as any).set(null);
  assertEqual(store.doc!.activeColorVariationId, null, 'preview can return to base');
  assertEqual(rec.commits.length, 5, 'population and material edits are authored commits');
});

test('C7: pose and run are twig/view state, not document edits', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const spec = vehiclePanel(store);
  (field(spec, 'MOTION', 'pose') as any).set('roll');
  assertEqual(store.view.pose, 'roll', 'pose changes');
  assertEqual(store.view.running, true, 'non-parked pose starts playback');
  (field(vehiclePanel(store), 'MOTION', 'run') as any).set(false);
  assertEqual(store.view.running, false, 'run toggle writes view state');
  assertEqual(rec.commits.length, 0, 'pose/playback are not persisted as vehicle doc edits');
});

test('C8: overlays are view toggles; reroll and repaint are authored commits', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const spec = vehiclePanel(store);
  (field(spec, 'DEBUG', 'hitboxes') as any).set(false);
  (field(spec, 'DEBUG', 'anchors') as any).set(false);
  assertEqual(store.view.showHitboxes, false, 'hitbox overlay toggles off');
  assertEqual(store.view.showAnchors, false, 'anchor overlay toggles off');
  (field(vehiclePanel(store), 'DEBUG', 'reroll look') as any).run();
  (field(vehiclePanel(store), 'DEBUG', 'paint') as any).run();
  assertEqual(rec.commits.length, 2, 'reroll and repaint author documents');
  assert(rec.commits[0].label.includes('reroll'), 'reroll is labeled');
  assert(rec.commits[1].label.includes('repaint'), 'repaint is labeled');
});

test('C10: gas side and gas z use the route edit functions and style knob spec', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const spec = vehiclePanel(store);
  (field(spec, 'GAS TANK', 'side') as any).set('passenger');
  assertEqual(store.doc!.gasSide, 1, 'gas side flips to passenger');
  const gas = field(vehiclePanel(store), 'GAS TANK', 'gas z') as any;
  gas.set(99);
  const range = store.gasZSpec();
  assertClose(store.doc!.gasZ, range.max, 1e-9, 'gas z clamps to the active style range');
});

test('C11: selected hitbox group is twig state for highlight and paint targeting', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  (field(vehiclePanel(store), 'DAMAGE', 'part') as any).set('hood');
  assertEqual(store.view.selectedPart, 'hood', 'selected part updates');
  assertEqual(rec.commits.length, 0, 'selection is view state, not a doc edit');
});

test('C12: repair, damage, explicit levels, and wreck commit damage edits', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  store.setSelectedPart('hood');
  const spec = vehiclePanel(store);
  (field(spec, 'DAMAGE', 'damage') as any).run();
  assertEqual(store.doc!.damage.hood, 1, 'damage nudges selected part');
  (field(vehiclePanel(store), 'DAMAGE', 'dented') as any).run();
  assertEqual(store.doc!.damage.hood, 2, 'explicit damage level applies');
  (field(vehiclePanel(store), 'DAMAGE', 'repair') as any).run();
  assert(!('hood' in store.doc!.damage), 'repair clears selected damage');
  (field(vehiclePanel(store), 'DAMAGE', 'wreck') as any).run();
  assert(Object.keys(store.doc!.damage).length > 0, 'wreck damages multiple parts');
  assertEqual(rec.commits.length, 4, 'each damage action is one authored commit');
});

test('C13: contract readouts expose type, inferred service, population, scale, pose DSL, gas, and damage', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  store.setSelectedPart('gas_tank');
  const spec = vehiclePanel(store);
  assertEqual(field(spec, 'CONTRACT', 'id'), undefined, 'raw stream id is hidden from the workbench contract');
  assertEqual((field(spec, 'CONTRACT', 'vehicle') as any).get(), GAME_VEHICLE.tables.styles[store.doc!.style].label, 'vehicle identity readout');
  assertEqual(field(spec, 'CONTRACT', 'style'), undefined, 'style readout is gone from the workbench contract');
  assertEqual((field(spec, 'CONTRACT', 'service') as any).get(), GAME_VEHICLE.tables.roles[store.doc!.role].label, 'service readout');
  assertEqual((field(spec, 'CONTRACT', 'spawn rate') as any).get(), `${store.doc!.spawnRate}`, 'spawn rate readout');
  assertEqual((field(spec, 'CONTRACT', 'color variations') as any).get(), `${store.doc!.colorVariations!.length}`, 'variation count readout');
  assert((field(spec, 'CONTRACT', 'scale') as any).get().includes('1m'), 'scale readout');
  assert((field(spec, 'CONTRACT', 'size') as any).get().includes('m L'), 'size readout');
  assert((field(spec, 'MOTION', 'dsl') as any).get().startsWith('['), 'pose DSL readout');
  assert((field(spec, 'CONTRACT', 'gas tank') as any).get().includes('side'), 'gas readout');
  assertEqual((field(spec, 'CONTRACT', 'damage') as any).get(), 'clean', 'selected damage readout');
});

test('C14: preview source exposes 3D/PAINT lenses and controlled orbit state', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const src = vehiclesSource(store);
  assertEqual(src.lenses!(store).map((l) => l.id).join(','), 'preview,paint', 'vehicle source has 3D and PAINT lenses');
  src.onLens!(store, 'paint');
  assertEqual(store.view.lens, 'paint', 'lens is source-controlled');
  store.setOrbitDistance(12);
  store.setOrbitLook({ yaw: 10, pitch: 20 });
  assertEqual(store.view.orbitDistance, 12, 'zoom distance is view state');
  assertEqual(`${store.view.orbitLook.yaw},${store.view.orbitLook.pitch}`, '10,20', 'orbit look is view state');
});

test('C9 already routes through the shared paint bench, and vehicle action opens that lens', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const action = vehiclesSource(store).actions!(store).find((a) => a.id === 'paint')!;
  action.run();
  assertEqual(store.view.lens, 'paint', 'paint action selects the shared PAINT doorway');
});

finish('editors/workbench/vehicles');
