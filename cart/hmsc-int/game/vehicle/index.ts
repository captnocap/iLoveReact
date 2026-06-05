// game/vehicle/ - GAME_VEHICLE: VehicleDoc + buildVehicle + semantic parts.
//
// Captured 2026-06-05 from cart/vehicle_lab as the V10 vehicle module. The lab
// remains the behavior reference; this file is the game-facing, React-free
// rewrite. Authoring UI is deliberately not here.

export type V3 = [number, number, number];

export type VehicleStyleId =
  | 'sedan'
  | 'coupe'
  | 'wagon'
  | 'van'
  | 'pickup'
  | 'sports'
  | 'ambulance'
  | 'fire_truck';

export type VehicleRoleId = 'civilian' | 'police' | 'medical' | 'fire';
export type VehiclePoseId = 'parked' | 'roll' | 'turn' | 'bounce' | 'brake';
export type DamageLevel = 0 | 1 | 2 | 3;

export type VehiclePartId =
  | 'body'
  | 'cabin'
  | 'trunk'
  | 'bumper'
  | 'windshield'
  | 'driver_side'
  | 'passenger_side'
  | 'rear'
  | 'front_lights'
  | 'rear_lights'
  | 'driver_door'
  | 'passenger_door'
  | 'hood'
  | 'front_left_wheel'
  | 'front_right_wheel'
  | 'rear_left_wheel'
  | 'rear_right_wheel'
  | 'gas_tank';

export type VehicleMeshKind = 'box' | 'cylinder' | 'sphere';

export type VehicleMaterial = string | {
  color: string;
  opacity?: number;
  breakable?: boolean;
  health?: number;
};

export type VehicleMesh = {
  id: VehiclePartId;
  label: string;
  kind: VehicleMeshKind;
  params?: Record<string, number>;
  position: V3;
  rotation?: V3;
  scale: V3;
  material: VehicleMaterial;
};

export type VehicleHitbox = {
  id: VehiclePartId;
  label: string;
  position: V3;
  rotation?: V3;
  size: V3;
  damage: DamageLevel;
  critical?: boolean;
};

export type VehicleAnchorId = 'driverSeat' | 'passengerSeat' | 'hoodLatch' | 'gasPort' | 'towRear';
export type VehicleAnchors = Record<VehicleAnchorId, V3>;

export type VehicleDoc = {
  style: VehicleStyleId;
  role: VehicleRoleId;
  seed: number;
  color: string;
  trim: string;
  gasSide: -1 | 1;
  gasZ: number;
  damage: Partial<Record<VehiclePartId, DamageLevel>>;
};

export type VehicleBuild = {
  meshes: VehicleMesh[];
  hitboxes: VehicleHitbox[];
  anchors: VehicleAnchors;
};

export type VehicleAction = {
  target: string;
  action: string;
  phase: number;
  weight: number;
  args?: readonly string[];
};

export type VehicleStyleDefinition = {
  label: string;
  length: number;
  width: number;
  bodyH: number;
  cabinH: number;
  cabinZ: number;
  cabinD: number;
  wheelR: number;
  clearance: number;
};

export type VehicleRoleDefinition = {
  label: string;
  color: string;
  trim: string;
  styles: readonly VehicleStyleId[];
};

export type VehiclePoseDefinition = {
  label: string;
  dsl: string;
};

export const VEHICLE_PART_IDS = [
  'body',
  'cabin',
  'trunk',
  'bumper',
  'windshield',
  'driver_side',
  'passenger_side',
  'rear',
  'front_lights',
  'rear_lights',
  'driver_door',
  'passenger_door',
  'hood',
  'front_left_wheel',
  'front_right_wheel',
  'rear_left_wheel',
  'rear_right_wheel',
  'gas_tank',
] as const satisfies readonly VehiclePartId[];

export const VEHICLE_STYLES = Object.freeze({
  sedan: { label: 'sedan', length: 4.25, width: 1.82, bodyH: 0.62, cabinH: 0.54, cabinZ: 0.08, cabinD: 1.78, wheelR: 0.39, clearance: 0.31 },
  coupe: { label: 'coupe', length: 4.05, width: 1.78, bodyH: 0.56, cabinH: 0.48, cabinZ: -0.12, cabinD: 1.45, wheelR: 0.4, clearance: 0.3 },
  wagon: { label: 'wagon', length: 4.65, width: 1.88, bodyH: 0.68, cabinH: 0.62, cabinZ: 0.22, cabinD: 2.35, wheelR: 0.4, clearance: 0.32 },
  van: { label: 'van', length: 4.8, width: 2.05, bodyH: 0.92, cabinH: 0.86, cabinZ: 0.08, cabinD: 2.72, wheelR: 0.41, clearance: 0.34 },
  pickup: { label: 'pickup', length: 4.85, width: 1.96, bodyH: 0.7, cabinH: 0.58, cabinZ: -0.72, cabinD: 1.5, wheelR: 0.43, clearance: 0.37 },
  sports: { label: 'sports', length: 4, width: 1.9, bodyH: 0.48, cabinH: 0.4, cabinZ: -0.24, cabinD: 1.32, wheelR: 0.4, clearance: 0.25 },
  ambulance: { label: 'ambulance', length: 5.9, width: 2.22, bodyH: 0.78, cabinH: 0.9, cabinZ: -1.92, cabinD: 1.78, wheelR: 0.44, clearance: 0.37 },
  fire_truck: { label: 'fire truck', length: 7.25, width: 2.42, bodyH: 0.82, cabinH: 1.08, cabinZ: -2.46, cabinD: 2.22, wheelR: 0.5, clearance: 0.43 },
} satisfies Record<VehicleStyleId, VehicleStyleDefinition>);

export const VEHICLE_ROLES = Object.freeze({
  civilian: { label: 'civilian', color: '#2f6fb0', trim: '#171a1f', styles: ['sedan', 'coupe', 'wagon', 'van', 'pickup', 'sports'] },
  police: { label: 'police', color: '#f8fafc', trim: '#111827', styles: ['sedan', 'wagon', 'sports'] },
  medical: { label: 'medical', color: '#f8fafc', trim: '#b91c1c', styles: ['ambulance', 'van'] },
  fire: { label: 'fire', color: '#b91c1c', trim: '#facc15', styles: ['fire_truck', 'pickup'] },
} satisfies Record<VehicleRoleId, VehicleRoleDefinition>);

export const VEHICLE_POSES = Object.freeze({
  parked: { label: 'parked', dsl: '[1,vehicle,parked]' },
  roll: { label: 'roll', dsl: '[0.8,wheels,spin_loop;0.8,vehicle,drive_loop]' },
  turn: { label: 'turn', dsl: '[0.8,wheels,spin_loop;0.8,front_wheels,steer_loop;0.8,vehicle,drive_loop]' },
  bounce: { label: 'bounce', dsl: '[0.7,suspension,bounce_loop]' },
  brake: { label: 'brake', dsl: '[0.8,vehicle,brake]' },
} satisfies Record<VehiclePoseId, VehiclePoseDefinition>);

