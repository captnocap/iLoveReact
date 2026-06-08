// editors/workbench/vehicles/panel.ts -- headless vehicle WorkbenchSource core.

import type { WorkbenchSource, ActionSpec, RosterRow } from '../../../shell/Workbench';
import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import {
  GAME_VEHICLE,
  type DamageLevel,
  type VehiclePartId,
  type VehiclePoseId,
} from '../../../game';
import { vehicleWorkbenchStore, type VehicleLens, type VehicleStore } from './store';

export const VEHICLE_LENSES: LensSpec[] = [
  { id: 'preview', label: '3D' },
  { id: 'paint', label: 'PAINT' },
];

const poseIds = Object.keys(GAME_VEHICLE.tables.poses) as VehiclePoseId[];
const damageLevels = [0, 1, 2, 3] as DamageLevel[];

function hitboxGroups(s: VehicleStore): VehiclePartId[] {
  const doc = s.doc;
  if (!doc) return ['body'];
  const build = GAME_VEHICLE.build(doc, []);
  const ids: VehiclePartId[] = [];
  for (const h of build.hitboxes) if (!ids.includes(h.id)) ids.push(h.id);
  return ids;
}

export function vehiclePanel(s: VehicleStore): PanelSpec {
  const doc = s.doc;
  if (!doc) {
    return {
      groups: [{
        title: 'GARAGE',
        fields: [
          { k: 'status', t: 'val', get: () => s.status ?? 'population unavailable' },
        ],
      }],
    };
  }

  const dims = GAME_VEHICLE.tables.styles[doc.style];
  const poseDef = GAME_VEHICLE.tables.poses[s.view.pose];
  const selected = s.view.selectedPart;
  const selectedDamage = s.selectedDamage();
  const partOpts = ['none', ...hitboxGroups(s)] as string[];
  const gasSpec = s.gasZSpec();
  const groups: PanelSpec['groups'] = [];

  groups.push({
    title: 'IDENTITY',
    fields: [
      { k: 'vehicle', t: 'val', get: () => GAME_VEHICLE.tables.styles[doc.style].label },
      { k: 'service', t: 'val', get: () => GAME_VEHICLE.tables.roles[doc.role].label },
      { k: 'color', t: 'color', get: () => doc.color },
      { k: 'trim', t: 'color', get: () => doc.trim },
    ],
  });

  groups.push({
    title: 'POPULATION',
    fields: [
      { k: 'spawn rate', t: 'num', ...s.populationSpec.spawnRate, get: () => doc.spawnRate ?? 0, set: (x) => s.setSpawnRate(x) },
      { k: 'rarity', t: 'num', ...s.populationSpec.rarity, get: () => doc.rarity ?? 0, set: (x) => s.setRarity(x) },
      { k: 'speed', t: 'num', ...s.populationSpec.speed, get: () => doc.speed ?? 0, set: (x) => s.setSpeed(x) },
      { k: 'consumer', t: 'val', get: () => 'world vehicle spawner reads per-type population rows' },
    ],
  });

  groups.push({
    title: 'COLOR VARIATIONS',
    fields: [
      { k: 'add material', t: 'pick', opts: () => s.materialOptions(), get: () => null, set: (x) => { if (x) s.addColorVariation(x); }, clearLabel: 'none' },
      { k: 'preview material', t: 'pick', opts: () => s.colorVariationOptions(), get: () => doc.activeColorVariationId ?? null, set: (x) => s.setActiveColorVariation(x), clearLabel: 'base' },
      { k: 'active', t: 'val', get: () => s.activeColorVariation()?.label ?? 'base' },
      { k: 'count', t: 'val', get: () => `${doc.colorVariations?.length ?? 0}` },
      { k: 'remove active', t: 'act', tone: 'warning', run: () => s.removeActiveColorVariation() },
    ],
  });

  groups.push({
    title: 'MOTION',
    fields: [
      { k: 'pose', t: 'enum', opts: poseIds, get: () => s.view.pose, set: (x) => s.setPose(x as VehiclePoseId) },
      { k: 'run', t: 'bool', get: () => s.view.running, set: (x) => s.setRunning(x) },
      { k: 'dsl', t: 'val', get: () => poseDef.dsl },
    ],
  });

  groups.push({
    title: 'DEBUG',
    fields: [
      { k: 'hitboxes', t: 'bool', get: () => s.view.showHitboxes, set: (x) => s.setShowHitboxes(x) },
      { k: 'anchors', t: 'bool', get: () => s.view.showAnchors, set: (x) => s.setShowAnchors(x) },
      { k: 'reroll look', t: 'act', tone: 'warning', run: () => s.reroll() },
      { k: 'paint', t: 'act', tone: 'success', run: () => s.repaint() },
    ],
  });

  groups.push({
    title: 'GAS TANK',
    fields: [
      { k: 'side', t: 'enum', opts: ['driver', 'passenger'], get: () => (doc.gasSide < 0 ? 'driver' : 'passenger'), set: (x) => s.setGasSide(x === 'driver' ? -1 : 1) },
      { k: 'gas z', t: 'num', ...gasSpec, get: () => doc.gasZ, set: (x) => s.setGasZ(x) },
    ],
  });

  groups.push({
    title: 'DAMAGE',
    fields: [
      { k: 'part', t: 'enum', opts: partOpts, get: () => selected ?? 'none', set: (x) => s.setSelectedPart(x === 'none' ? null : (x as VehiclePartId)) },
      { k: 'repair', t: 'act', tone: 'success', run: () => s.repairSelected() },
      { k: 'damage', t: 'act', tone: 'error', run: () => s.damageSelected() },
      { k: 'wreck', t: 'act', tone: 'warning', run: () => s.wreck() },
      ...damageLevels.map((level): FieldSpec => ({
        k: GAME_VEHICLE.tables.damageLabels[level],
        t: 'act',
        tone: level === 0 ? 'success' : level === 3 ? 'error' : 'warning',
        run: () => s.setDamage(level),
      })),
      { k: 'current', t: 'val', get: () => (selected ? GAME_VEHICLE.tables.damageLabels[selectedDamage] : 'none selected') },
    ],
  });

  groups.push({
    title: 'CONTRACT',
    fields: [
      { k: 'vehicle', t: 'val', get: () => GAME_VEHICLE.tables.styles[doc.style].label },
      { k: 'service', t: 'val', get: () => GAME_VEHICLE.tables.roles[doc.role].label },
      { k: 'spawn rate', t: 'val', get: () => `${doc.spawnRate ?? 0}` },
      { k: 'rarity', t: 'val', get: () => `${doc.rarity ?? 0}` },
      { k: 'speed', t: 'val', get: () => `${doc.speed ?? 0}` },
      { k: 'color variations', t: 'val', get: () => `${doc.colorVariations?.length ?? 0}` },
      { k: 'scale', t: 'val', get: () => '1 unit = 1m, player ref 1.65m' },
      { k: 'size', t: 'val', get: () => `${dims.length.toFixed(2)}m L x ${dims.width.toFixed(2)}m W` },
      { k: 'wheel', t: 'val', get: () => `${(dims.wheelR * 2).toFixed(2)}m diameter` },
      { k: 'seed', t: 'val', get: () => `${doc.seed}` },
      { k: 'gas tank', t: 'val', get: () => `${doc.gasSide < 0 ? 'driver' : 'passenger'} side, z ${doc.gasZ.toFixed(2)}` },
      { k: 'selected', t: 'val', get: () => (selected ? GAME_VEHICLE.tables.labels[selected] : 'none') },
      { k: 'damage', t: 'val', get: () => (selected ? GAME_VEHICLE.tables.damageLabels[selectedDamage] : 'none selected') },
      { k: 'status', t: 'val', get: () => s.status ?? 'ready' },
    ],
  });

  return { groups };
}

