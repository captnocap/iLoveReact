// loadBench.ts — measure the TS loader's LOAD throughput: decode a packed
// instance buffer from the RJMP container + group it into render batches, the
// exact path WorldLoaderView runs and the JS twin of world_loader.zig's
// decodeInstances + buildShapeBatches. Run: bundle + v8cli (see _testkit header).
// This isolates the load cost (no GPU, no React) so we have a concrete number to
// compare against /compiled's native load.

import { MAP_LUMP, writeLumpContainer } from '@reactjit/workspace';
import { encodeInstanceLump, INSTANCE_STRIDE } from '../../../compile/worldGeometry';
import { loadSceneFromMapContainer } from './decode';
import { buildSceneBuckets } from './buildBuckets';

const now = (): number => {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
};

/** Build a synthetic stride-13 instance buffer of `n` rows across a few shapes,
 *  laid out on a grid so bounds are realistic. shapeId cycles box/cyl/sphere. */
function syntheticInstances(n: number): Float32Array {
  const out = new Float32Array(n * INSTANCE_STRIDE);
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i += 1) {
    const b = i * INSTANCE_STRIDE;
    const gx = (i % side) * 3;
    const gz = Math.floor(i / side) * 3;
    out[b + 0] = gx; out[b + 1] = 1.5; out[b + 2] = gz;        // pos
    out[b + 3] = 0; out[b + 4] = (i * 37) % 360; out[b + 5] = 0; // rot (yaw)
    out[b + 6] = 1; out[b + 7] = 3; out[b + 8] = 1;             // scale
    out[b + 9] = 0.5; out[b + 10] = 0.5; out[b + 11] = 0.6;     // rgb
    out[b + 12] = i % 5 === 0 ? 2 : i % 7 === 0 ? 4 : 0;        // shape: mostly box, some cyl/sphere
  }
  return out;
}

function bench(n: number): void {
  const instances = syntheticInstances(n);
  const tEnc = now();
  const container = writeLumpContainer([
    { type: MAP_LUMP.INSTANCES, encoding: 'raw', data: encodeInstanceLump(instances, Math.floor(n / 2), INSTANCE_STRIDE) },
  ]);
  const tDecode = now();
  const scene = loadSceneFromMapContainer(container);
  const tBuild = now();
  const built = buildSceneBuckets(scene);
  const tDone = now();

  const decodeMs = tBuild - tDecode;
  const buildMs = tDone - tBuild;
  const loadMs = tDone - tDecode;
  const perMillion = (loadMs / n) * 1e6;
  // eslint-disable-next-line no-console
  console.log(
    `${String(n).padStart(8)} inst | container ${(container.byteLength / 1024 / 1024).toFixed(1)}MB ` +
    `(enc ${(tDecode - tEnc).toFixed(0)}ms) | decode ${decodeMs.toFixed(1)}ms + build ${buildMs.toFixed(1)}ms ` +
    `= LOAD ${loadMs.toFixed(1)}ms (${perMillion.toFixed(0)}ms/M) → ${scene.instanceCount} rows, ${built.buckets.length} batch`,
  );
}

console.log('TS loader LOAD throughput (decode container + batch into instanced draws):');
for (const n of [1000, 10000, 50000, 200000, 500000]) bench(n);