export const VEHICLE_PART_LABELS = Object.freeze({
  body: 'Body shell',
  cabin: 'Cabin volume',
  trunk: 'Trunk / cargo',
  bumper: 'Bumpers',
  windshield: 'Windshield',
  driver_side: 'Driver side glass',
  passenger_side: 'Passenger side glass',
  rear: 'Rear glass / hatch',
  front_lights: 'Front lights',
  rear_lights: 'Rear lights',
  driver_door: 'Driver door',
  passenger_door: 'Passenger door',
  hood: 'Engine hood',
  front_left_wheel: 'Front left wheel',
  front_right_wheel: 'Front right wheel',
  rear_left_wheel: 'Rear left wheel',
  rear_right_wheel: 'Rear right wheel',
  gas_tank: 'Gas tank',
} satisfies Record<VehiclePartId, string>);

export const VEHICLE_DAMAGE_LABELS = Object.freeze({
  0: 'clean',
  1: 'scuffed',
  2: 'dented',
  3: 'broken',
} satisfies Record<DamageLevel, string>);

export const VEHICLE_RANDOM_TABLES = Object.freeze({
  colors: ['#b5403a', '#2f6fb0', '#d8d2c4', '#3b3f45', '#6f8f5a', '#c9952f', '#8a8f96', '#2b2e33', '#7a4f86', '#0f766e'],
  trims: ['#171a1f', '#23272f', '#111827', '#3b2f25', '#263238'],
  rolePool: ['civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'police', 'medical', 'fire'],
  rearBiasByStyle: {
    sedan: 0.34,
    coupe: 0.34,
    wagon: 0.45,
    van: 0.45,
    pickup: 0.64,
    sports: 0.34,
    ambulance: 0.34,
    fire_truck: 0.34,
  },
  gasZ: {
    halfLengthScale: 0.5,
    randomSpread: 0.18,
    randomCenter: 0.09,
  },
} satisfies {
  colors: readonly string[];
  trims: readonly string[];
  rolePool: readonly VehicleRoleId[];
  rearBiasByStyle: Record<VehicleStyleId, number>;
  gasZ: { halfLengthScale: number; randomSpread: number; randomCenter: number };
});

export const VEHICLE_MESH_PARAMS = Object.freeze({
  box: { width: 1, height: 1, depth: 1 },
  gasPort: { radius: 0.5, height: 1, segments: 18 },
  fireTruckHose: { radius: 0.5, height: 1.35, segments: 18 },
  wheelSegments: {
    normal: 20,
    damaged: 12,
    hub: 18,
  },
} as const);

export const VEHICLE_MATERIALS = Object.freeze({
  autoGlass: { color: '#222c33', opacity: 0.48, breakable: true, health: 20 },
  sideGlass: { color: '#1f3441', opacity: 0.42, breakable: true, health: 18 },
  headlight: { color: '#fff4c7', opacity: 0.88, breakable: true, health: 8 },
  taillight: { color: '#a51f2b', opacity: 0.9, breakable: true, health: 8 },
  gasPort: { color: '#eab308', opacity: 0.9, breakable: true, health: 12 },
  brokenGasPort: { color: '#ef4444', opacity: 0.95, breakable: true, health: 0 },
  damagedGasPort: { color: '#f97316', opacity: 0.92, breakable: true, health: 4 },
  damagedHeadlight: { color: '#ffe8a3', opacity: 0.35, breakable: true, health: 2 },
  damagedTaillight: { color: '#7f1d1d', opacity: 0.48, breakable: true, health: 2 },
  lightbarRed: { color: '#ef4444', opacity: 0.9, breakable: true, health: 6 },
  lightbarBlue: { color: '#2563eb', opacity: 0.9, breakable: true, health: 6 },
  lightbarWhite: { color: '#f8fafc', opacity: 0.88, breakable: true, health: 6 },
  fireLightbarYellow: { color: '#facc15', opacity: 0.9, breakable: true, health: 6 },
  brokenGlass: { color: '#94a3b8', opacity: 0.16, breakable: true, health: 0 },
  dentedGlass: { color: '#94b8cc', opacity: 0.28, breakable: true, health: 4 },
  scuffedGlass: { color: '#9fc5da', opacity: 0.38, breakable: true, health: 10 },
} satisfies Record<string, VehicleMaterial>);

export const VEHICLE_TUNING = Object.freeze({
  action: {
    spinDegreesPerPhase: 720,
    steerDegrees: 24,
    suspensionBounceMeters: 0.045,
    driveBounceMeters: 0.012,
    brakeNoseDegrees: -3,
  },
  damageShade: {
    0: 1,
    1: 0.82,
    2: 0.62,
    3: 0.38,
  },
  shell: {
    serviceCabinBodyOffset: 0.12,
    standardCabinBodyOffset: 0.52,
    serviceCabinHeightScale: 0.5,
    standardCabinHeightScale: 0.44,
    serviceCabinFrontInset: 0.2,
    serviceModuleFrontGap: 0.04,
    fireModuleFrontGap: 0.14,
    serviceModuleRearInset: 0.22,
    minModuleDepth: 0.8,
    ambulanceModuleH: 1.48,
    fireModuleH: 1.28,
  },
  doors: {
    fireCabinZOffset: 0.1,
    serviceCabinZOffset: -0.04,
    pickupDoorZOffset: -0.1,
    serviceFireDepthScale: 0.48,
    serviceDepthScale: 0.42,
    pickupDepth: 1.1,
    standardDepthScale: 0.31,
    serviceFireHeightScale: 0.76,
    serviceHeightScale: 0.68,
    standardHeightScale: 0.72,
    serviceYBodyScale: 0.05,
    standardYBodyScale: 0.08,
  },
  hitboxes: {
    proudScale: 1.04,
  },
} as const);

function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rand() * xs.length))];
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function makeVehicle(seed: number): VehicleDoc {
  const rand = seededRandom(seed);
  const role = pick(rand, VEHICLE_RANDOM_TABLES.rolePool);
  const rolePreset = VEHICLE_ROLES[role];
  const style = pick(rand, rolePreset.styles);
  const dims = VEHICLE_STYLES[style];
  const side: -1 | 1 = rand() < 0.5 ? -1 : 1;
  const civilian = role === 'civilian';
  const gas = VEHICLE_RANDOM_TABLES.gasZ;
  const rearBias = VEHICLE_RANDOM_TABLES.rearBiasByStyle[style];
  return {
    style,
    role,
    seed,
    color: civilian ? pick(rand, VEHICLE_RANDOM_TABLES.colors) : rolePreset.color,
    trim: civilian ? pick(rand, VEHICLE_RANDOM_TABLES.trims) : rolePreset.trim,
    gasSide: side,
    gasZ: dims.length * (rearBias + rand() * gas.randomSpread - gas.randomCenter) * gas.halfLengthScale,
    damage: {},
  };
}

