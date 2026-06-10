// vehicle_lab — Head Lab style semantics for cars.
//
// Vehicles use normal 3D primitives instead of sculpted parts: body panels,
// glass panes, lights, doors, hood, wheels, and a generated gas-tank target.
// The important product is the part contract: every visual panel has a matching
// hitbox id that can later become HMSC damage/collision/gameplay data.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, Text } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { OrbitCamera } from '@reactjit/cameras';
import { parseAnimationDsl, sampleAnimationTimeline, type SampledAction } from '../animationDsl';
import { AutoGlass, Glass } from '../hmsc-int/render3d/materials';

const BG = '#0a1019';
const INK = '#e8eef8';
const DIM = '#8092aa';
const GOOD = '#34d399';
const ACCENT = '#38bdf8';

type V3 = [number, number, number];
// Exported: pathing_lab (and any traffic cart) consumes the part contract —
// makeVehicle/buildVehicle/VEHICLE_STYLES + these types are the public kit.
export type VehicleStyleId = 'sedan' | 'coupe' | 'wagon' | 'van' | 'pickup' | 'sports' | 'ambulance' | 'fire_truck';
export type VehicleRoleId = 'civilian' | 'police' | 'medical' | 'fire';
type VehiclePoseId = 'parked' | 'roll' | 'turn' | 'bounce' | 'brake';
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