function rosterDoors(s: VehicleStore) {
  return {
    list(): RosterRow[] { return s.listRows(); },
    defaultRow: (rows: RosterRow[]) => s.defaultRow(rows),
    onPick: (id: string) => s.pick(id),
    select: () => s,
    subscribe: (fn: () => void) => s.subscribe(fn),
  };
}

export function vehicleSourceCore(store?: VehicleStore): Omit<WorkbenchSource<VehicleStore>, 'stage'> & { store: VehicleStore } {
  const s = store ?? vehicleWorkbenchStore();
  return {
    store: s,
    id: 'vehicle',
    icon: 'Car',
    kicker: 'VEHICLES',
    ...rosterDoors(s),
    panel: () => vehiclePanel(s),
    lenses: () => VEHICLE_LENSES,
    activeLens: () => s.view.lens,
    onLens: (_subject, id) => s.setLens(id as VehicleLens),
    actions(): ActionSpec[] {
      return [
        { id: 'save', label: 'Save', icon: 'Check', run: () => s.saveActive() },
        { id: 'reroll', label: 'Reroll', icon: 'Shuffle', run: () => s.reroll() },
        { id: 'paint', label: 'Paint', icon: 'Palette', run: () => s.setLens('paint') },
      ];
    },
    emptyActions(): ActionSpec[] {
      return [{ id: 'save', label: 'Save', icon: 'Check', run: () => s.saveActive() }];
    },
  };
}
