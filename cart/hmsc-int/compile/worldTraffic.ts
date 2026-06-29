// worldTraffic.ts — bake ambient road traffic into the TRAFFIC map lump so the
// compiled no-V8 game drives vehicles around the city (req_2056; HAND-AUTHORED
// paths since req_2076).
//
// THE PIPELINE: read the HAND-AUTHORED traffic paths off the world state (the
// author drew them in the editor; no tile-grid derivation — the old flow-trace
// generator was ripped out, req_2076), and ship per vehicle:
//   • a PROTOTYPE — its buildVehicle meshes flattened to instance rows in LOCAL
//     space (pos3/rot3/scale3/color3/shape — the 12-float gpu/3d.zig row + a
//     shape id), with geometry params folded into scale against the loader's UNIT
//     box/cylinder/sphere;
//   • a ROUTE polyline (world x,z) = the authored path, cruise speed, and a phase
//     head-start.
// world_loader.zig's stepTraffic samples each route per frame (arc-length mod
// loop length) and rebuilds the vehicle's instance rows at the sampled pose — the
// LED-ticker mutable-instance pattern (compile/worldTicker.ts).

import { bakeAuthoredTraffic, type BakedVehicle } from '../game/traffic';
import { buildVehicle, type VehicleDoc, type VehicleMaterial } from '../game/vehicle';
import { hx } from '../game/kinds/propModels';
import type { TrafficPath } from '../design';

export const TRAFFIC_LUMP_VERSION = 1;

/** Loader instance-shape ids (mirror world_loader.zig SHAPE_*). */
const SHAPE_BOX = 0;
const SHAPE_CYLINDER16 = 3;
const SHAPE_SPHERE = 4;

/** 13 floats per prototype row: pos3, rot3, scale3, color3, shape. */
export const TRAFFIC_ROW_STRIDE = 13;

export type TrafficVehicleRecord = {
  /** flattened prototype rows (TRAFFIC_ROW_STRIDE each), vehicle-local space */
  rows: number[];
  /** route corner points (world x,z pairs, flattened) */
  route: number[];
  /** constant cruise speed (m/s) */
  speed: number;
  /** arc-length head start (m) */
  phase: number;
};

/** [r,g,b] 0..1 from a vehicle material (hex string or { color }). */
function colorOf(material: VehicleMaterial): [number, number, number] {
  const hex = typeof material === 'string' ? material : material.color;
  const c = hx(hex);
  return [c[0], c[1], c[2]];
}

/** Fold a vehicle mesh's geometry params into a scale against the loader's UNIT
 *  geometry (cube 1³, cylinder Ø1×h1 on Y, sphere Ø1). */
function shapeAndScale(mesh: ReturnType<typeof buildVehicle>['meshes'][number]): { shape: number; scale: [number, number, number] } {
  const p = mesh.params ?? {};
  const s = mesh.scale;
  if (mesh.kind === 'cylinder') {
    const r = p.radius ?? 0.5;
    return { shape: SHAPE_CYLINDER16, scale: [s[0] * 2 * r, s[1] * (p.height ?? 1), s[2] * 2 * r] };
  }
  if (mesh.kind === 'sphere') {
    const r = p.radius ?? 0.5;
    return { shape: SHAPE_SPHERE, scale: [s[0] * 2 * r, s[1] * 2 * r, s[2] * 2 * r] };
  }
  return { shape: SHAPE_BOX, scale: [s[0] * (p.width ?? 1), s[1] * (p.height ?? 1), s[2] * (p.depth ?? 1)] };
}

/** Flatten a vehicle doc's build into prototype instance rows (local space). */
export function vehiclePrototypeRows(doc: VehicleDoc): number[] {
  const build = buildVehicle(doc);
  const rows: number[] = [];
  for (const mesh of build.meshes) {
    const { shape, scale } = shapeAndScale(mesh);
    const rot = mesh.rotation ?? [0, 0, 0];
    const [cr, cg, cb] = colorOf(mesh.material);
    rows.push(
      mesh.position[0], mesh.position[1], mesh.position[2],
      rot[0], rot[1], rot[2],
      scale[0], scale[1], scale[2],
      cr, cg, cb,
      shape,
    );
  }
  return rows;
}

/** Build the TRAFFIC records from the HAND-AUTHORED paths on the world state.
 *  Pure — the headless bake path. Empty when no paths are authored (no ambient
 *  traffic until the author draws some). */
export function trafficRecords(opts: {
  paths: readonly TrafficPath[];
  seed?: number;
}): TrafficVehicleRecord[] {
  const vehicles = bakeAuthoredTraffic({ paths: opts.paths, seed: opts.seed });
  return vehicles.map(vehicleRecord);
}

function vehicleRecord(v: BakedVehicle): TrafficVehicleRecord {
  const route: number[] = [];
  for (const [x, z] of v.route.points) route.push(x, z);
  return { rows: vehiclePrototypeRows(v.doc), route, speed: v.speed, phase: v.phase };
}

/** Encode the TRAFFIC lump.
 *
 *  Layout (version 1, little-endian):
 *    u32 version | u32 vehicleCount
 *    per vehicle:
 *      f32 speed | f32 phase
 *      u32 pointCount | f32[pointCount*2] route (x,z)
 *      u32 rowCount   | f32[rowCount*13]  rows (pos3,rot3,scale3,color3,shape) */
export function encodeTraffic(records: readonly TrafficVehicleRecord[]): Uint8Array {
  let bytes = 8;
  for (const r of records) bytes += 2 * 4 + 4 + r.route.length * 4 + 4 + r.rows.length * 4;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setUint32(0, TRAFFIC_LUMP_VERSION, true);
  view.setUint32(4, records.length, true);
  let at = 8;
  const f = (v: number) => { view.setFloat32(at, v, true); at += 4; };
  const u = (v: number) => { view.setUint32(at, v, true); at += 4; };
  for (const r of records) {
    f(r.speed); f(r.phase);
    u(r.route.length / 2);
    for (const v of r.route) f(v);
    u(r.rows.length / TRAFFIC_ROW_STRIDE);
    for (const v of r.rows) f(v);
  }
  return out;
}

/** Wire-format twin of encodeTraffic — round-trip test reader + the reference
 *  for constructor.zig's TRAFFIC decode. */
export function decodeTraffic(bytes: Uint8Array): { version: number; records: TrafficVehicleRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  if (version !== TRAFFIC_LUMP_VERSION) throw new Error(`unsupported traffic version ${version}`);
  const count = view.getUint32(4, true);
  let at = 8;
  const f = () => { const v = view.getFloat32(at, true); at += 4; return v; };
  const u = () => { const v = view.getUint32(at, true); at += 4; return v; };
  const records: TrafficVehicleRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const speed = f();
    const phase = f();
    const pointCount = u();
    const route: number[] = [];
    for (let k = 0; k < pointCount * 2; k += 1) route.push(f());
    const rowCount = u();
    const rows: number[] = [];
    for (let k = 0; k < rowCount * TRAFFIC_ROW_STRIDE; k += 1) rows.push(f());
    records.push({ speed, phase, route, rows });
  }
  return { version, records };
}
