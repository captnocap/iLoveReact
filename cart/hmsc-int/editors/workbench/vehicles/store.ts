// editors/workbench/vehicles/store.ts -- the vehicle source's state truth.
// Vehicle authoring is a population table: each row is a ruled vehicle type,
// with service inferred from that type and tuning stored on the row.

import {
  GAME_VEHICLE,
  vehiclesStream,
  type DamageLevel,
  type VehicleDoc,
  type VehiclePartId,
  type VehiclePoseId,
  type VehicleRoleId,
  type VehicleStyleId,
  type VehiclesEvent,
  type VehiclesStreamState,
} from '../../../game';
import { allTextures, textureById } from '../../../game/textures/registry';
import { GAME_TELEMETRY } from '../../../game/telemetry';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import { materialLabel, materialPickOptions, type MaterialChoice } from '../materials/chooser';
import {
  editGasSide,
  gasZKnobSpec,
  generateVehicle,
  nudgeDamage,
  repaint,
  repairAll,
  setGasZ,
  setPartDamage,
  wreck,
} from './edits';

const TWIG_ROUTE = '/vehicles';

export type VehicleLens = 'preview' | 'paint';
export type VehiclePopulationId =
  | 'sedan'
  | 'coupe'
  | 'wagon'
  | 'van'
  | 'pickup'
  | 'sports'
  | 'fire-truck'
  | 'police-car'
  | 'ambulance';

type ColorVariation = NonNullable<VehicleDoc['colorVariations']>[number];

type VehiclePopulationRow = {
  id: VehiclePopulationId;
  style: VehicleStyleId;
  label: string;
  spawnRate: number;
  rarity: number;
  speed: number;
  seed: number;
};

export const VEHICLE_POPULATION_ROWS = Object.freeze([
  { id: 'sedan', style: 'sedan', label: 'sedan', spawnRate: 28, rarity: 0.62, speed: 36, seed: 7601 },
  { id: 'coupe', style: 'coupe', label: 'coupe', spawnRate: 14, rarity: 0.42, speed: 40, seed: 7602 },
  { id: 'wagon', style: 'wagon', label: 'wagon', spawnRate: 12, rarity: 0.38, speed: 34, seed: 7603 },
  { id: 'van', style: 'van', label: 'van', spawnRate: 12, rarity: 0.34, speed: 30, seed: 7604 },
  { id: 'pickup', style: 'pickup', label: 'pickup', spawnRate: 10, rarity: 0.32, speed: 33, seed: 7605 },
  { id: 'sports', style: 'sports', label: 'sports', spawnRate: 6, rarity: 0.18, speed: 48, seed: 7606 },
  { id: 'fire-truck', style: 'fire_truck', label: 'fire truck', spawnRate: 1, rarity: 0.04, speed: 24, seed: 7607 },
  { id: 'police-car', style: 'police_car', label: 'police car', spawnRate: 3, rarity: 0.1, speed: 42, seed: 7608 },
  { id: 'ambulance', style: 'ambulance', label: 'ambulance', spawnRate: 2, rarity: 0.07, speed: 38, seed: 7609 },
] as const satisfies readonly VehiclePopulationRow[]);

const VEHICLE_POPULATION_BY_ID = Object.freeze(Object.fromEntries(
  VEHICLE_POPULATION_ROWS.map((row) => [row.id, row]),
) as Record<VehiclePopulationId, VehiclePopulationRow>);

const VEHICLE_POPULATION_BY_STYLE = Object.freeze(Object.fromEntries(
  VEHICLE_POPULATION_ROWS.map((row) => [row.style, row]),
) as Record<VehicleStyleId, VehiclePopulationRow>);

export const VEHICLE_POPULATION_TUNING = Object.freeze({
  spawnRate: { min: 0, max: 100, step: 1, precision: 0 },
  rarity: { min: 0, max: 1, step: 0.01, precision: 2 },
  speed: { min: 0, max: 80, step: 1, precision: 0 },
} as const);

export type VehicleTwigAdapter = {
  read<T>(key: string, initial: T): T;
  write<T>(key: string, value: T): void;
};

export type VehicleStoreDeps = {
  channel: { state(): VehiclesStreamState } | null;
  session: Pick<RouteSession<VehiclesEvent>, 'commit' | 'note'> | null;
  error: string | null;
  twig?: boolean | VehicleTwigAdapter;
  seed?: () => number;
  materials?: () => MaterialChoice[];
  validMaterial?: (id: string) => boolean;
};

