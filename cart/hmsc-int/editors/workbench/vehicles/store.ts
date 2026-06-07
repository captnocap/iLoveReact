// editors/workbench/vehicles/store.ts -- the vehicle source's state truth
// (WBSTEP6-0606). Extracts VehiclesRoute's garage/session/twig behavior into
// a headless store so gutter 3 specs and column 4 stage read/write one source.

import {
  GAME_VEHICLE,
  vehiclesStream,
  type DamageLevel,
  type VehicleDoc,
  type VehiclePartId,
  type VehiclePoseId,
  type VehiclesEvent,
  type VehiclesStreamState,
} from '../../../game';
import { GAME_TELEMETRY } from '../../../game/telemetry';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import {
  editGasSide,
  editStyle,
  gasZKnobSpec,
  generateVehicle,
  nudgeDamage,
  repaint,
  repairAll,
  setGasZ,
  setPartDamage,
  wreck,
} from '../../vehicles/edits';

const TWIG_ROUTE = '/vehicles';

export type VehicleLens = 'preview' | 'paint';

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
};

function perfNow(): number {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
}

function vehicleIdentityId(doc: VehicleDoc): string {
  return doc.style.replace(/_/g, '-');
}

function vehicleIdentityLabel(doc: VehicleDoc): string {
  return GAME_VEHICLE.tables.styles[doc.style].label;
}

function vehicleDisplayName(id: string, doc: VehicleDoc | null | undefined): string {
  if (!doc) return id;
  const label = vehicleIdentityLabel(doc);
  const base = vehicleIdentityId(doc);
  if (id === base) return label;
  if (id.startsWith(`${base}-`)) {
    const suffix = id.slice(base.length + 1);
    if (/^\d+$/.test(suffix)) return `${label} ${suffix}`;
  }
  return label;
}

function freshId(state: VehiclesStreamState, doc: VehicleDoc): string {
  const base = vehicleIdentityId(doc);
  if (!state.vehicles[base]) return base;
  let n = 2;
  while (state.vehicles[`${base}-${n}`]) n += 1;
  return `${base}-${n}`;
}

function editService(doc: VehicleDoc, role: keyof typeof GAME_VEHICLE.tables.roles): VehicleDoc {
  const preset = GAME_VEHICLE.tables.roles[role];
  const civilian = role === 'civilian';
  return {
    ...doc,
    role,
    color: civilian ? doc.color : preset.color,
    trim: civilian ? doc.trim : preset.trim,
  };
}

