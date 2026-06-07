// source.test.ts -- WBSTEP6-0606 vehicle WorkbenchSource parity tests.

import { assert, assertClose, assertEqual, finish, test } from '../../../game/_testkit';
import { GAME_VEHICLE, vehiclesStream, type VehicleDoc, type VehiclesStreamState } from '../../../game';
import { createVehicleStore, type VehicleStoreDeps } from './store';
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
  let state = vehiclesStream.initial();
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

test('C1/C2: vehicle source lists the garage and restores the active row', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const src = vehiclesSource(store);
  const rows = src.list();
  assertEqual(rows.map((r) => r.id).join(','), 'car-1,car-2', 'garage rows come from the vehicles stream');
  assertEqual(rows.map((r) => r.label).join(','), 'ambulance,pickup', 'visible rows are vehicle identity, not generic car ids');
  assertEqual(src.defaultRow!(rows), 'car-2', 'latest vehicle is the default active row');
  src.onPick!('car-1');
  assertEqual(store.activeId, 'car-1', 'onPick selects the row through the store door');
  assertEqual(store.status, 'loaded ambulance', 'status names the vehicle identity');
});

test('C3: new vehicle authors a generated doc and makes it active', () => {
  const { deps, rec } = fakeDeps(false);
  const store = createVehicleStore(deps);
  const src = vehiclesSource(store);
  src.emptyActions!()[0].run();
  assertEqual(rec.commits.length, 1, 'new vehicle commits one authored event');
  assertEqual(rec.commits[0].e.kind, 'authored', 'event is the vehicles stream shape');
  assert(!String(rec.commits[0].e.id).startsWith('car-'), 'new vehicle ids are identity-based, never car-N');
  assertEqual(rec.commits[0].e.id, String(rec.commits[0].e.doc.style).replace(/_/g, '-'), 'new id starts from what the vehicle is');
  assertEqual(store.activeId, rec.commits[0].e.id, 'new row becomes active');
  assertEqual(store.view.pose, 'parked', 'new vehicle resets pose');
});

test('C4: remove deletes the active vehicle and retargets the garage', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  store.pick('car-2');
  store.removeActive();
  assertEqual(rec.commits[0].e.kind, 'removed', 'delete commits a removed event');
  assertEqual(rec.commits[0].e.id, 'car-2', 'the active id is removed');
  assertEqual(store.activeId, 'car-1', 'active retargets to the remaining latest row');
});

test('C5: vehicle identity enum writes through the captured editStyle door without exposing style language', () => {
  const { deps, rec } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const vehicle = field(vehiclePanel(store), 'IDENTITY', 'vehicle') as any;
  assertEqual(field(vehiclePanel(store), 'IDENTITY', 'style'), undefined, 'style is not a workbench field');
  vehicle.set('van');
  assertEqual(store.doc!.style, 'van', 'vehicle identity changed on the active document');
  assertEqual(rec.commits[0].label, 'van: vehicle -> van', 'commit label names the vehicle identity');
});

test('C6: service enum changes service/livery without rewriting vehicle identity', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  const before = store.doc!.style;
  (field(vehiclePanel(store), 'IDENTITY', 'service') as any).set('medical');
  assertEqual(store.doc!.role, 'medical', 'role changes');
  assertEqual(store.doc!.style, before, 'vehicle identity does not change when service changes');
  assertEqual(store.doc!.color, GAME_VEHICLE.tables.roles.medical.color, 'service livery color applies');
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
  (field(vehiclePanel(store), 'DEBUG', 'reroll') as any).run();
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

test('C13: contract readouts expose vehicle, service, scale, pose DSL, gas, and selected damage', () => {
  const { deps } = fakeDeps(true);
  const store = createVehicleStore(deps);
  store.setSelectedPart('gas_tank');
  const spec = vehiclePanel(store);
  assertEqual(field(spec, 'CONTRACT', 'id'), undefined, 'raw stream id is hidden from the workbench contract');
  assertEqual((field(spec, 'CONTRACT', 'vehicle') as any).get(), GAME_VEHICLE.tables.styles[store.doc!.style].label, 'vehicle identity readout');
  assertEqual(field(spec, 'CONTRACT', 'style'), undefined, 'style readout is gone from the workbench contract');
  assertEqual((field(spec, 'CONTRACT', 'service') as any).get(), GAME_VEHICLE.tables.roles[store.doc!.role].label, 'service readout');
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