function perfNow(): number {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampField(n: number, spec: { min: number; max: number; step: number }): number {
  if (!Number.isFinite(n)) return spec.min;
  const clamped = clamp(n, spec.min, spec.max);
  return Math.round(clamped / spec.step) * spec.step;
}

function roleForStyle(style: VehicleStyleId): VehicleRoleId {
  if (style === 'ambulance') return 'medical';
  if (style === 'police_car') return 'police';
  if (style === 'fire_truck') return 'fire';
  return 'civilian';
}

function defaultMaterials(): MaterialChoice[] {
  return allTextures().map((t) => ({ id: t.id, label: t.label }));
}

function validDefaultMaterial(id: string): boolean {
  return textureById(id) !== undefined;
}

function typeForId(id: string | null | undefined): VehiclePopulationRow | null {
  if (!id) return null;
  return VEHICLE_POPULATION_BY_ID[id as VehiclePopulationId] ?? null;
}

function typeForDoc(doc: VehicleDoc | null | undefined): VehiclePopulationRow | null {
  if (!doc) return null;
  return VEHICLE_POPULATION_BY_STYLE[doc.style] ?? null;
}

function latestAuthoredType(state: VehiclesStreamState): VehiclePopulationId {
  for (let i = state.order.length - 1; i >= 0; i -= 1) {
    const row = typeForDoc(state.vehicles[state.order[i]]);
    if (row) return row.id;
  }
  return VEHICLE_POPULATION_ROWS[0].id;
}

function authoredDocFor(state: VehiclesStreamState, row: VehiclePopulationRow): VehicleDoc | null {
  const direct = state.vehicles[row.id];
  if (direct) return direct;
  for (let i = state.order.length - 1; i >= 0; i -= 1) {
    const doc = state.vehicles[state.order[i]];
    if (doc?.style === row.style) return doc;
  }
  return null;
}

function gasZForStyle(style: VehicleStyleId, source: number): number {
  const spec = gasZKnobSpec(style);
  return clamp(source, spec.min, spec.max);
}

function baseDoc(row: VehiclePopulationRow, seed: number): VehicleDoc {
  const generated = generateVehicle(seed);
  const role = roleForStyle(row.style);
  const preset = GAME_VEHICLE.tables.roles[role];
  const civilian = role === 'civilian';
  return {
    ...generated,
    style: row.style,
    role,
    seed,
    color: civilian ? generated.color : preset.color,
    trim: civilian ? generated.trim : preset.trim,
    spawnRate: row.spawnRate,
    rarity: row.rarity,
    speed: row.speed,
    colorVariations: [],
    activeColorVariationId: null,
    gasZ: gasZForStyle(row.style, generated.gasZ),
    damage: {},
  };
}

function normalizeDoc(row: VehiclePopulationRow, source: VehicleDoc | null | undefined): VehicleDoc {
  const fallback = baseDoc(row, row.seed);
  const role = roleForStyle(row.style);
  const preset = GAME_VEHICLE.tables.roles[role];
  const civilian = role === 'civilian';
  const variations = [...(source?.colorVariations ?? fallback.colorVariations ?? [])];
  const active = source?.activeColorVariationId && variations.some((v) => v.id === source.activeColorVariationId)
    ? source.activeColorVariationId
    : null;
  return {
    ...fallback,
    ...(source ?? {}),
    style: row.style,
    role,
    color: civilian ? (source?.color ?? fallback.color) : preset.color,
    trim: civilian ? (source?.trim ?? fallback.trim) : preset.trim,
    spawnRate: source?.spawnRate ?? row.spawnRate,
    rarity: source?.rarity ?? row.rarity,
    speed: source?.speed ?? row.speed,
    colorVariations: variations,
    activeColorVariationId: active,
    gasZ: gasZForStyle(row.style, source?.gasZ ?? fallback.gasZ),
    damage: source?.damage ?? {},
  };
}

function preservePopulation(next: VehicleDoc, current: VehicleDoc): VehicleDoc {
  return {
    ...next,
    spawnRate: current.spawnRate,
    rarity: current.rarity,
    speed: current.speed,
    colorVariations: [...(current.colorVariations ?? [])],
    activeColorVariationId: current.activeColorVariationId ?? null,
  };
}

export function createVehicleStore(deps: VehicleStoreDeps) {
  const useTwigs = deps.twig !== false;
  const twigAdapter = typeof deps.twig === 'object' ? deps.twig : null;
  const seed = deps.seed ?? freshSeed;
  const materials = deps.materials ?? defaultMaterials;
  const validMaterial = deps.validMaterial ?? validDefaultMaterial;
  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  const twigRead = <T,>(key: string, initial: T): T => {
    if (!useTwigs) return initial;
    if (twigAdapter) return twigAdapter.read(key, initial);
    try { return readRouteTwigState(TWIG_ROUTE, key, initial); } catch { return initial; }
  };
  const twigWrite = <T,>(key: string, value: T): void => {
    if (!useTwigs) return;
    if (twigAdapter) { twigAdapter.write(key, value); return; }
    try { writeRouteTwigState(TWIG_ROUTE, key, value); } catch { /* twigless host */ }
  };

  let state = deps.channel?.state() ?? vehiclesStream.initial();
  const initialType = latestAuthoredType(state);
  const twigActive = twigRead<string | null>('activeId', initialType);
  let activeId: VehiclePopulationId = (typeForId(twigActive)?.id ?? initialType) as VehiclePopulationId;
  let frame = 0;
  let status: string | null = deps.error ? `store unavailable: ${deps.error}` : null;
  let rev = 0;

  const view = {
    lens: twigRead<VehicleLens>('wbLens', 'preview'),
    pose: twigRead<VehiclePoseId>('pose', 'parked'),
    running: twigRead('running', false),
    showHitboxes: twigRead('showHitboxes', true),
    showAnchors: twigRead('showAnchors', true),
    selectedPart: twigRead<VehiclePartId | null>('selectedPart', 'gas_tank'),
    orbitDistance: twigRead('orbitDistance', 8.2),
    orbitLook: twigRead('orbitLook', { yaw: 34, pitch: 24 }),
  };

  const setViewKey = <K extends keyof typeof view>(key: K, twigKey: string) => (value: (typeof view)[K]) => {
    view[key] = value;
    twigWrite(twigKey, value);
    emit();
  };

  const syncState = () => { state = deps.channel?.state() ?? state; };
  const activeType = (): VehiclePopulationRow => VEHICLE_POPULATION_BY_ID[activeId];
  const currentDoc = (): VehicleDoc => {
    syncState();
    const row = activeType();
    return normalizeDoc(row, authoredDocFor(state, row));
  };

  const bump = () => { rev += 1; syncState(); emit(); };

  const author = (id: VehiclePopulationId, next: VehicleDoc, label: string) => {
    if (!deps.session || !deps.channel) {
      status = `save unavailable: ${deps.error ?? 'no session'}`;
      emit();
      return;
    }
    const row = VEHICLE_POPULATION_BY_ID[id];
    const doc = normalizeDoc(row, next);
    deps.session.commit({ kind: 'authored', id, doc }, `${row.label}: ${label}`);
    status = `${row.label}: ${label}`;
    bump();
  };
  const apply = (next: VehicleDoc, label: string) => author(activeId, next, label);

  const setPose = (pose: VehiclePoseId) => {
    view.pose = pose;
    twigWrite('pose', pose);
    frame = 0;
    view.running = pose !== 'parked';
    twigWrite('running', view.running);
    emit();
  };

  const selectedDamage = (): DamageLevel => {
    const doc = currentDoc();
    const part = view.selectedPart;
    return doc && part ? GAME_VEHICLE.damageOf(doc, part) : 0;
  };

  const setPopulationField = (field: 'spawnRate' | 'rarity' | 'speed', value: number, label: string) => {
    const doc = currentDoc();
    const next = clampField(value, VEHICLE_POPULATION_TUNING[field]);
    apply({ ...doc, [field]: next }, `${label} -> ${next}`);
  };

  return {
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
    get state() { return state; },
    get activeId() { return activeId; },
    get doc() { return currentDoc(); },
    get activeType() { return activeType(); },
    get view() { return view; },
    get frame() { return frame; },
    get status() { return status; },
    get rev() { return rev; },
    get sessionError() { return deps.error; },
    get populationSpec() { return VEHICLE_POPULATION_TUNING; },
    selectedDamage,
    tickFrame() {
      if (!view.running) return;
      frame += 1;
      emit();
    },
    setStatus(s: string | null) { status = s; emit(); },
    listRows() {
      syncState();
      return VEHICLE_POPULATION_ROWS.map((row) => ({ id: row.id, label: row.label, icon: 'Car' }));
    },
    defaultRow(rows: Array<{ id: string }>) {
      if (rows.some((r) => r.id === activeId)) return activeId;
      return rows[0]?.id;
    },
    pick(id: string) {
      const row = typeForId(id);
      if (!row) return;
      activeId = row.id;
      twigWrite('activeId', row.id);
      view.selectedPart = 'gas_tank';
      twigWrite('selectedPart', view.selectedPart);
      status = `loaded ${row.label}`;
      emit();
    },
    saveActive() {
      author(activeId, currentDoc(), 'saved');
    },
    reroll() {
      const row = activeType();
      const current = currentDoc();
      apply(preservePopulation(baseDoc(row, seed()), current), 'reroll');
    },
    repaint() {
      const doc = currentDoc();
      apply(normalizeDoc(activeType(), preservePopulation(repaint(doc, seed()), doc)), 'repaint');
    },
    setSpawnRate(value: number) { setPopulationField('spawnRate', value, 'spawn rate'); },
    setRarity(value: number) { setPopulationField('rarity', value, 'rarity'); },
    setSpeed(value: number) { setPopulationField('speed', value, 'speed'); },
    materialOptions() { return materialPickOptions(materials()); },
    colorVariationOptions() {
      const doc = currentDoc();
      return materialPickOptions((doc.colorVariations ?? []).map((v) => ({ id: v.id, label: v.label })));
    },
    activeColorVariation(): ColorVariation | null {
      const doc = currentDoc();
      return (doc.colorVariations ?? []).find((v) => v.id === doc.activeColorVariationId) ?? null;
    },
    addColorVariation(textureId: string) {
      if (!validMaterial(textureId)) {
        status = `unknown material: ${textureId}`;
        emit();
        return;
      }
      const doc = currentDoc();
      const current = doc.colorVariations ?? [];
      const nextVariation = { id: textureId, label: materialLabel(materials(), textureId), textureId };
      const variations = current.some((v) => v.id === textureId) ? current : [...current, nextVariation];
      apply({ ...doc, colorVariations: variations, activeColorVariationId: textureId }, `color variation -> ${nextVariation.label}`);
    },
    setActiveColorVariation(textureId: string | null) {
      const doc = currentDoc();
      const active = textureId && (doc.colorVariations ?? []).some((v) => v.id === textureId) ? textureId : null;
      apply({ ...doc, activeColorVariationId: active }, active ? `preview material -> ${active}` : 'preview material -> base');
    },
    removeActiveColorVariation() {
      const doc = currentDoc();
      const active = doc.activeColorVariationId;
      if (!active) return;
      const variations = (doc.colorVariations ?? []).filter((v) => v.id !== active);
      apply({ ...doc, colorVariations: variations, activeColorVariationId: null }, `removed color variation ${active}`);
    },
    setGasSide(side: -1 | 1) {
      const doc = currentDoc();
      apply(editGasSide(doc, side), side < 0 ? 'gas -> driver side' : 'gas -> passenger side');
    },
    setGasZ(v: number) {
      const doc = currentDoc();
      apply(setGasZ(doc, v), `gas z -> ${v.toFixed(2)}`);
    },
    gasZSpec() {
      return gasZKnobSpec(activeType().style);
    },
    setSelectedPart(part: VehiclePartId | null) {
      view.selectedPart = part;
      twigWrite('selectedPart', part);
      emit();
    },
    repairSelected() {
      const doc = currentDoc();
      if (view.selectedPart) apply(setPartDamage(doc, view.selectedPart, 0), `repaired ${view.selectedPart}`);
      else apply(repairAll(doc), 'repaired all');
    },
    damageSelected() {
      const doc = currentDoc();
      if (view.selectedPart) apply(nudgeDamage(doc, view.selectedPart, 1), `damaged ${view.selectedPart}`);
    },
    wreck() {
      apply(wreck(currentDoc(), seed()), 'wrecked');
    },
    setDamage(level: DamageLevel) {
      const doc = currentDoc();
      if (view.selectedPart) apply(setPartDamage(doc, view.selectedPart, level), `${view.selectedPart} -> ${GAME_VEHICLE.tables.damageLabels[level]}`);
    },
    setPose,
    setRunning: setViewKey('running', 'running'),
    setShowHitboxes: setViewKey('showHitboxes', 'showHitboxes'),
    setShowAnchors: setViewKey('showAnchors', 'showAnchors'),
    setLens: setViewKey('lens', 'wbLens'),
    setOrbitDistance: setViewKey('orbitDistance', 'orbitDistance'),
    setOrbitLook: setViewKey('orbitLook', 'orbitLook'),
    note: (label: string) => deps.session?.note?.(label),
  };
}

export type VehicleStore = ReturnType<typeof createVehicleStore>;

let liveStore: VehicleStore | null = null;

export function vehicleWorkbenchStore(): VehicleStore {
  if (liveStore) return liveStore;
  const t0 = perfNow();
  let deps: VehicleStoreDeps;
  try {
    const channel = editorChannel(vehiclesStream);
    const session = editorSessions().open('/workbench', channel) as RouteSession<VehiclesEvent>;
    deps = { channel, session, error: null };
  } catch (e) {
    deps = { channel: null, session: null, error: String(e) };
  }
  liveStore = createVehicleStore(deps);
  GAME_TELEMETRY.recordDiagnostic('churn', 'vehicleStore.create', {
    totalMs: perfNow() - t0,
    orderCount: liveStore.state.order.length,
    error: deps.error,
  });
  return liveStore;
}