export function createVehicleStore(deps: VehicleStoreDeps) {
  const useTwigs = deps.twig !== false;
  const twigAdapter = typeof deps.twig === 'object' ? deps.twig : null;
  const seed = deps.seed ?? freshSeed;
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
  let activeId = twigRead<string | null>('activeId', state.order[state.order.length - 1] ?? null);
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
  const setActiveId = (id: string | null) => {
    activeId = id;
    twigWrite('activeId', id);
    emit();
  };
  const bump = () => { rev += 1; syncState(); emit(); };
  const currentDoc = (): VehicleDoc | null => {
    syncState();
    return activeId ? state.vehicles[activeId] ?? null : null;
  };

  const author = (id: string, next: VehicleDoc, label: string) => {
    if (!deps.session || !deps.channel) {
      status = `save unavailable: ${deps.error ?? 'no session'}`;
      emit();
      return;
    }
    const display = vehicleDisplayName(id, next);
    deps.session.commit({ kind: 'authored', id, doc: next }, `${display}: ${label}`);
    status = `${display}: ${label}`;
    bump();
  };
  const apply = (next: VehicleDoc, label: string) => { if (activeId) author(activeId, next, label); };

  const newVehicle = () => {
    if (!deps.session) {
      status = `save unavailable: ${deps.error ?? 'no session'}`;
      emit();
      return;
    }
    syncState();
    const doc = generateVehicle(seed());
    const id = freshId(state, doc);
    author(id, doc, 'authored');
    activeId = id;
    twigWrite('activeId', id);
    view.selectedPart = 'gas_tank';
    twigWrite('selectedPart', view.selectedPart);
    view.pose = 'parked';
    twigWrite('pose', view.pose);
    frame = 0;
    view.running = false;
    twigWrite('running', false);
    status = `${vehicleDisplayName(id, doc)}: authored`;
    emit();
  };

  const removeActive = () => {
    if (!deps.session || !deps.channel || !activeId) return;
    const removed = activeId;
    const removedName = vehicleDisplayName(removed, state.vehicles[removed]);
    deps.session.commit({ kind: 'removed', id: removed }, `${removedName}: deleted`);
    syncState();
    activeId = state.order[state.order.length - 1] ?? null;
    twigWrite('activeId', activeId);
    status = `${removedName}: deleted`;
    emit();
  };

  const pick = (id: string) => {
    if (!state.vehicles[id]) return;
    activeId = id;
    twigWrite('activeId', id);
    view.selectedPart = 'gas_tank';
    twigWrite('selectedPart', view.selectedPart);
    status = `loaded ${vehicleDisplayName(id, state.vehicles[id])}`;
    emit();
  };

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

  {
    syncState();
    if (!activeId || !state.vehicles[activeId]) {
      activeId = state.order[state.order.length - 1] ?? null;
      twigWrite('activeId', activeId);
    }
  }

  return {
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
    get state() { return state; },
    get activeId() { return activeId; },
    get doc() { return currentDoc(); },
    get view() { return view; },
    get frame() { return frame; },
    get status() { return status; },
    get rev() { return rev; },
    get sessionError() { return deps.error; },
    selectedDamage,
    tickFrame() {
      if (!view.running) return;
      frame += 1;
      emit();
    },
    setStatus(s: string | null) { status = s; emit(); },
    listRows() {
      syncState();
      return state.order.map((id) => ({ id, label: vehicleDisplayName(id, state.vehicles[id]), icon: 'Car' }));
    },
    defaultRow(rows: Array<{ id: string }>) {
      if (activeId && rows.some((r) => r.id === activeId)) return activeId;
      return rows[rows.length - 1]?.id;
    },
    pick,
    newVehicle,
    removeActive,
    saveActive() {
      const doc = currentDoc();
      if (!doc || !activeId) return;
      author(activeId, doc, 'saved');
    },
    reroll() { apply(generateVehicle(seed()), 'reroll'); },
    repaint() {
      const doc = currentDoc();
      if (doc) apply(repaint(doc, seed()), 'repaint');
    },
    setVehicleType(style: keyof typeof GAME_VEHICLE.tables.styles) {
      const doc = currentDoc();
      if (doc) apply(editStyle(doc, style), `vehicle -> ${GAME_VEHICLE.tables.styles[style].label}`);
    },
    setRole(role: keyof typeof GAME_VEHICLE.tables.roles) {
      const doc = currentDoc();
      if (doc) apply(editService(doc, role), `service -> ${GAME_VEHICLE.tables.roles[role].label}`);
    },
    setGasSide(side: -1 | 1) {
      const doc = currentDoc();
      if (doc) apply(editGasSide(doc, side), side < 0 ? 'gas -> driver side' : 'gas -> passenger side');
    },
    setGasZ(v: number) {
      const doc = currentDoc();
      if (doc) apply(setGasZ(doc, v), `gas z -> ${v.toFixed(2)}`);
    },
    gasZSpec() {
      const doc = currentDoc();
      return gasZKnobSpec(doc?.style ?? 'sedan');
    },
    setSelectedPart(part: VehiclePartId | null) {
      view.selectedPart = part;
      twigWrite('selectedPart', part);
      emit();
    },
    repairSelected() {
      const doc = currentDoc();
      if (!doc) return;
      if (view.selectedPart) apply(setPartDamage(doc, view.selectedPart, 0), `repaired ${view.selectedPart}`);
      else apply(repairAll(doc), 'repaired all');
    },
    damageSelected() {
      const doc = currentDoc();
      if (doc && view.selectedPart) apply(nudgeDamage(doc, view.selectedPart, 1), `damaged ${view.selectedPart}`);
    },
    wreck() {
      const doc = currentDoc();
      if (doc) apply(wreck(doc, seed()), 'wrecked');
    },
    setDamage(level: DamageLevel) {
      const doc = currentDoc();
      if (doc && view.selectedPart) apply(setPartDamage(doc, view.selectedPart, level), `${view.selectedPart} -> ${GAME_VEHICLE.tables.damageLabels[level]}`);
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