type MeshKind = 'box' | 'cylinder' | 'sphere';
export type VehicleMesh = {
  id: VehiclePartId;
  label: string;
  kind: MeshKind;
  params?: any;
  position: V3;
  rotation?: V3;
  scale: V3;
  material: string | { color: string; opacity?: number; breakable?: boolean; health?: number };
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
type VehicleAnchors = {
  driverSeat: V3;
  passengerSeat: V3;
  hoodLatch: V3;
  gasPort: V3;
  towRear: V3;
};
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

export const VEHICLE_STYLES: Record<VehicleStyleId, { label: string; length: number; width: number; bodyH: number; cabinH: number; cabinZ: number; cabinD: number; wheelR: number; clearance: number }> = {
  sedan: { label: 'sedan', length: 4.25, width: 1.82, bodyH: 0.62, cabinH: 0.54, cabinZ: 0.08, cabinD: 1.78, wheelR: 0.39, clearance: 0.31 },
  coupe: { label: 'coupe', length: 4.05, width: 1.78, bodyH: 0.56, cabinH: 0.48, cabinZ: -0.12, cabinD: 1.45, wheelR: 0.4, clearance: 0.3 },
  wagon: { label: 'wagon', length: 4.65, width: 1.88, bodyH: 0.68, cabinH: 0.62, cabinZ: 0.22, cabinD: 2.35, wheelR: 0.4, clearance: 0.32 },
  van: { label: 'van', length: 4.8, width: 2.05, bodyH: 0.92, cabinH: 0.86, cabinZ: 0.08, cabinD: 2.72, wheelR: 0.41, clearance: 0.34 },
  pickup: { label: 'pickup', length: 4.85, width: 1.96, bodyH: 0.7, cabinH: 0.58, cabinZ: -0.72, cabinD: 1.5, wheelR: 0.43, clearance: 0.37 },
  sports: { label: 'sports', length: 4.0, width: 1.9, bodyH: 0.48, cabinH: 0.4, cabinZ: -0.24, cabinD: 1.32, wheelR: 0.4, clearance: 0.25 },
  ambulance: { label: 'ambulance', length: 5.9, width: 2.22, bodyH: 0.78, cabinH: 0.9, cabinZ: -1.92, cabinD: 1.78, wheelR: 0.44, clearance: 0.37 },
  fire_truck: { label: 'fire truck', length: 7.25, width: 2.42, bodyH: 0.82, cabinH: 1.08, cabinZ: -2.46, cabinD: 2.22, wheelR: 0.5, clearance: 0.43 },
};

export const VEHICLE_ROLES: Record<VehicleRoleId, { label: string; color: string; trim: string; styles: VehicleStyleId[] }> = {
  civilian: { label: 'civilian', color: '#2f6fb0', trim: '#171a1f', styles: ['sedan', 'coupe', 'wagon', 'van', 'pickup', 'sports'] },
  police: { label: 'police', color: '#f8fafc', trim: '#111827', styles: ['sedan', 'wagon', 'sports'] },
  medical: { label: 'medical', color: '#f8fafc', trim: '#b91c1c', styles: ['ambulance', 'van'] },
  fire: { label: 'fire', color: '#b91c1c', trim: '#facc15', styles: ['fire_truck', 'pickup'] },
};

const VEHICLE_POSES: Record<VehiclePoseId, { label: string; dsl: string }> = {
  parked: { label: 'parked', dsl: '[1,vehicle,parked]' },
  roll: { label: 'roll', dsl: '[0.8,wheels,spin_loop;0.8,vehicle,drive_loop]' },
  turn: { label: 'turn', dsl: '[0.8,wheels,spin_loop;0.8,front_wheels,steer_loop;0.8,vehicle,drive_loop]' },
  bounce: { label: 'bounce', dsl: '[0.7,suspension,bounce_loop]' },
  brake: { label: 'brake', dsl: '[0.8,vehicle,brake]' },
};

const PART_LABELS: Record<VehiclePartId, string> = {
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
};

const COLORS = ['#b5403a', '#2f6fb0', '#d8d2c4', '#3b3f45', '#6f8f5a', '#c9952f', '#8a8f96', '#2b2e33', '#7a4f86', '#0f766e'];
const TRIMS = ['#171a1f', '#23272f', '#111827', '#3b2f25', '#263238'];
const ROLE_POOL: VehicleRoleId[] = ['civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'police', 'medical', 'fire'];
const BOX = { width: 1, height: 1, depth: 1 };
const PORT_PARAMS = { radius: 0.5, height: 1, segments: 18 };
const GLASS = AutoGlass({ opacity: 0.48 });
const SIDE_GLASS = Glass({ color: '#1f3441', opacity: 0.42, health: 18 });
const HEADLIGHT = { color: '#fff4c7', opacity: 0.88, breakable: true, health: 8 };
const TAILLIGHT = { color: '#a51f2b', opacity: 0.9, breakable: true, health: 8 };
const GAS_PORT = { color: '#eab308', opacity: 0.9, breakable: true, health: 12 };
const DAMAGE_LABELS: Record<DamageLevel, string> = {
  0: 'clean',
  1: 'scuffed',
  2: 'dented',
  3: 'broken',
};

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

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function makeVehicle(seed: number): VehicleDoc {
  const rand = seededRandom(seed);
  const role = pick(rand, ROLE_POOL);
  const rolePreset = VEHICLE_ROLES[role];
  const style = pick(rand, rolePreset.styles);
  const dims = VEHICLE_STYLES[style];
  const side: -1 | 1 = rand() < 0.5 ? -1 : 1;
  const rearBias = style === 'pickup' ? 0.64 : style === 'van' || style === 'wagon' ? 0.45 : 0.34;
  const civilian = role === 'civilian';
  return {
    style,
    role,
    seed,
    color: civilian ? pick(rand, COLORS) : rolePreset.color,
    trim: civilian ? pick(rand, TRIMS) : rolePreset.trim,
    gasSide: side,
    gasZ: dims.length * (rearBias + rand() * 0.18 - 0.09) * 0.5,
    damage: {},
  };
}

export function geometryFor(kind: MeshKind) {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

function damageOf(doc: VehicleDoc, id: VehiclePartId): DamageLevel {
  return doc.damage[id] ?? 0;
}

function maxDamage(...levels: DamageLevel[]): DamageLevel {
  return Math.max(...levels) as DamageLevel;
}

function panelMaterial(color: string, damage: DamageLevel): string {
  if (damage >= 3) return shade(color, 0.38);
  if (damage === 2) return shade(color, 0.62);
  if (damage === 1) return shade(color, 0.82);
  return color;
}

function glassMaterial(base: VehicleMesh['material'], damage: DamageLevel): VehicleMesh['material'] {
  if (damage >= 3) return { color: '#94a3b8', opacity: 0.16, breakable: true, health: 0 };
  if (damage === 2) return { color: '#94b8cc', opacity: 0.28, breakable: true, health: 4 };
  if (damage === 1) return { color: '#9fc5da', opacity: 0.38, breakable: true, health: 10 };
  return base;
}

export function buildVehicle(doc: VehicleDoc, actions: readonly SampledAction[]): VehicleBuild {
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
      wheelSpin += action.phase * 720;
    }
    if (action.target === 'front_wheels' && action.action === 'steer_loop') {
      steer += wave * 24;
    }
    if (action.target === 'suspension' && action.action === 'bounce_loop') {
      bounce += wave * 0.045;
    }
    if (action.target === 'vehicle' && action.action === 'drive_loop') {
      bounce += wave * 0.012;
    }
    if (action.target === 'vehicle' && action.action === 'brake') {
      brakeNose += action.weight * -3;
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
  const cabinY = isBoxyService ? groundY + d.bodyH * 0.12 + d.cabinH * 0.5 : groundY + d.bodyH * 0.52 + d.cabinH * 0.44;
  const cabinFront = isBoxyService ? -halfL + 0.2 : d.cabinZ - d.cabinD / 2;
  const cabinRear = isBoxyService ? cabinFront + d.cabinD : d.cabinZ + d.cabinD / 2;
  const cabinZ = (cabinFront + cabinRear) / 2;
  const moduleFront = isBoxyService ? cabinRear + (isFireTruck ? 0.14 : 0.04) : cabinRear;
  const moduleRear = halfL - 0.22;
  const moduleDepth = Math.max(0.8, moduleRear - moduleFront);
  const moduleZ = moduleFront + moduleDepth * 0.5;
  const moduleH = isFireTruck ? 1.28 : 1.48;
  const moduleY = groundY - d.bodyH * 0.1 + moduleH * 0.5;
  const frontAxle = -halfL + 0.9;
  const rearAxle = halfL - 0.92;
  const doorZ = isBoxyService ? cabinZ + (isFireTruck ? 0.1 : -0.04) : (cabinFront + cabinRear) / 2 - (doc.style === 'pickup' ? 0.1 : 0);
  const doorDepth = isBoxyService ? d.cabinD * (isFireTruck ? 0.48 : 0.42) : isPickup ? 1.1 : d.length * 0.31;
  const doorHeight = isBoxyService ? d.cabinH * (isFireTruck ? 0.76 : 0.68) : d.bodyH * 0.72;
  const doorY = isBoxyService ? groundY + d.bodyH * 0.05 : groundY + d.bodyH * 0.08;
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

  const add = (id: VehiclePartId, kind: MeshKind, position: V3, scale: V3, material: VehicleMesh['material'], rotation: V3 = [0, 0, 0], params = BOX) => {
    meshes.push({ id, label: PART_LABELS[id], kind, params, position, scale, material, rotation });
  };
  const box = (id: VehiclePartId, position: V3, size: V3, rotation: V3 = [0, 0, 0], critical = false) => {
    hitboxes.push({ id, label: PART_LABELS[id], position, rotation, size, damage: damageOf(doc, id), critical });
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

  // Solid shell and trim.
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
      add('trunk', 'cylinder', [0, moduleY + moduleH * 0.56, moduleZ + moduleDepth * 0.12], [0.46, 0.46, 0.46], '#475569', [90, 0, 90], { radius: 0.5, height: 1.35, segments: 18 });
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

  // Cabin frame and glass panes. Glass is real object opacity, same convention as HMSC.
  add('cabin', 'box', [0, cabinY, cabinZ], [d.width * (isBoxyService ? 0.94 : 0.86), d.cabinH, d.cabinD], panelMaterial(shade(doc.color, isBoxyService ? 0.96 : 0.82), cabinDamage));
  add('windshield', 'box', [0, cabinY + d.cabinH * 0.04, cabinFront - 0.035], [d.width * 0.74, d.cabinH * 0.56, 0.06], glassMaterial(GLASS, windshieldDamage), [-12, 0, 0]);
  add('rear', 'box', [0, cabinY + d.cabinH * 0.02, cabinRear + 0.035], [d.width * 0.7, d.cabinH * (isVan || isBoxyService ? 0.72 : 0.5), 0.06], glassMaterial(GLASS, rearGlassDamage), [isVan || isBoxyService ? 0 : 10, 0, 0]);
  add('driver_side', 'box', [-halfW - 0.035, cabinY + d.cabinH * 0.02, cabinZ], [0.06, d.cabinH * 0.52, d.cabinD * (isBoxyService ? 0.48 : 0.72)], glassMaterial(SIDE_GLASS, driverSideDamage));
  add('passenger_side', 'box', [halfW + 0.035, cabinY + d.cabinH * 0.02, cabinZ], [0.06, d.cabinH * 0.52, d.cabinD * (isBoxyService ? 0.48 : 0.72)], glassMaterial(SIDE_GLASS, passengerSideDamage));
  crack('windshield', windshieldDamage, [-0.18, cabinY + d.cabinH * 0.1, cabinFront - 0.075], [0.38, 0.012, 0.012], [0, 0, 24]);
  crack('windshield', windshieldDamage >= 2 ? windshieldDamage : 0, [0.1, cabinY + d.cabinH * 0.03, cabinFront - 0.078], [0.012, 0.3, 0.012], [0, 0, -16]);
  crack('rear', rearGlassDamage, [0.16, cabinY + d.cabinH * 0.05, cabinRear + 0.075], [0.32, 0.012, 0.012], [0, 0, -18]);
  crack('driver_side', driverSideDamage, [-halfW - 0.078, cabinY + d.cabinH * 0.04, cabinZ - 0.2], [0.012, 0.22, 0.018], [0, 0, 18]);
  crack('passenger_side', passengerSideDamage, [halfW + 0.078, cabinY + d.cabinH * 0.04, cabinZ + 0.2], [0.012, 0.22, 0.018], [0, 0, -18]);

  // Doors are separate hit/paint surfaces below the side glass.
  add('driver_door', 'box', [-halfW - 0.045, doorY, doorZ], [0.06, doorHeight, doorDepth], panelMaterial(shade(doc.color, 0.94), driverDoorDamage));
  add('passenger_door', 'box', [halfW + 0.045, doorY, doorZ], [0.06, doorHeight, doorDepth], panelMaterial(shade(doc.color, 0.94), passengerDoorDamage));
  scar('driver_door', driverDoorDamage, [-halfW - 0.084, doorY + doorHeight * 0.12, doorZ], [0.018, 0.16 + driverDoorDamage * 0.04, 0.34], [0, 0, -8]);
  scar('passenger_door', passengerDoorDamage, [halfW + 0.084, doorY + doorHeight * 0.06, doorZ], [0.018, 0.14 + passengerDoorDamage * 0.04, 0.36], [0, 0, 8]);

  // Lights.
  for (const x of [-0.48, 0.48]) {
    add('front_lights', 'box', [x * d.width, groundY + d.bodyH * 0.12, -halfL - 0.045], [0.34, 0.15, 0.065], frontLightsDamage >= 3 ? '#1f2937' : frontLightsDamage ? { color: '#ffe8a3', opacity: 0.35, breakable: true, health: 2 } : HEADLIGHT);
    add('rear_lights', 'box', [x * d.width, groundY + d.bodyH * 0.12, halfL + 0.045], [0.32, 0.14, 0.065], rearLightsDamage >= 3 ? '#1f1115' : rearLightsDamage ? { color: '#7f1d1d', opacity: 0.48, breakable: true, health: 2 } : TAILLIGHT);
  }
  crack('front_lights', frontLightsDamage, [0, groundY + d.bodyH * 0.12, -halfL - 0.084], [d.width * 0.48, 0.018, 0.012], [0, 0, 10]);
  crack('rear_lights', rearLightsDamage, [0, groundY + d.bodyH * 0.12, halfL + 0.084], [d.width * 0.46, 0.018, 0.012], [0, 0, -10]);

  // Gas tank/port, unique per generated car.
  const gasX = doc.gasSide * (halfW + 0.055);
  const gasY = groundY + d.bodyH * 0.18;
  add('gas_tank', 'cylinder', [gasX, gasY, doc.gasZ], [0.18, 0.035, 0.18], gasDamage >= 3 ? { color: '#ef4444', opacity: 0.95, breakable: true, health: 0 } : gasDamage ? { color: '#f97316', opacity: 0.92, breakable: true, health: 4 } : GAS_PORT, [0, 0, 90], PORT_PARAMS);
  scar('gas_tank', gasDamage, [gasX + doc.gasSide * 0.014, gasY, doc.gasZ], [0.012, 0.24, 0.035], [0, 0, 16]);

  // Service liveries are geometry decals/equipment on the vehicle rig.
  const roofY = cabinY + d.cabinH * 0.58;
  const rearRoofY = isBoxyService ? moduleY + moduleH * 0.56 : roofY;
  if (role === 'police') {
    sideStripe('driver_door', '#111827', groundY + d.bodyH * 0.2, doorZ, d.length * 0.55, 0.13);
    add('hood', 'box', [0, groundY + d.bodyH * 0.345, -halfL * 0.62], [d.width * 0.34, 0.016, d.length * 0.18], '#111827');
    add('body', 'box', [0, groundY + d.bodyH * 0.34, halfL * 0.55], [d.width * 0.36, 0.016, d.length * 0.14], '#111827');
    sideMark('driver_door', '#2563eb', -halfW - 0.106, groundY + d.bodyH * 0.24, doorZ, 0.72);
    sideMark('passenger_door', '#2563eb', halfW + 0.106, groundY + d.bodyH * 0.24, doorZ, 0.72);
    add('cabin', 'box', [-0.2, roofY, cabinZ - 0.08], [0.34, 0.09, 0.18], { color: '#ef4444', opacity: 0.9, breakable: true, health: 6 });
    add('cabin', 'box', [0.2, roofY, cabinZ - 0.08], [0.34, 0.09, 0.18], { color: '#2563eb', opacity: 0.9, breakable: true, health: 6 });
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
    add('cabin', 'box', [-0.24, roofY + 0.04, cabinZ - 0.4], [0.2, 0.08, 0.17], { color: '#ef4444', opacity: 0.85, breakable: true, health: 6 });
    add('cabin', 'box', [0.24, roofY + 0.04, cabinZ - 0.4], [0.2, 0.08, 0.17], { color: '#f8fafc', opacity: 0.88, breakable: true, health: 6 });
    if (isAmbulance) {
      add('trunk', 'box', [-halfW - 0.06, moduleY - 0.02, moduleZ], [0.055, 0.46, moduleDepth * 0.42], '#111827');
      add('trunk', 'box', [halfW + 0.06, moduleY - 0.02, moduleZ], [0.055, 0.46, moduleDepth * 0.42], '#111827');
      add('front_lights', 'box', [-0.42, roofY + 0.05, cabinFront + 0.28], [0.24, 0.09, 0.16], { color: '#ef4444', opacity: 0.9, breakable: true, health: 6 });
      add('front_lights', 'box', [0.42, roofY + 0.05, cabinFront + 0.28], [0.24, 0.09, 0.16], { color: '#2563eb', opacity: 0.9, breakable: true, health: 6 });
    }
  } else if (role === 'fire') {
    sideStripe('driver_door', '#facc15', groundY + d.bodyH * 0.26, isFireTruck ? moduleZ : doorZ, d.length * 0.72, 0.14);
    add('hood', 'box', [0, isFireTruck ? groundY + 0.72 : groundY + d.bodyH * 0.35, isFireTruck ? -halfL - 0.112 : -halfL * 0.62], [d.width * 0.72, 0.018, isFireTruck ? 0.07 : d.length * 0.18], '#facc15');
    add('trunk', 'box', [0, isFireTruck ? moduleY + moduleH * 0.22 : groundY + d.bodyH * 0.42, isFireTruck ? moduleZ : halfL * 0.36], [d.width * 0.78, 0.018, isFireTruck ? moduleDepth * 0.84 : d.length * 0.36], '#facc15');
    add('cabin', 'box', [-0.22, roofY, cabinZ - 0.14], [0.22, 0.1, 0.18], { color: '#ef4444', opacity: 0.9, breakable: true, health: 6 });
    add('cabin', 'box', [0.22, roofY, cabinZ - 0.14], [0.22, 0.1, 0.18], { color: '#facc15', opacity: 0.9, breakable: true, health: 6 });
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

  // Wheels: cylinder axis is laid along X via Z=90. Front wheels also steer.
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
    add(id, 'cylinder', [x, wheelY, z], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, front ? steer : 0, 90], { radius: wheelR, height: 0.24, segments: wheelDamage >= 3 ? 12 : 20 });
    add(id, 'cylinder', [x + side * 0.012, wheelY, z], [1, 1, 1], wheelDamage >= 2 ? '#52525b' : '#9ca3af', [wheelSpin, front ? steer : 0, 90], { radius: wheelR * 0.58, height: 0.255, segments: 18 });
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
      add(id, 'cylinder', [innerX, wheelY, z], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.22, segments: wheelDamage >= 3 ? 12 : 20 });
      add(id, 'cylinder', [x, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.24, segments: wheelDamage >= 3 ? 12 : 20 });
      add(id, 'cylinder', [innerX, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 3 ? '#07080a' : '#121417', [wheelSpin, 0, 90], { radius: wheelR, height: 0.22, segments: wheelDamage >= 3 ? 12 : 20 });
      add(id, 'cylinder', [x + side * 0.012, wheelY, tandemZ], [1, 1, 1], wheelDamage >= 2 ? '#52525b' : '#9ca3af', [wheelSpin, 0, 90], { radius: wheelR * 0.58, height: 0.255, segments: 18 });
    }
  }

  // Gameplay hitboxes. These are intentionally slightly proud of the surface.
  const trunkStart = Math.min(halfL - 0.28, cabinRear + 0.04);
  const trunkDepth = Math.max(0.42, halfL - trunkStart);
  const trunkZ = trunkStart + trunkDepth * 0.5;
  box('body', [0, isBoxyService ? groundY - d.bodyH * 0.08 : groundY, 0], [d.width, isBoxyService ? d.bodyH * 0.78 : d.bodyH, d.length]);
  box('cabin', [0, cabinY, cabinZ], [d.width * (isBoxyService ? 0.98 : 0.92), d.cabinH * 1.08, d.cabinD * 1.04]);
  if (isBoxyService) {
    box('trunk', [0, moduleY, moduleZ], [d.width * 0.98, moduleH, moduleDepth]);
  } else {
    box('trunk', [0, groundY + d.bodyH * 0.06, trunkZ], [d.width * 0.94, d.bodyH * (isVan ? 0.9 : 0.72), trunkDepth]);
  }
  box('bumper', [0, groundY - d.bodyH * 0.04, -halfL - 0.08], [d.width * 0.96, 0.26, 0.18]);
  box('bumper', [0, groundY - d.bodyH * 0.04, halfL + 0.08], [d.width * 0.96, 0.26, 0.18]);
  box(
    'hood',
    isFireTruck ? [0, groundY + 0.32, -halfL - 0.02] : isAmbulance ? [0, groundY + d.bodyH * 0.24, -halfL + 0.54] : [0, groundY + d.bodyH * 0.3, -halfL * 0.62],
    isFireTruck ? [d.width * 0.86, 0.82, 0.1] : isAmbulance ? [d.width * 0.8, 0.3, 0.86] : [d.width * 0.9, 0.16, d.length * 0.3],
    isFireTruck ? [0, 0, 0] : [brakeNose, 0, 0],
    true
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

function shade(hex: string, k: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const c = (i: number) => Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * k).toString(16).padStart(2, '0');
  return `#${c(0)}${c(1)}${c(2)}`;
}

function Chip(props: { label: string; active: boolean; color?: string; onPress: () => void }) {
  const color = props.color ?? ACCENT;
  return (
    <Pressable
      onPress={props.onPress}
      style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: props.active ? color : '#26364d', backgroundColor: props.active ? '#10263a' : '#101826' }}
    >
      <Text fontSize={12} color={props.active ? color : DIM}>{props.label}</Text>
    </Pressable>
  );
}

function Knob(props: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const btn = { width: 24, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#26364d', backgroundColor: '#101826', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Text fontSize={11} color={DIM} style={{ width: 74 }}>{props.label}</Text>
      <Pressable onPress={props.onMinus} style={btn}><Text fontSize={13} color={INK}>-</Text></Pressable>
      <Text fontSize={12} color={INK} style={{ width: 44, textAlign: 'center' }}>{props.value}</Text>
      <Pressable onPress={props.onPlus} style={btn}><Text fontSize={13} color={INK}>+</Text></Pressable>
    </Row>
  );
}

const VehicleMeshes = memo(function VehicleMeshes(props: { build: VehicleBuild; selected: VehiclePartId | null; showHitboxes: boolean; showAnchors: boolean }) {
  return (
    <>
      {props.build.meshes.map((m, i) => (
        <Scene3D.Mesh
          key={`${m.id}.${i}`}
          geometry={geometryFor(m.kind)}
          params={m.params}
          position={m.position}
          rotation={m.rotation ?? [0, 0, 0]}
          scale={m.scale}
          material={m.material}
        />
      ))}
      {props.selected ? props.build.hitboxes.filter((h) => h.id === props.selected).map((h, i) => (
        <Scene3D.Mesh
          key={`selected-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={BOX}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={[h.size[0] * 1.04, h.size[1] * 1.04, h.size[2] * 1.04]}
          material={{ color: '#f59e0b', opacity: 0.28 }}
        />
      )) : null}
      {props.showHitboxes ? props.build.hitboxes.map((h, i) => (
        <Scene3D.Mesh
          key={`hitbox-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={BOX}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={h.size}
          material={{ color: h.damage >= 3 ? '#ef4444' : h.damage >= 2 ? '#f97316' : h.damage >= 1 ? '#facc15' : h.critical ? '#fb7185' : '#38bdf8', opacity: 0.18 }}
        />
      )) : null}
      {props.showAnchors ? Object.entries(props.build.anchors).map(([id, p]) => (
        <Scene3D.Mesh
          key={`anchor-${id}`}
          geometry={Geometry.Sphere}
          params={{ radius: 0.5, segments: 12, rings: 8 }}
          position={p}
          scale={0.08}
          material={id === 'gasPort' ? '#eab308' : '#34d399'}
        />
      )) : null}
    </>
  );
});

export default function VehicleLab() {
  const [doc, setDoc] = useState<VehicleDoc>(() => makeVehicle(20260604));
  const [pose, setPose] = useState<VehiclePoseId>('parked');
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [showHitboxes, setShowHitboxes] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [selected, setSelected] = useState<VehiclePartId | null>('gas_tank');
  const [yaw, setYaw] = useState(34);
  const [pitch, setPitch] = useState(24);
  const [dist, setDist] = useState(8.2);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFrame((f) => f + 1), 33);
    return () => clearInterval(id);
  }, [running]);

  const seconds = (running ? frame : 0) / 60;
  const animation = VEHICLE_POSES[pose];
  const timeline = useMemo(() => parseAnimationDsl(animation.dsl), [animation.dsl]);
  const sampledActions = useMemo(() => sampleAnimationTimeline(timeline, seconds), [timeline, seconds]);
  const build = useMemo(() => buildVehicle(doc, sampledActions), [doc, sampledActions]);
  const dims = VEHICLE_STYLES[doc.style];
  const currentRole = doc.role ?? 'civilian';
  const hitboxGroups = useMemo(() => {
    const ids: VehiclePartId[] = [];
    for (const h of build.hitboxes) if (!ids.includes(h.id)) ids.push(h.id);
    return ids;
  }, [build.hitboxes]);
  const selectedDamage = selected ? damageOf(doc, selected) : 0;

  const generate = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    setDoc(makeVehicle(seed));
    setSelected('gas_tank');
    setPose('parked');
    setFrame(0);
    setRunning(false);
  };
  const setStyle = (style: VehicleStyleId) => {
    setDoc((cur) => {
      const d = VEHICLE_STYLES[style];
      return {
        ...cur,
        style,
        gasZ: clamp(cur.gasZ, -d.length * 0.16, d.length * 0.42),
      };
    });
  };
  const setRole = (role: VehicleRoleId) => {
    setDoc((cur) => {
      const preset = VEHICLE_ROLES[role];
      const style = preset.styles.includes(cur.style) ? cur.style : preset.styles[0];
      const d = VEHICLE_STYLES[style];
      return {
        ...cur,
        role,
        style,
        color: role === 'civilian' ? cur.color : preset.color,
        trim: role === 'civilian' ? cur.trim : preset.trim,
        gasZ: clamp(cur.gasZ, -d.length * 0.16, d.length * 0.42),
      };
    });
  };
  const moveGas = (dz: number) => {
    setDoc((cur) => {
      const d = VEHICLE_STYLES[cur.style];
      return { ...cur, gasZ: clamp(cur.gasZ + dz, -d.length * 0.22, d.length * 0.45) };
    });
  };
  const randomColor = () => {
    const rand = seededRandom((doc.seed ^ Date.now()) >>> 0);
    setDoc((cur) => ({ ...cur, color: pick(rand, COLORS), trim: pick(rand, TRIMS) }));
  };
  const setPartDamage = (part: VehiclePartId, level: DamageLevel) => {
    setDoc((cur) => {
      const damage = { ...cur.damage };
      if (level <= 0) delete damage[part];
      else damage[part] = level;
      return { ...cur, damage };
    });
  };
  const nudgeSelectedDamage = (delta: number) => {
    if (!selected) return;
    setPartDamage(selected, clamp(selectedDamage + delta, 0, 3) as DamageLevel);
  };
  const randomDamage = () => {
    const rand = seededRandom((doc.seed ^ Date.now() ^ 0xd00d) >>> 0);
    const parts = Object.keys(PART_LABELS) as VehiclePartId[];
    const damage: Partial<Record<VehiclePartId, DamageLevel>> = {};
    for (const part of parts) {
      const roll = rand();
      if (roll > 0.58) damage[part] = (roll > 0.9 ? 3 : roll > 0.74 ? 2 : 1) as DamageLevel;
    }
    setDoc((cur) => ({ ...cur, damage }));
  };
  const orbitDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * 0.38);
    setPitch((v) => clamp(v - (ny - d.y) * 0.3, 5, 82));
    d.x = nx; d.y = ny;
  };
  const orbitUp = () => { dragRef.current = null; };

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      <Col style={{ width: 390, padding: 14, gap: 10 }}>
        <Text fontSize={16} color={INK} style={{ fontWeight: 900 }}>VEHICLE LAB</Text>
        <Text fontSize={11} color={DIM}>
          semantic car panels: glass, doors, hood, lights, wheels, and gas tank hitboxes
        </Text>

        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 56 }}>style</Text>
          {(Object.keys(VEHICLE_STYLES) as VehicleStyleId[]).map((id) => (
            <Chip key={id} label={VEHICLE_STYLES[id].label} active={doc.style === id} color={GOOD} onPress={() => setStyle(id)} />
          ))}
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 56 }}>service</Text>
          {(Object.keys(VEHICLE_ROLES) as VehicleRoleId[]).map((id) => (
            <Chip key={id} label={VEHICLE_ROLES[id].label} active={currentRole === id} color={id === 'police' ? '#38bdf8' : id === 'medical' ? '#ef4444' : id === 'fire' ? '#f97316' : '#94a3b8'} onPress={() => setRole(id)} />
          ))}
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 56 }}>motion</Text>
          {(Object.keys(VEHICLE_POSES) as VehiclePoseId[]).map((id) => (
            <Chip key={id} label={VEHICLE_POSES[id].label} active={pose === id} color="#f97316" onPress={() => { setPose(id); setFrame(0); setRunning(id !== 'parked'); }} />
          ))}
          <Chip label={running ? 'run ■' : 'run'} active={running} color={GOOD} onPress={() => setRunning((v) => !v)} />
        </Row>
        <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text fontSize={11} color={DIM} style={{ width: 56 }}>debug</Text>
          <Chip label="hitboxes" active={showHitboxes} color="#38bdf8" onPress={() => setShowHitboxes((v) => !v)} />
          <Chip label="anchors" active={showAnchors} color="#34d399" onPress={() => setShowAnchors((v) => !v)} />
          <Chip label="generate" active={false} color="#a78bfa" onPress={generate} />
          <Chip label="paint" active={false} color={doc.color} onPress={randomColor} />
        </Row>

        <Col style={{ gap: 6, paddingTop: 4 }}>
          <Text fontSize={11} color={DIM}>gas tank placement</Text>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <Chip label="driver side" active={doc.gasSide < 0} color="#eab308" onPress={() => setDoc((cur) => ({ ...cur, gasSide: -1 }))} />
            <Chip label="passenger side" active={doc.gasSide > 0} color="#eab308" onPress={() => setDoc((cur) => ({ ...cur, gasSide: 1 }))} />
          </Row>
          <Knob label="gas z" value={doc.gasZ.toFixed(2)} onMinus={() => moveGas(-0.16)} onPlus={() => moveGas(0.16)} />
        </Col>

        <Col style={{ gap: 6, paddingTop: 4 }}>
          <Text fontSize={11} color={DIM}>hitbox groups</Text>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <Chip label="none" active={selected == null} onPress={() => setSelected(null)} />
            {hitboxGroups.map((id) => (
              <Chip key={id} label={PART_LABELS[id]} active={selected === id} color={id === 'gas_tank' ? '#eab308' : id.includes('wheel') ? '#fb7185' : '#38bdf8'} onPress={() => setSelected(id)} />
            ))}
          </Row>
        </Col>

        <Col style={{ gap: 6, paddingTop: 4 }}>
          <Text fontSize={11} color={DIM}>damage state</Text>
          <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="repair" active={false} color="#34d399" onPress={() => selected ? setPartDamage(selected, 0) : undefined} />
            <Chip label="damage" active={false} color="#fb7185" onPress={() => nudgeSelectedDamage(1)} />
            <Chip label="wreck" active={false} color="#f97316" onPress={randomDamage} />
          </Row>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {([0, 1, 2, 3] as DamageLevel[]).map((level) => (
              <Chip key={level} label={DAMAGE_LABELS[level]} active={selectedDamage === level} color={level === 0 ? '#34d399' : level === 1 ? '#facc15' : level === 2 ? '#f97316' : '#fb7185'} onPress={() => selected ? setPartDamage(selected, level) : undefined} />
            ))}
          </Row>
        </Col>

        <Col style={{ gap: 4, paddingTop: 6 }}>
          <Text fontSize={11} color={DIM}>contract</Text>
          <Text fontSize={11} color={INK}>style: {VEHICLE_STYLES[doc.style].label}</Text>
          <Text fontSize={11} color={INK}>role: {VEHICLE_ROLES[currentRole].label}</Text>
          <Text fontSize={11} color={INK}>scale: 1 unit = 1m, player ref 1.65m</Text>
          <Text fontSize={11} color={INK}>size: {dims.length.toFixed(2)}m L x {dims.width.toFixed(2)}m W</Text>
          <Text fontSize={11} color={INK}>wheel: {(dims.wheelR * 2).toFixed(2)}m diameter</Text>
          <Text fontSize={11} color={INK}>dsl: {animation.dsl}</Text>
          <Text fontSize={11} color={INK}>seed: {doc.seed}</Text>
          <Text fontSize={11} color={INK}>gas tank: {doc.gasSide < 0 ? 'driver' : 'passenger'} side, z {doc.gasZ.toFixed(2)}</Text>
          <Text fontSize={11} color={INK}>selected: {selected ? PART_LABELS[selected] : 'none'}</Text>
          <Text fontSize={11} color={INK}>damage: {selected ? DAMAGE_LABELS[selectedDamage] : 'none selected'}</Text>
        </Col>
      </Col>

      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid showAxes={false}>
          <OrbitCamera target={[0, 0.8, 0]} yaw={yaw} pitch={pitch} dist={dist} fov={42} />
          <Scene3D.AmbientLight color="#b8c9e6" intensity={0.62} />
          <Scene3D.DirectionalLight direction={[0.55, 0.9, 0.28]} color="#fff1c7" intensity={0.9} />
          <Scene3D.PointLight position={[-3.2, 2.4, -2.8]} color="#77caff" intensity={0.42} />
          <Scene3D.Mesh geometry={Geometry.Box} params={BOX} material="#0d1724" position={[0, -0.04, 0]} scale={[9, 0.06, 8]} />
          <VehicleMeshes build={build} selected={selected} showHitboxes={showHitboxes} showAnchors={showAnchors} />
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <Knob label="zoom" value={dist.toFixed(1)} onMinus={() => setDist((v) => clamp(v - 0.5, 4, 14))} onPlus={() => setDist((v) => clamp(v + 0.5, 4, 14))} />
        </Box>
      </Pressable>
    </Row>
  );
}
