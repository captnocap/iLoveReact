import type { LightRig, V3 } from './editMesh';

/** Authoring and boundary limits. The renderer can accept 256 scene lights;
 * keeping one prop bounded prevents a single duplicated sign from consuming
 * that whole world budget. */
export const MODEL_LIGHT_TUNING = Object.freeze({
  maxPerModel: 16,
  minIntensity: 0,
  maxIntensity: 20,
  minRangeMeters: 0.1,
  maxRangeMeters: 100,
  minConeDegrees: 5,
  maxConeDegrees: 85,
  coordinateLimitMeters: 10_000,
  defaultPosition: [0, 2, 0] as V3,
  defaultDirection: [0, -1, 0] as V3,
  defaultColor: '#ffd27d',
  defaultIntensity: 3,
  defaultRangeMeters: 8,
  defaultConeDegrees: 32,
});

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

function vector(value: unknown, fallback: V3): V3 {
  const row = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map((axis) => clamp(
    finite(row[axis], fallback[axis]),
    -MODEL_LIGHT_TUNING.coordinateLimitMeters,
    MODEL_LIGHT_TUNING.coordinateLimitMeters,
  )) as V3;
}

function direction(value: unknown): V3 {
  const raw = vector(value, MODEL_LIGHT_TUNING.defaultDirection);
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  if (length < 1e-6) return [...MODEL_LIGHT_TUNING.defaultDirection];
  return [raw[0] / length, raw[1] / length, raw[2] / length];
}

function color(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : MODEL_LIGHT_TUNING.defaultColor;
}

/** Validate and clone lights at the manifest/world boundary. Unknown rows are
 * skipped; duplicate ids are renamed deterministically so every edit key stays
 * addressable after hand-edited manifests. */
export function normalizeModelLights(value: unknown): LightRig[] {
  if (!Array.isArray(value)) return [];
  const out: LightRig[] = [];
  const ids = new Set<string>();
  for (const raw of value.slice(0, MODEL_LIGHT_TUNING.maxPerModel)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Partial<LightRig>;
    const base = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `light-${out.length + 1}`;
    let id = base;
    let suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    const kind = row.kind === 'point' ? 'point' : 'spot';
    out.push({
      id,
      kind,
      position: vector(row.position, MODEL_LIGHT_TUNING.defaultPosition),
      ...(kind === 'spot' ? { dir: direction(row.dir) } : {}),
      color: color(row.color),
      intensity: clamp(finite(row.intensity, MODEL_LIGHT_TUNING.defaultIntensity), MODEL_LIGHT_TUNING.minIntensity, MODEL_LIGHT_TUNING.maxIntensity),
      range: clamp(finite(row.range, MODEL_LIGHT_TUNING.defaultRangeMeters), MODEL_LIGHT_TUNING.minRangeMeters, MODEL_LIGHT_TUNING.maxRangeMeters),
      ...(kind === 'spot' ? {
        spread: clamp(finite(row.spread, MODEL_LIGHT_TUNING.defaultConeDegrees), MODEL_LIGHT_TUNING.minConeDegrees, MODEL_LIGHT_TUNING.maxConeDegrees),
        castsShadow: row.castsShadow !== false,
      } : {}),
    });
  }
  return out;
}

export function mintModelLightId(lights: readonly LightRig[]): string {
  const ids = new Set(lights.map((light) => light.id));
  let n = 1;
  while (ids.has(`light-${n}`)) n += 1;
  return `light-${n}`;
}

export function newModelLight(lights: readonly LightRig[]): LightRig {
  return normalizeModelLights([{ id: mintModelLightId(lights), kind: 'spot' }])[0]!;
}

/** Rotate one local vector by the editor/Scene3D +Y yaw convention. Local +Z
 * turns toward world +X at +90 degrees (the same frame used by pieces.ts). */
export function rotateLightVector(v: V3, yawDegrees: number): V3 {
  const yaw = yawDegrees * Math.PI / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export type WorldLight = Omit<LightRig, 'position' | 'dir'> & { position: V3; dir: V3 };

/** Lower a package-local emitter through one placed piece transform. */
export function placeModelLight(
  light: LightRig,
  placement: { x: number; y: number; z: number; yawDegrees: number },
): WorldLight {
  const offset = rotateLightVector(light.position, placement.yawDegrees);
  return {
    ...light,
    position: [placement.x + offset[0], placement.y + offset[1], placement.z + offset[2]],
    dir: rotateLightVector(light.dir ?? MODEL_LIGHT_TUNING.defaultDirection, placement.yawDegrees),
  };
}

export const LIVE_LIGHT_WIRE = Object.freeze({
  floatsPerLight: 14,
  maxLights: 256,
});

function rgb01(hex: string): V3 {
  const normalized = color(hex);
  return [
    parseInt(normalized.slice(1, 3), 16) / 255,
    parseInt(normalized.slice(3, 5), 16) / 255,
    parseInt(normalized.slice(5, 7), 16) / 255,
  ];
}

/** Fixed Float32 wire consumed by world_loader/live_lights.zig. */
export function encodeLiveLights(lights: readonly WorldLight[]): Float32Array {
  const count = Math.min(lights.length, LIVE_LIGHT_WIRE.maxLights);
  const out = new Float32Array(count * LIVE_LIGHT_WIRE.floatsPerLight);
  for (let i = 0; i < count; i += 1) {
    const light = lights[i]!;
    const at = i * LIVE_LIGHT_WIRE.floatsPerLight;
    const rgb = rgb01(light.color);
    out[at] = light.kind === 'spot' ? 1 : 0;
    out.set(light.position, at + 1);
    out.set(light.dir, at + 4);
    out.set(rgb, at + 7);
    out[at + 10] = light.intensity;
    out[at + 11] = light.range;
    out[at + 12] = light.spread ?? MODEL_LIGHT_TUNING.defaultConeDegrees;
    out[at + 13] = light.kind === 'spot' && light.castsShadow !== false ? 1 : 0;
  }
  return out;
}
