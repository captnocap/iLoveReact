import { encodeLiveLights, LIVE_LIGHT_WIRE, MODEL_LIGHT_TUNING, mintModelLightId, newModelLight, normalizeModelLights, placeModelLight, rotateLightVector } from './modelLights';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const normalized = normalizeModelLights([
  { id: 'lamp', kind: 'spot', position: [1, 2, 3], dir: [0, 0, 0], color: '#FFAA00', intensity: 99, range: -2, spread: 100 },
  { id: 'lamp', kind: 'point', position: [Infinity, 4, 5], color: 'bad', intensity: 2, range: 4 },
]);
assert(normalized.length === 2, 'valid light rows were dropped');
assert(normalized[0]!.id === 'lamp' && normalized[1]!.id === 'lamp-2', 'duplicate ids were not repaired deterministically');
assert(normalized[0]!.intensity === MODEL_LIGHT_TUNING.maxIntensity, 'intensity was not clamped');
assert(normalized[0]!.range === MODEL_LIGHT_TUNING.minRangeMeters, 'range was not clamped');
assert(normalized[0]!.spread === MODEL_LIGHT_TUNING.maxConeDegrees, 'cone was not clamped');
assert(normalized[0]!.dir?.[1] === -1, 'zero direction did not fall back to down');
assert(normalized[1]!.color === MODEL_LIGHT_TUNING.defaultColor, 'bad color did not fall back');
assert(mintModelLightId([{ ...newModelLight([]), id: 'light-1' }]) === 'light-2', 'light id mint collided');

const turned = rotateLightVector([1, 2, 0], 90);
assert(Math.abs(turned[0]) < 1e-9 && turned[1] === 2 && Math.abs(turned[2] + 1) < 1e-9, 'yaw rotation disagrees with piece transforms');

const placed = placeModelLight(normalized[0]!, { x: 10, y: 20, z: 30, yawDegrees: 90 });
assert(Math.abs(placed.position[0] - 13) < 1e-9 && placed.position[1] === 22 && Math.abs(placed.position[2] - 29) < 1e-9, 'placed light did not ride the model transform');

const wire = encodeLiveLights([{ ...normalized[0]!, dir: normalized[0]!.dir!, position: normalized[0]!.position }]);
assert(wire.length === LIVE_LIGHT_WIRE.floatsPerLight, 'live light wire stride drifted');
assert(wire[0] === 1 && wire[1] === 1 && wire[3] === 3, 'live light kind/position packing drifted');
assert(Math.abs(wire[7]! - 1) < 1e-6 && Math.abs(wire[8]! - (170 / 255)) < 1e-6, 'hex color was not packed as RGB01');
assert(wire[13] === 1, 'shadow flag was dropped');

console.log('modelLights.test.ts: ok');