export function damageOf(doc: VehicleDoc, id: VehiclePartId): DamageLevel {
  return doc.damage[id] ?? 0;
}

export function maxDamage(...levels: DamageLevel[]): DamageLevel {
  return Math.max(...levels) as DamageLevel;
}

export function shade(hex: string, k: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * k).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

export function panelMaterial(color: string, damage: DamageLevel): string {
  return shade(color, VEHICLE_TUNING.damageShade[damage]);
}

export function glassMaterial(base: VehicleMaterial, damage: DamageLevel): VehicleMaterial {
  if (damage >= 3) return VEHICLE_MATERIALS.brokenGlass;
  if (damage === 2) return VEHICLE_MATERIALS.dentedGlass;
  if (damage === 1) return VEHICLE_MATERIALS.scuffedGlass;
  return base;
}

export function vehicleMeshKind(kind: VehicleMeshKind): VehicleMeshKind {
  return kind;
}

export function buildVehicle(doc: VehicleDoc, actions: readonly VehicleAction[] = []): VehicleBuild {
  const d = VEHICLE_STYLES[doc.style];
  const meshes: VehicleMesh[] = [];
  const hitboxes: VehicleHitbox[] = [];
  let wheelSpin = 0;
  let steer = 0;
  let bounce = 0;
  let brakeNose = 0;

  for (const action of actions) {
    const wave = Math.sin(action.phase * Math.PI * 2);
    if ((action.target === 'wheels' || action.target === 'front_wheels' || action.target === 'rear_wheels') && action.action === 'spin_loop') {
      wheelSpin += action.phase * VEHICLE_TUNING.action.spinDegreesPerPhase;
    }
    if (action.target === 'front_wheels' && action.action === 'steer_loop') {
      steer += wave * VEHICLE_TUNING.action.steerDegrees;
    }
    if (action.target === 'suspension' && action.action === 'bounce_loop') {
      bounce += wave * VEHICLE_TUNING.action.suspensionBounceMeters;
    }
    if (action.target === 'vehicle' && action.action === 'drive_loop') {
      bounce += wave * VEHICLE_TUNING.action.driveBounceMeters;
    }
    if (action.target === 'vehicle' && action.action === 'brake') {
      brakeNose += action.weight * VEHICLE_TUNING.action.brakeNoseDegrees;
    }
  }

  const groundY = d.wheelR + d.clearance + bounce;
  const halfL = d.length / 2;
  const halfW = d.width / 2;
  const isPickup = doc.style === 'pickup';
  const isVan = doc.style === 'van';
  const isAmbulance = doc.style === 'ambulance';
  const isFireTruck = doc.style === 'fire_truck';
  const isBoxyService = isAmbulance || isFireTruck;
  const cabinY = isBoxyService
    ? groundY + d.bodyH * VEHICLE_TUNING.shell.serviceCabinBodyOffset + d.cabinH * VEHICLE_TUNING.shell.serviceCabinHeightScale
    : groundY + d.bodyH * VEHICLE_TUNING.shell.standardCabinBodyOffset + d.cabinH * VEHICLE_TUNING.shell.standardCabinHeightScale;
  const cabinFront = isBoxyService ? -halfL + VEHICLE_TUNING.shell.serviceCabinFrontInset : d.cabinZ - d.cabinD / 2;
  const cabinRear = isBoxyService ? cabinFront + d.cabinD : d.cabinZ + d.cabinD / 2;
  const cabinZ = (cabinFront + cabinRear) / 2;
  const moduleFront = isBoxyService ? cabinRear + (isFireTruck ? VEHICLE_TUNING.shell.fireModuleFrontGap : VEHICLE_TUNING.shell.serviceModuleFrontGap) : cabinRear;
  const moduleRear = halfL - VEHICLE_TUNING.shell.serviceModuleRearInset;
  const moduleDepth = Math.max(VEHICLE_TUNING.shell.minModuleDepth, moduleRear - moduleFront);
  const moduleZ = moduleFront + moduleDepth * 0.5;
  const moduleH = isFireTruck ? VEHICLE_TUNING.shell.fireModuleH : VEHICLE_TUNING.shell.ambulanceModuleH;
  const moduleY = groundY - d.bodyH * 0.1 + moduleH * 0.5;
  const frontAxle = -halfL + 0.9;
  const rearAxle = halfL - 0.92;
  const doorZ = isBoxyService
    ? cabinZ + (isFireTruck ? VEHICLE_TUNING.doors.fireCabinZOffset : VEHICLE_TUNING.doors.serviceCabinZOffset)
    : (cabinFront + cabinRear) / 2 - (isPickup ? -VEHICLE_TUNING.doors.pickupDoorZOffset : 0);
  const doorDepth = isBoxyService
    ? d.cabinD * (isFireTruck ? VEHICLE_TUNING.doors.serviceFireDepthScale : VEHICLE_TUNING.doors.serviceDepthScale)
    : isPickup ? VEHICLE_TUNING.doors.pickupDepth : d.length * VEHICLE_TUNING.doors.standardDepthScale;
  const doorHeight = isBoxyService
    ? d.cabinH * (isFireTruck ? VEHICLE_TUNING.doors.serviceFireHeightScale : VEHICLE_TUNING.doors.serviceHeightScale)
    : d.bodyH * VEHICLE_TUNING.doors.standardHeightScale;
  const doorY = isBoxyService
    ? groundY + d.bodyH * VEHICLE_TUNING.doors.serviceYBodyScale
    : groundY + d.bodyH * VEHICLE_TUNING.doors.standardYBodyScale;
  const role = doc.role ?? 'civilian';
  const bodyDamage = damageOf(doc, 'body');
  const cabinDamage = maxDamage(damageOf(doc, 'cabin'), bodyDamage);
  const bumperDamage = damageOf(doc, 'bumper');
  const hoodDamage = maxDamage(damageOf(doc, 'hood'), bodyDamage);
  const trunkDamage = maxDamage(damageOf(doc, 'trunk'), bodyDamage);
  const windshieldDamage = maxDamage(damageOf(doc, 'windshield'), cabinDamage);
  const rearGlassDamage = maxDamage(damageOf(doc, 'rear'), trunkDamage);
  const driverSideDamage = maxDamage(damageOf(doc, 'driver_side'), cabinDamage);
  const passengerSideDamage = maxDamage(damageOf(doc, 'passenger_side'), cabinDamage);
  const driverDoorDamage = maxDamage(damageOf(doc, 'driver_door'), bodyDamage);
  const passengerDoorDamage = maxDamage(damageOf(doc, 'passenger_door'), bodyDamage);
  const frontLightsDamage = damageOf(doc, 'front_lights');
  const rearLightsDamage = damageOf(doc, 'rear_lights');
  const gasDamage = damageOf(doc, 'gas_tank');

  const add = (id: VehiclePartId, kind: VehicleMeshKind, position: V3, scale: V3, material: VehicleMaterial, rotation: V3 = [0, 0, 0], params = VEHICLE_MESH_PARAMS.box) => {
    meshes.push({ id, label: VEHICLE_PART_LABELS[id], kind, params, position, scale, material, rotation });
  };
  const box = (id: VehiclePartId, position: V3, size: V3, rotation: V3 = [0, 0, 0], critical = false) => {
    hitboxes.push({ id, label: VEHICLE_PART_LABELS[id], position, rotation, size, damage: damageOf(doc, id), critical });
  };
  const scar = (id: VehiclePartId, level: DamageLevel, position: V3, scale: V3, rotation: V3 = [0, 0, 0]) => {
    if (level <= 0) return;
    add(id, 'box', position, scale, level >= 3 ? '#111827' : '#3a2a20', rotation);
  };
  const crack = (id: VehiclePartId, level: DamageLevel, position: V3, scale: V3, rotation: V3 = [0, 0, 0]) => {
    if (level <= 0) return;
    add(id, 'box', position, scale, level >= 3 ? '#f8fafc' : '#cbd5e1', rotation);
  };
  const sideStripe = (id: VehiclePartId, color: string, y: number, z: number, depth: number, h = 0.11) => {
    add(id, 'box', [-halfW - 0.086, y, z], [0.018, h, depth], color);
    add(id, 'box', [halfW + 0.086, y, z], [0.018, h, depth], color);
  };
  const sideMark = (id: VehiclePartId, color: string, x: number, y: number, z: number, s = 1) => {
    add(id, 'box', [x, y, z], [0.02, 0.16 * s, 0.36 * s], color);
    add(id, 'box', [x + (x < 0 ? -0.004 : 0.004), y, z], [0.022, 0.36 * s, 0.13 * s], color);
  };

  if (isBoxyService) {
    add('body', 'box', [0, groundY - d.bodyH * 0.18, 0], [d.width + 0.12, 0.36, d.length + 0.08], panelMaterial(doc.trim, bodyDamage), [brakeNose, 0, 0]);
    add('body', 'box', [0, groundY + d.bodyH * 0.08, cabinZ], [d.width * 0.96, d.bodyH * 0.64, d.cabinD + 0.08], panelMaterial(doc.color, bodyDamage), [brakeNose, 0, 0]);
    add('body', 'box', [-halfW - 0.08, groundY - d.bodyH * 0.02, moduleZ], [0.12, 0.28, moduleDepth], doc.trim);
    add('body', 'box', [halfW + 0.08, groundY - d.bodyH * 0.02, moduleZ], [0.12, 0.28, moduleDepth], doc.trim);
    add('bumper', 'box', [0, groundY - d.bodyH * 0.04, -halfL - 0.1], [d.width * 1.02, 0.3, 0.18], panelMaterial(doc.trim, bumperDamage));
    add('bumper', 'box', [0, groundY - d.bodyH * 0.06, halfL + 0.08], [d.width, 0.32, 0.18], panelMaterial(doc.trim, bumperDamage));
    add('bumper', 'box', [0, groundY - d.bodyH * 0.18, moduleRear + 0.2], [d.width * 0.82, 0.16, 0.28], '#374151');
    if (isFireTruck) {
      add('hood', 'box', [0, groundY + 0.32, -halfL - 0.015], [d.width * 0.82, 0.78, 0.08], panelMaterial('#991b1b', hoodDamage), [0, 0, 0]);
      add('hood', 'box', [0, groundY + 0.28, -halfL - 0.07], [d.width * 0.58, 0.46, 0.035], '#111827');
      add('hood', 'box', [0, groundY + 0.58, -halfL - 0.09], [d.width * 0.5, 0.05, 0.04], '#e5e7eb');
      add('hood', 'box', [0, groundY + 0.2, -halfL - 0.092], [d.width * 0.5, 0.05, 0.04], '#e5e7eb');
      add('body', 'box', [0, cabinY + d.cabinH * 0.56, cabinZ], [d.width, 0.14, d.cabinD + 0.12], panelMaterial('#7f1d1d', bodyDamage));
      add('body', 'box', [-halfW - 0.12, groundY + 0.08, cabinZ], [0.2, 0.18, d.cabinD * 0.78], '#374151');
      add('body', 'box', [halfW + 0.12, groundY + 0.08, cabinZ], [0.2, 0.18, d.cabinD * 0.78], '#374151');
    } else {
      add('hood', 'box', [0, groundY + d.bodyH * 0.24, -halfL + 0.54], [d.width * 0.76, 0.24, 0.82], panelMaterial(shade(doc.color, 0.9), hoodDamage), [brakeNose - 4, 0, 0]);
      add('hood', 'box', [0, groundY + d.bodyH * 0.08, -halfL + 0.08], [d.width * 0.68, 0.4, 0.12], '#111827');
      add('body', 'box', [0, cabinY + d.cabinH * 0.54, cabinZ - 0.04], [d.width * 0.88, 0.12, d.cabinD * 0.9], panelMaterial('#e5e7eb', bodyDamage));
      add('body', 'box', [-halfW - 0.09, groundY + 0.06, cabinZ], [0.14, 0.16, d.cabinD * 0.8], '#374151');
      add('body', 'box', [halfW + 0.09, groundY + 0.06, cabinZ], [0.14, 0.16, d.cabinD * 0.8], '#374151');
    }
    scar('body', bodyDamage, [-halfW - 0.072, groundY + 0.22, moduleZ - 0.35], [0.018, 0.18 + bodyDamage * 0.04, 0.42 + bodyDamage * 0.08], [0, 0, 8]);
    scar('body', bodyDamage >= 2 ? bodyDamage : 0, [halfW + 0.072, groundY + 0.18, moduleZ + 0.58], [0.018, 0.22, 0.54], [0, 0, -10]);
    scar('hood', hoodDamage, [-d.width * 0.18, isFireTruck ? groundY + 0.46 : groundY + d.bodyH * 0.34, isFireTruck ? -halfL - 0.11 : -halfL + 0.58], [0.36, 0.014, 0.055], [0, 12, 0]);
  } else {
    add('body', 'box', [0, groundY, 0], [d.width, d.bodyH, d.length], panelMaterial(doc.color, bodyDamage), [brakeNose, 0, 0]);
    add('body', 'box', [0, groundY - d.bodyH * 0.28, 0], [d.width + 0.08, 0.16, d.length + 0.08], doc.trim);
    add('bumper', 'box', [0, groundY - d.bodyH * 0.05, -halfL - 0.06], [d.width * 0.96, 0.22, 0.14], panelMaterial(doc.trim, bumperDamage));
    add('bumper', 'box', [0, groundY - d.bodyH * 0.05, halfL + 0.06], [d.width * 0.96, 0.22, 0.14], panelMaterial(doc.trim, bumperDamage));
    add('hood', 'box', [0, groundY + d.bodyH * 0.28, -halfL * 0.62], [d.width * 0.88, 0.08, d.length * 0.28], panelMaterial(shade(doc.color, 0.9), hoodDamage), [brakeNose, 0, 0]);
    scar('body', bodyDamage, [-halfW - 0.052, groundY + d.bodyH * 0.05, -0.3], [0.018, 0.12 + bodyDamage * 0.04, 0.36 + bodyDamage * 0.08], [0, 0, 8]);
    scar('body', bodyDamage >= 2 ? bodyDamage : 0, [halfW + 0.052, groundY + d.bodyH * 0.03, 0.58], [0.018, 0.18, 0.5], [0, 0, -10]);
    scar('hood', hoodDamage, [-d.width * 0.18, groundY + d.bodyH * 0.34, -halfL * 0.64], [0.36, 0.014, 0.055], [0, 12, 0]);
  }
  scar('bumper', bumperDamage, [-d.width * 0.18, groundY - d.bodyH * 0.02, -halfL - 0.145], [0.42, 0.05, 0.018], [0, 0, -8]);
  scar('bumper', bumperDamage >= 2 ? bumperDamage : 0, [d.width * 0.22, groundY - d.bodyH * 0.02, halfL + 0.145], [0.38, 0.05, 0.018], [0, 0, 9]);

  if (isPickup) {
    add('trunk', 'box', [0, groundY + d.bodyH * 0.06, halfL * 0.42], [d.width * 0.92, d.bodyH * 0.42, d.length * 0.36], panelMaterial(shade(doc.color, 0.82), trunkDamage));
  } else if (isBoxyService) {
    add('trunk', 'box', [0, moduleY, moduleZ], [d.width * 0.98, moduleH, moduleDepth], panelMaterial(isFireTruck ? '#991b1b' : '#f8fafc', trunkDamage));
    add('trunk', 'box', [0, moduleY + moduleH * 0.52, moduleZ], [d.width, 0.12, moduleDepth + 0.08], panelMaterial(isFireTruck ? '#7f1d1d' : '#e5e7eb', trunkDamage));
    add('rear', 'box', [0, moduleY, halfL + 0.02], [d.width * 0.86, moduleH * 0.72, 0.05], panelMaterial(isFireTruck ? '#7f1d1d' : '#eef2f7', rearGlassDamage));
    add('rear', 'box', [0, moduleY, halfL + 0.055], [0.045, moduleH * 0.78, 0.055], isFireTruck ? '#facc15' : '#dc2626');
    add('rear', 'box', [0, moduleY + moduleH * 0.06, halfL + 0.06], [d.width * 0.62, 0.045, 0.055], isFireTruck ? '#facc15' : '#dc2626');
    if (isFireTruck) {
      const compartmentZs = [moduleFront + moduleDepth * 0.2, moduleFront + moduleDepth * 0.48, moduleFront + moduleDepth * 0.76];
      for (const z of compartmentZs) {
        add('trunk', 'box', [-halfW - 0.07, moduleY - moduleH * 0.06, z], [0.055, moduleH * 0.58, moduleDepth * 0.18], '#7f1d1d');
        add('trunk', 'box', [halfW + 0.07, moduleY - moduleH * 0.06, z], [0.055, moduleH * 0.58, moduleDepth * 0.18], '#7f1d1d');
        add('trunk', 'box', [-halfW - 0.105, moduleY - moduleH * 0.06, z], [0.02, moduleH * 0.5, moduleDepth * 0.14], '#d1d5db');
        add('trunk', 'box', [halfW + 0.105, moduleY - moduleH * 0.06, z], [0.02, moduleH * 0.5, moduleDepth * 0.14], '#d1d5db');
      }
      add('trunk', 'box', [0, moduleY + moduleH * 0.48, moduleZ + moduleDepth * 0.04], [d.width * 0.72, 0.1, moduleDepth * 0.72], '#111827');
      add('trunk', 'cylinder', [0, moduleY + moduleH * 0.56, moduleZ + moduleDepth * 0.12], [0.46, 0.46, 0.46], '#475569', [90, 0, 90], VEHICLE_MESH_PARAMS.fireTruckHose);
      add('trunk', 'box', [-halfW - 0.13, groundY + 0.05, moduleZ], [0.14, 0.16, moduleDepth * 0.92], '#475569');
      add('trunk', 'box', [halfW + 0.13, groundY + 0.05, moduleZ], [0.14, 0.16, moduleDepth * 0.92], '#475569');
    } else {
      const stripeY = moduleY + moduleH * 0.16;
      add('trunk', 'box', [-halfW - 0.07, stripeY, moduleZ], [0.035, 0.18, moduleDepth * 0.92], '#dc2626');
      add('trunk', 'box', [halfW + 0.07, stripeY, moduleZ], [0.035, 0.18, moduleDepth * 0.92], '#dc2626');
      add('trunk', 'box', [-halfW - 0.09, moduleY - moduleH * 0.08, moduleFront + moduleDepth * 0.24], [0.04, moduleH * 0.46, 0.52], '#e5e7eb');
      add('trunk', 'box', [halfW + 0.09, moduleY - moduleH * 0.08, moduleFront + moduleDepth * 0.24], [0.04, moduleH * 0.46, 0.52], '#e5e7eb');
    }
  } else {
    add('trunk', 'box', [0, groundY + d.bodyH * 0.29, halfL * 0.58], [d.width * 0.86, 0.07, d.length * (isVan ? 0.16 : 0.22)], panelMaterial(shade(doc.color, 0.86), trunkDamage));
  }
  scar('trunk', trunkDamage, [d.width * 0.18, groundY + d.bodyH * 0.35, halfL * 0.62], [0.32, 0.014, 0.055], [0, -12, 0]);

  add('cabin', 'box', [0, cabinY, cabinZ], [d.width * (isBoxyService ? 0.94 : 0.86), d.cabinH, d.cabinD], panelMaterial(shade(doc.color, isBoxyService ? 0.96 : 0.82), cabinDamage));
  add('windshield', 'box', [0, cabinY + d.cabinH * 0.04, cabinFront - 0.035], [d.width * 0.74, d.cabinH * 0.56, 0.06], glassMaterial(VEHICLE_MATERIALS.autoGlass, windshieldDamage), [-12, 0, 0]);
  add('rear', 'box', [0, cabinY + d.cabinH * 0.02, cabinRear + 0.035], [d.width * 0.7, d.cabinH * (isVan || isBoxyService ? 0.72 : 0.5), 0.06], glassMaterial(VEHICLE_MATERIALS.autoGlass, rearGlassDamage), [isVan || isBoxyService ? 0 : 10, 0, 0]);
  add('driver_side', 'box', [-halfW - 0.035, cabinY + d.cabinH * 0.02, cabinZ], [0.06, d.cabinH * 0.52, d.cabinD * (isBoxyService ? 0.48 : 0.72)], glassMaterial(VEHICLE_MATERIALS.sideGlass, driverSideDamage));
  add('passenger_side', 'box', [halfW + 0.035, cabinY + d.cabinH * 0.02, cabinZ], [0.06, d.cabinH * 0.52, d.cabinD * (isBoxyService ? 0.48 : 0.72)], glassMaterial(VEHICLE_MATERIALS.sideGlass, passengerSideDamage));
  crack('windshield', windshieldDamage, [-0.18, cabinY + d.cabinH * 0.1, cabinFront - 0.075], [0.38, 0.012, 0.012], [0, 0, 24]);
  crack('windshield', windshieldDamage >= 2 ? windshieldDamage : 0, [0.1, cabinY + d.cabinH * 0.03, cabinFront - 0.078], [0.012, 0.3, 0.012], [0, 0, -16]);
  crack('rear', rearGlassDamage, [0.16, cabinY + d.cabinH * 0.05, cabinRear + 0.075], [0.32, 0.012, 0.012], [0, 0, -18]);
  crack('driver_side', driverSideDamage, [-halfW - 0.078, cabinY + d.cabinH * 0.04, cabinZ - 0.2], [0.012, 0.22, 0.018], [0, 0, 18]);
  crack('passenger_side', passengerSideDamage, [halfW + 0.078, cabinY + d.cabinH * 0.04, cabinZ + 0.2], [0.012, 0.22, 0.018], [0, 0, -18]);

  add('driver_door', 'box', [-halfW - 0.045, doorY, doorZ], [0.06, doorHeight, doorDepth], panelMaterial(shade(doc.color, 0.94), driverDoorDamage));
  add('passenger_door', 'box', [halfW + 0.045, doorY, doorZ], [0.06, doorHeight, doorDepth], panelMaterial(shade(doc.color, 0.94), passengerDoorDamage));
  scar('driver_door', driverDoorDamage, [-halfW - 0.084, doorY + doorHeight * 0.12, doorZ], [0.018, 0.16 + driverDoorDamage * 0.04, 0.34], [0, 0, -8]);
  scar('passenger_door', passengerDoorDamage, [halfW + 0.084, doorY + doorHeight * 0.06, doorZ], [0.018, 0.14 + passengerDoorDamage * 0.04, 0.36], [0, 0, 8]);

  for (const x of [-0.48, 0.48]) {
    add('front_lights', 'box', [x * d.width, groundY + d.bodyH * 0.12, -halfL - 0.045], [0.34, 0.15, 0.065], frontLightsDamage >= 3 ? '#1f2937' : frontLightsDamage ? VEHICLE_MATERIALS.damagedHeadlight : VEHICLE_MATERIALS.headlight);
    add('rear_lights', 'box', [x * d.width, groundY + d.bodyH * 0.12, halfL + 0.045], [0.32, 0.14, 0.065], rearLightsDamage >= 3 ? '#1f1115' : rearLightsDamage ? VEHICLE_MATERIALS.damagedTaillight : VEHICLE_MATERIALS.taillight);
  }
  crack('front_lights', frontLightsDamage, [0, groundY + d.bodyH * 0.12, -halfL - 0.084], [d.width * 0.48, 0.018, 0.012], [0, 0, 10]);
  crack('rear_lights', rearLightsDamage, [0, groundY + d.bodyH * 0.12, halfL + 0.084], [d.width * 0.46, 0.018, 0.012], [0, 0, -10]);

  const gasX = doc.gasSide * (halfW + 0.055);
  const gasY = groundY + d.bodyH * 0.18;
  add('gas_tank', 'cylinder', [gasX, gasY, doc.gasZ], [0.18, 0.035, 0.18], gasDamage >= 3 ? VEHICLE_MATERIALS.brokenGasPort : gasDamage ? VEHICLE_MATERIALS.damagedGasPort : VEHICLE_MATERIALS.gasPort, [0, 0, 90], VEHICLE_MESH_PARAMS.gasPort);
  scar('gas_tank', gasDamage, [gasX + doc.gasSide * 0.014, gasY, doc.gasZ], [0.012, 0.24, 0.035], [0, 0, 16]);

  const roofY = cabinY + d.cabinH * 0.58;
  const rearRoofY = isBoxyService ? moduleY + moduleH * 0.56 : roofY;
  if (role === 'police') {
    sideStripe('driver_door', '#111827', groundY + d.bodyH * 0.2, doorZ, d.length * 0.55, 0.13);
    add('hood', 'box', [0, groundY + d.bodyH * 0.345, -halfL * 0.62], [d.width * 0.34, 0.016, d.length * 0.18], '#111827');
    add('body', 'box', [0, groundY + d.bodyH * 0.34, halfL * 0.55], [d.width * 0.36, 0.016, d.length * 0.14], '#111827');
    sideMark('driver_door', '#2563eb', -halfW - 0.106, groundY + d.bodyH * 0.24, doorZ, 0.72);
    sideMark('passenger_door', '#2563eb', halfW + 0.106, groundY + d.bodyH * 0.24, doorZ, 0.72);
    add('cabin', 'box', [-0.2, roofY, cabinZ - 0.08], [0.34, 0.09, 0.18], VEHICLE_MATERIALS.lightbarRed);
    add('cabin', 'box', [0.2, roofY, cabinZ - 0.08], [0.34, 0.09, 0.18], VEHICLE_MATERIALS.lightbarBlue);
    add('bumper', 'box', [0, groundY + d.bodyH * 0.03, -halfL - 0.16], [d.width * 0.48, 0.22, 0.05], '#0f172a');
    add('bumper', 'box', [-d.width * 0.22, groundY + d.bodyH * 0.03, -halfL - 0.2], [0.04, 0.28, 0.06], '#0f172a');
    add('bumper', 'box', [d.width * 0.22, groundY + d.bodyH * 0.03, -halfL - 0.2], [0.04, 0.28, 0.06], '#0f172a');
  } else if (role === 'medical') {
    const stripeZ = isAmbulance ? moduleZ : doorZ;
    sideStripe('driver_door', '#dc2626', groundY + d.bodyH * 0.26, stripeZ, d.length * 0.72, 0.16);
    sideMark('driver_door', '#dc2626', -halfW - 0.106, groundY + d.bodyH * 0.42, isAmbulance ? moduleZ : doorZ, isAmbulance ? 1.15 : 0.9);
    sideMark('passenger_door', '#dc2626', halfW + 0.106, groundY + d.bodyH * 0.42, isAmbulance ? moduleZ : doorZ, isAmbulance ? 1.15 : 0.9);
    add('rear', 'box', [0, isAmbulance ? moduleY : cabinY + d.cabinH * 0.02, halfL + 0.082], [0.18, isAmbulance ? 0.62 : 0.42, 0.018], '#dc2626');
    add('rear', 'box', [0, isAmbulance ? moduleY : cabinY + d.cabinH * 0.02, halfL + 0.086], [0.62, 0.18, 0.018], '#dc2626');
    add('cabin', 'box', [0, rearRoofY + 0.035, isAmbulance ? moduleZ : cabinZ], [0.22, 0.08, isAmbulance ? 0.82 : 0.62], '#dc2626');
    add('cabin', 'box', [0, rearRoofY + 0.04, isAmbulance ? moduleZ : cabinZ], [isAmbulance ? 0.82 : 0.62, 0.08, 0.22], '#dc2626');
    add('cabin', 'box', [-0.24, roofY + 0.04, cabinZ - 0.4], [0.2, 0.08, 0.17], VEHICLE_MATERIALS.lightbarRed);
    add('cabin', 'box', [0.24, roofY + 0.04, cabinZ - 0.4], [0.2, 0.08, 0.17], VEHICLE_MATERIALS.lightbarWhite);
    if (isAmbulance) {
      add('trunk', 'box', [-halfW - 0.06, moduleY - 0.02, moduleZ], [0.055, 0.46, moduleDepth * 0.42], '#111827');
      add('trunk', 'box', [halfW + 0.06, moduleY - 0.02, moduleZ], [0.055, 0.46, moduleDepth * 0.42], '#111827');
      add('front_lights', 'box', [-0.42, roofY + 0.05, cabinFront + 0.28], [0.24, 0.09, 0.16], VEHICLE_MATERIALS.lightbarRed);
      add('front_lights', 'box', [0.42, roofY + 0.05, cabinFront + 0.28], [0.24, 0.09, 0.16], VEHICLE_MATERIALS.lightbarBlue);
    }
  } else if (role === 'fire') {
    sideStripe('driver_door', '#facc15', groundY + d.bodyH * 0.26, isFireTruck ? moduleZ : doorZ, d.length * 0.72, 0.14);
    add('hood', 'box', [0, isFireTruck ? groundY + 0.72 : groundY + d.bodyH * 0.35, isFireTruck ? -halfL - 0.112 : -halfL * 0.62], [d.width * 0.72, 0.018, isFireTruck ? 0.07 : d.length * 0.18], '#facc15');
    add('trunk', 'box', [0, isFireTruck ? moduleY + moduleH * 0.22 : groundY + d.bodyH * 0.42, isFireTruck ? moduleZ : halfL * 0.36], [d.width * 0.78, 0.018, isFireTruck ? moduleDepth * 0.84 : d.length * 0.36], '#facc15');
    add('cabin', 'box', [-0.22, roofY, cabinZ - 0.14], [0.22, 0.1, 0.18], VEHICLE_MATERIALS.lightbarRed);
    add('cabin', 'box', [0.22, roofY, cabinZ - 0.14], [0.22, 0.1, 0.18], VEHICLE_MATERIALS.fireLightbarYellow);
    const ladderY = isFireTruck ? rearRoofY + 0.1 : roofY + 0.08;
    const ladderZ = isFireTruck ? moduleZ : cabinZ + 0.18;
    const ladderD = isFireTruck ? moduleDepth * 0.92 : d.cabinD * 0.96;
    add('cabin', 'box', [-0.42, ladderY, ladderZ], [0.055, 0.045, ladderD], '#d1d5db');
    add('cabin', 'box', [0.42, ladderY, ladderZ], [0.055, 0.045, ladderD], '#d1d5db');
    const rungCount = isFireTruck ? 8 : 6;
    for (let i = 0; i < rungCount; i++) {
      const oz = -ladderD * 0.42 + (ladderD * 0.84 * i) / Math.max(1, rungCount - 1);
      add('cabin', 'box', [0, ladderY + 0.012, ladderZ + oz], [0.96, 0.035, 0.05], '#9ca3af');
    }
    if (isFireTruck) {
      add('trunk', 'box', [-halfW - 0.12, moduleY + 0.1, moduleFront + moduleDepth * 0.36], [0.025, 0.54, moduleDepth * 0.2], '#111827');
      add('trunk', 'box', [halfW + 0.12, moduleY + 0.1, moduleFront + moduleDepth * 0.36], [0.025, 0.54, moduleDepth * 0.2], '#111827');
      add('trunk', 'box', [0, moduleY + moduleH * 0.24, moduleFront + moduleDepth * 0.5], [0.72, 0.14, 0.22], '#facc15');
    } else if (isPickup) {
      add('trunk', 'box', [0, groundY + d.bodyH * 0.35, halfL * 0.44], [d.width * 0.62, 0.22, d.length * 0.16], '#7f1d1d');
    }
  }

  const wheelData: Array<[VehiclePartId, number, number, boolean]> = [
    ['front_left_wheel', -halfW - 0.06, frontAxle, true],
    ['front_right_wheel', halfW + 0.06, frontAxle, true],
    ['rear_left_wheel', -halfW - 0.06, rearAxle, false],
    ['rear_right_wheel', halfW + 0.06, rearAxle, false],
  ];
  for (const [id, x, z, front] of wheelData) {
    const side = x < 0 ? -1 : 1;
    const wheelDamage = damageOf(doc, id);
    const wheelR = d.wheelR * (wheelDamage >= 3 ? 0.66 : wheelDamage === 2 ? 0.82 : wheelDamage === 1 ? 0.94 : 1);
    const wheelY = d.wheelR - (d.wheelR - wheelR) * 0.55;
    add(id, 'cylinder', [x, wheelY, z], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, front ? steer : 0, 90], { radius: wheelR, height: 0.24, segments: wheelDamage >= 3 ? VEHICLE_MESH_PARAMS.wheelSegments.damaged : VEHICLE_MESH_PARAMS.wheelSegments.normal });
    add(id, 'cylinder', [x + side * 0.012, wheelY, z], [1, 1, 1], wheelDamage >= 2 ? '#52525b' : '#9ca3af', [wheelSpin, front ? steer : 0, 90], { radius: wheelR * 0.58, height: 0.255, segments: VEHICLE_MESH_PARAMS.wheelSegments.hub });
    const faceX = x + side * 0.15;
    const spokeRotation: V3 = [wheelSpin, front ? steer : 0, 0];
    add(id, 'box', [faceX, wheelY, z], [0.035, wheelR * 1.48, 0.045], wheelDamage >= 2 ? '#71717a' : '#d1d5db', spokeRotation);
    add(id, 'box', [faceX + side * 0.004, wheelY, z], [0.032, 0.045, wheelR * 1.48], '#6b7280', spokeRotation);
    add(id, 'box', [faceX + side * 0.008, wheelY, z], [0.04, wheelR * 0.26, 0.04], '#f8fafc', [wheelSpin + 45, front ? steer : 0, 0]);
    if (wheelDamage >= 2) {
      add(id, 'box', [faceX + side * 0.012, wheelY - wheelR * 0.64, z], [0.05, 0.035, wheelR * 1.05], '#050505', [0, front ? steer : 0, 0]);
    }
    if (isFireTruck && !front) {
      const innerX = x - side * 0.24;
      const tandemZ = z - 0.82;
      add(id, 'cylinder', [innerX, wheelY, z], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.22, segments: wheelDamage >= 3 ? VEHICLE_MESH_PARAMS.wheelSegments.damaged : VEHICLE_MESH_PARAMS.wheelSegments.normal });
      add(id, 'cylinder', [x, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.24, segments: wheelDamage >= 3 ? VEHICLE_MESH_PARAMS.wheelSegments.damaged : VEHICLE_MESH_PARAMS.wheelSegments.normal });
      add(id, 'cylinder', [innerX, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.22, segments: wheelDamage >= 3 ? VEHICLE_MESH_PARAMS.wheelSegments.damaged : VEHICLE_MESH_PARAMS.wheelSegments.normal });
      add(id, 'cylinder', [x + side * 0.012, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 2 ? '#52525b' : '#9ca3af', [wheelSpin, 0, 90], { radius: wheelR * 0.58, height: 0.255, segments: VEHICLE_MESH_PARAMS.wheelSegments.hub });
    }
  }

  const trunkStart = Math.min(halfL - 0.28, cabinRear + 0.04);
  const trunkDepth = Math.max(0.42, halfL - trunkStart);
  const trunkZ = trunkStart + trunkDepth * 0.5;
  box('body', [0, isBoxyService ? groundY - d.bodyH * 0.08 : groundY, 0], [d.width, isBoxyService ? d.bodyH * 0.78 : d.bodyH, d.length]);
  box('cabin', [0, cabinY, cabinZ], [d.width * (isBoxyService ? 0.98 : 0.92), d.cabinH * 1.08, d.cabinD * 1.04]);
  if (isBoxyService) box('trunk', [0, moduleY, moduleZ], [d.width * 0.98, moduleH, moduleDepth]);
  else box('trunk', [0, groundY + d.bodyH * 0.06, trunkZ], [d.width * 0.94, d.bodyH * (isVan ? 0.9 : 0.72), trunkDepth]);
  box('bumper', [0, groundY - d.bodyH * 0.04, -halfL - 0.08], [d.width * 0.96, 0.26, 0.18]);
  box('bumper', [0, groundY - d.bodyH * 0.04, halfL + 0.08], [d.width * 0.96, 0.26, 0.18]);
  box(
    'hood',
    isFireTruck ? [0, groundY + 0.32, -halfL - 0.02] : isAmbulance ? [0, groundY + d.bodyH * 0.24, -halfL + 0.54] : [0, groundY + d.bodyH * 0.3, -halfL * 0.62],
    isFireTruck ? [d.width * 0.86, 0.82, 0.1] : isAmbulance ? [d.width * 0.8, 0.3, 0.86] : [d.width * 0.9, 0.16, d.length * 0.3],
    isFireTruck ? [0, 0, 0] : [brakeNose, 0, 0],
    true,
  );
  box('windshield', [0, cabinY + d.cabinH * 0.04, cabinFront - 0.04], [d.width * 0.78, d.cabinH * 0.6, 0.08], [-12, 0, 0]);
  box('driver_side', [-halfW - 0.06, cabinY, cabinZ], [0.08, d.cabinH * 0.58, d.cabinD * (isBoxyService ? 0.54 : 0.76)]);
  box('passenger_side', [halfW + 0.06, cabinY, cabinZ], [0.08, d.cabinH * 0.58, d.cabinD * (isBoxyService ? 0.54 : 0.76)]);
  box('rear', isBoxyService ? [0, moduleY, halfL + 0.04] : [0, cabinY, cabinRear + 0.04], isBoxyService ? [d.width * 0.86, moduleH * 0.78, 0.08] : [d.width * 0.76, d.cabinH * 0.58, 0.08]);
  box('driver_door', [-halfW - 0.07, doorY, doorZ], [0.1, doorHeight * 1.08, doorDepth * 1.05]);
  box('passenger_door', [halfW + 0.07, doorY, doorZ], [0.1, doorHeight * 1.08, doorDepth * 1.05]);
  box('front_lights', [0, groundY + d.bodyH * 0.12, -halfL - 0.05], [d.width * 0.86, 0.22, 0.12]);
  box('rear_lights', [0, groundY + d.bodyH * 0.12, halfL + 0.05], [d.width * 0.86, 0.2, 0.12]);
  box('gas_tank', [gasX, gasY, doc.gasZ], [0.12, 0.32, 0.32], [0, 0, 0], true);
  for (const [id, x, z, front] of wheelData) {
    box(id, [x, d.wheelR, z], [0.32, d.wheelR * 2.02, d.wheelR * 2.02], [0, front ? steer : 0, 90], true);
  }

  return {
    meshes,
    hitboxes,
    anchors: {
      driverSeat: [-d.width * 0.23, cabinY, cabinZ - 0.14],
      passengerSeat: [d.width * 0.23, cabinY, cabinZ - 0.14],
      hoodLatch: isFireTruck ? [0, groundY + 0.52, -halfL - 0.1] : [0, groundY + d.bodyH * 0.42, -halfL + 0.52],
      gasPort: [gasX, gasY, doc.gasZ],
      towRear: [0, groundY - d.bodyH * 0.18, halfL + 0.1],
    },
  };
}

// The V20 authoring concern (the garage) — defined beside the system like
// world/ and missions/; editors/vehicles/ appends to it, compile/ loads its
// snapshot. Re-exported here so the game door stays the only public surface.
export { vehiclesStream } from './stream';
export type { VehiclesEvent, VehiclesStreamState } from './stream';
import { vehiclesStream } from './stream';

export const GAME_VEHICLE = Object.freeze({
  make: makeVehicle,
  build: buildVehicle,
  damageOf,
  maxDamage,
  shade,
  panelMaterial,
  glassMaterial,
  meshKind: vehicleMeshKind,
  stream: vehiclesStream,
  tables: Object.freeze({
    parts: VEHICLE_PART_IDS,
    labels: VEHICLE_PART_LABELS,
    styles: VEHICLE_STYLES,
    roles: VEHICLE_ROLES,
    poses: VEHICLE_POSES,
    damageLabels: VEHICLE_DAMAGE_LABELS,
    random: VEHICLE_RANDOM_TABLES,
    materials: VEHICLE_MATERIALS,
    meshParams: VEHICLE_MESH_PARAMS,
    tuning: VEHICLE_TUNING,
  }),
});
