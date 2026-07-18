// Coastal city pure planner + native wire tests.
//
//   tools/esbuild cart/editor/data/coastalCity.test.ts --bundle \
//     --outfile=/tmp/editor-coastal-city.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-coastal-city.test.js
import {
  COASTAL_CITY_TUNING,
  COASTAL_CITY_ZONES,
  buildingSiteBounds,
  coastalCityCausewayAt,
  coastalCityFloraAllowedAt,
  coastalCityTransportClearanceAt,
  coastXAt,
  generateCoastalCity,
  isBeachAt,
  isProtectedAt,
  isWaterAt,
  isWaterForPlanAt,
  packCoastalCityPainting,
  protectedLandKindAt,
  riverHalfWidthAt,
  riverZAt,
  terrainHeightAt,
  terrainHeightForPlanAt,
  waterDepthAt,
  waterDepthForPlanAt,
  type CoastalBuildingSite,
} from './coastalCity';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function near(a: number, b: number, tolerance = 1e-5): boolean { return Math.abs(a - b) <= tolerance; }

const SEED = 18473;
const plan = generateCoastalCity(SEED);

test('numeric seed generation is deterministic and stage-stable', () => {
  const again = generateCoastalCity(SEED);
  assert(JSON.stringify(plan) === JSON.stringify(again), 'same seed produced different plans');
  assert(generateCoastalCity(SEED + 1).name !== plan.name || JSON.stringify(generateCoastalCity(SEED + 1).districts) !== JSON.stringify(plan.districts), 'neighboring seed did not vary content');
  assert(plan.stageOrder.join(',') === 'terrain,protectedLand,transport,buildingSites', 'generation order drifted');
  assert(plan.stats.infrastructureCompleteBeforeSites, 'infrastructure-first invariant absent');
});

test('plan fills exactly the 9x9 native chunk window', () => {
  assert(plan.chunks.length === 81, `expected 81 chunks, got ${plan.chunks.length}`);
  assert(plan.bounds.minX === -60 && plan.bounds.maxX === 1020, 'world X bounds drifted');
  assert(plan.bounds.minZ === -60 && plan.bounds.maxZ === 1020, 'world Z bounds drifted');
  const keys = new Set(plan.chunks.map((chunk) => `${chunk.cx},${chunk.cz}`));
  assert(keys.size === 81 && keys.has('0,0') && keys.has('8,8'), 'chunk coordinates are not 0..8 squared');
});

test('coast, river, beach, and protected land retain distinct semantics', () => {
  const coast = coastXAt(220, SEED);
  assert(isWaterAt(coast - 2, 220, SEED), 'west side of coast is not water');
  assert(isBeachAt(coast + COASTAL_CITY_TUNING.coast.beachWidthM / 2, 220, SEED), 'explicit beach band disappeared');
  const riverX = 500, riverZ = riverZAt(riverX, SEED);
  assert(isWaterAt(riverX, riverZ, SEED), 'bent river center is dry');
  assert(protectedLandKindAt(riverX, riverZ + riverHalfWidthAt(riverX, SEED) + 8, SEED) === 'wetland', 'river floodplain is not protected wetland');
  assert(protectedLandKindAt(COASTAL_CITY_TUNING.protectedLand.mountain.centerX, COASTAL_CITY_TUNING.protectedLand.mountain.centerZ, SEED) === 'mountain', 'mountain reserve disappeared');
  assert(protectedLandKindAt(COASTAL_CITY_TUNING.protectedLand.forest.centerX, COASTAL_CITY_TUNING.protectedLand.forest.centerZ, SEED) === 'forest', 'forest reserve disappeared');
  assert(protectedLandKindAt(COASTAL_CITY_TUNING.protectedLand.reserve.centerX, COASTAL_CITY_TUNING.protectedLand.reserve.centerZ, SEED) === 'reserve', 'growth reserve disappeared');
  const riverBed = terrainHeightAt(riverX, riverZ, SEED), depth = waterDepthAt(riverX, riverZ, SEED);
  assert(riverBed < 0 && depth > 0 && near(riverBed + depth, 0), 'wet bed + depth does not place surface at zero');
  assert(waterDepthAt(500, 800, SEED) === 0, 'dry terrain carries water depth');
  assert(COASTAL_CITY_ZONES.length === 8, 'native zone legend is no longer bounded');
});

test('semantic transport has a nontrivial hierarchy within native caps', () => {
  assert(plan.paths.length <= COASTAL_CITY_TUNING.wire.maxPaths, 'path cap exceeded');
  assert(plan.paths.every((path) => path.points.length >= 2 && path.points.length <= COASTAL_CITY_TUNING.wire.maxPointsPerPath), 'point cap or minimum violated');
  assert(plan.stats.roadCount >= 24, `street hierarchy is too small (${plan.stats.roadCount})`);
  assert(plan.paths.some((path) => path.hierarchy === 'highway'), 'highway missing');
  assert(plan.paths.some((path) => path.hierarchy === 'arterial'), 'arterial missing');
  assert(plan.paths.some((path) => path.hierarchy === 'collector'), 'collector missing');
  assert(plan.paths.some((path) => path.hierarchy === 'mainStreet'), 'main street missing');
  assert(plan.paths.some((path) => path.hierarchy === 'local'), 'local road missing');
  assert(plan.stats.railwayCount === 1, 'planner should carry one restrained railway');
  assert(plan.stats.lightRailCount >= 3, 'connected light-rail network is too small');
  const red = plan.paths.find((path) => path.id === 'tram-red')!;
  assert(plan.paths.filter((path) => path.kind === 'lightRail' && path.id !== red.id).every((path) => path.points.some((p) => red.points.some((r) => p.x === r.x || p.z === r.z))), 'light rail lines do not connect through shared alignments');
  for (const path of plan.paths.filter((candidate) => candidate.kind !== 'road')) {
    assert(path.points.every((point) => point.elevationM === 0), `${path.id} rail grade is not flat`);
    const required = path.kind === 'railway' ? COASTAL_CITY_TUNING.rail.railwayMinCurveM : COASTAL_CITY_TUNING.rail.lightRailMinCurveM;
    assert(path.profile.curveRadiusM >= required, `${path.id} advertises an undersized curve`);
    for (let i = 0; i + 1 < path.points.length; i += 1) {
      const a = path.points[i]!, b = path.points[i + 1]!;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      assert(run >= COASTAL_CITY_TUNING.rail.minSegmentM, `${path.id} has a native-invalid short leg`);
      const maxGrade = path.kind === 'railway' ? COASTAL_CITY_TUNING.rail.railwayMaxGrade : COASTAL_CITY_TUNING.rail.lightRailMaxGrade;
      assert(Math.abs(b.elevationM - a.elevationM) / run <= maxGrade, `${path.id} exceeds native grade`);
    }
    for (let i = 1; i + 1 < path.points.length; i += 1) {
      const a = path.points[i - 1]!, b = path.points[i]!, c = path.points[i + 1]!;
      const incoming = Math.hypot(b.x - a.x, b.z - a.z), outgoing = Math.hypot(c.x - b.x, c.z - b.z);
      const dot = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (incoming * outgoing);
      if (dot <= COASTAL_CITY_TUNING.rail.straightDotThreshold) {
        const effectiveReach = Math.min(path.profile.curveRadiusM, incoming * COASTAL_CITY_TUNING.rail.turnReachSegmentFraction, outgoing * COASTAL_CITY_TUNING.rail.turnReachSegmentFraction);
        assert(effectiveReach >= required, `${path.id} effective turn reach ${effectiveReach} is below ${required}`);
      }
    }
  }
  assert(plan.crossings.length === 3 && plan.crossings.every((crossing) => crossing.kind === 'causeway' && crossing.name.includes('Causeway') && crossing.pathIds.length > 0), 'named causeway constraints disappeared');
});

test('every named crossing replaces wet bed with honest dry causeway terrain', () => {
  for (const crossing of plan.crossings) {
    assert(isWaterAt(crossing.x, crossing.z, plan.seed), `${crossing.id} is not placed over geographic water`);
    assert(coastalCityCausewayAt(plan, crossing.x, crossing.z)?.id === crossing.id, `${crossing.id} has no authored causeway corridor`);
    assert(!isWaterForPlanAt(plan, crossing.x, crossing.z), `${crossing.id} stays wet after planning`);
    assert(waterDepthForPlanAt(plan, crossing.x, crossing.z) === 0, `${crossing.id} retains water depth`);
    assert(terrainHeightForPlanAt(plan, crossing.x, crossing.z) >= COASTAL_CITY_TUNING.river.causewayHeightM, `${crossing.id} bed was not raised above water surface`);
  }
});

function overlap(a: CoastalBuildingSite, b: CoastalBuildingSite): boolean {
  const gap = COASTAL_CITY_TUNING.sites.overlapGapM;
  const aa = buildingSiteBounds(a, gap), bb = buildingSiteBounds(b, gap);
  return aa.minX < bb.maxX && aa.maxX > bb.minX && aa.minZ < bb.maxZ && aa.maxZ > bb.minZ;
}

test('floor sites are module-centered quarter-turn dry nonoverlapping formal frontage', () => {
  assert(plan.sites.length >= 80, `only ${plan.sites.length} sites survived validation`);
  const paths = new Map(plan.paths.map((path) => [path.id, path]));
  for (let i = 0; i < plan.sites.length; i += 1) {
    const site = plan.sites[i]!;
    assert(near((site.x - COASTAL_CITY_TUNING.world.moduleCenterM) / COASTAL_CITY_TUNING.world.buildModuleM, Math.round((site.x - COASTAL_CITY_TUNING.world.moduleCenterM) / COASTAL_CITY_TUNING.world.buildModuleM)), `${site.id} X is off the 3m center grid`);
    assert(near((site.z - COASTAL_CITY_TUNING.world.moduleCenterM) / COASTAL_CITY_TUNING.world.buildModuleM, Math.round((site.z - COASTAL_CITY_TUNING.world.moduleCenterM) / COASTAL_CITY_TUNING.world.buildModuleM)), `${site.id} Z is off the 3m center grid`);
    assert(site.widthM % 3 === 0 && site.depthM % 3 === 0, `${site.id} footprint is off-module`);
    assert(site.yawDegrees === 0 || site.yawDegrees === 90 || site.yawDegrees === 180 || site.yawDegrees === 270, `${site.id} retained arbitrary yaw`);
    const frontage = paths.get(site.frontagePathId);
    assert(!!frontage?.formalFrontage && frontage.kind === 'road', `${site.id} lacks formal road frontage`);
    const bounds = buildingSiteBounds(site);
    for (const [x, z] of [[bounds.minX, bounds.minZ], [bounds.maxX, bounds.minZ], [bounds.maxX, bounds.maxZ], [bounds.minX, bounds.maxZ], [site.x, site.z]]) {
      assert(!isWaterAt(x, z, plan.seed), `${site.id} touches water`);
      assert(!isProtectedAt(x, z, plan.seed), `${site.id} touches protected land`);
    }
    assert(near(terrainHeightForPlanAt(plan, site.x, site.z), site.y), `${site.id} floor pad is not level at its authored Y`);
    for (let j = 0; j < i; j += 1) assert(!overlap(site, plan.sites[j]!), `${site.id} overlaps ${plan.sites[j]!.id}`);
  }
  assert(plan.paths.every((path) => path.generationStage === 'transport'), 'transport stage tag drifted');
  assert(plan.sites.every((site) => site.generationStage === 'buildingSites'), 'site stage tag drifted');
});

test('flora source mask reserves floor pads and full transport corridors', () => {
  const site = plan.sites[0]!;
  assert(!coastalCityFloraAllowedAt(plan, site.x, site.z), 'accepted floor pad permits flora at its center');
  const red = plan.paths.find((path) => path.id === 'tram-red')!;
  assert(!coastalCityFloraAllowedAt(plan, red.points[0]!.x, red.points[0]!.z), 'rail centerline permits flora');
  const local = plan.paths.find((path) => path.kind === 'road' && path.hierarchy === 'local')!;
  assert(!coastalCityFloraAllowedAt(plan, local.points[0]!.x, local.points[0]!.z), 'road centerline permits flora');
  // Regression: this cell sits inside State Route 8's native quadratic fillet
  // but outside the old sharp authored chords at seed 0.
  const curved = generateCoastalCity(0);
  assert(coastalCityTransportClearanceAt(curved, 748.5, 499.5), 'shared native-curve corridor misses the seed-0 fillet edge');
  assert(!coastalCityFloraAllowedAt(curved, 748.5, 499.5), 'native road fillet edge permits flora');
});

test('native painting wire has exact fixed strides and no NaNs', () => {
  const packed = packCoastalCityPainting(plan, {
    tiles: { grass: 17, sand: 5, mud: 4 },
    flora: { grassSparse: 0, grassLush: 2, grassReeds: 15, pine: 9, cedar: 12, bushDense: 17 },
  });
  const wire = COASTAL_CITY_TUNING.wire;
  const stride = wire.chunkCoordFloats + wire.sampleCells * 2 + wire.tileCells * wire.cellChannelCount;
  assert(packed.chunks.length === wire.chunkHeaderFloats + 81 * stride, 'chunk wire length is not exact');
  assert(packed.chunks[0] === 1 && packed.chunks[1] === 81 && packed.chunks[2] === stride, 'chunk wire header is malformed');
  const expectedPathFloats = wire.pathHeaderFloats + plan.paths.reduce((sum, path) => sum + wire.pathRecordFloats + path.points.length * wire.pathPointFloats, 0);
  assert(packed.paths.length === expectedPathFloats, 'path wire length is not exact');
  assert(packed.paths[0] === 1 && packed.paths[1] === plan.paths.length, 'path wire header is malformed');
  const floraAt = (x: number, z: number, lane: 0 | 1 | 2): number => {
    const globalX = Math.floor(x + wire.chunkMeters / 2);
    const globalZ = Math.floor(z + wire.chunkMeters / 2);
    const cx = Math.floor(globalX / wire.tileColumns), cz = Math.floor(globalZ / wire.tileColumns);
    const localX = globalX - cx * wire.tileColumns, localZ = globalZ - cz * wire.tileColumns;
    const chunkBase = wire.chunkHeaderFloats + (cz * wire.chunkColumns + cx) * stride;
    const grassBase = chunkBase + wire.chunkCoordFloats + wire.sampleCells * 2 + wire.tileCells * 2;
    return packed.chunks[grassBase + lane * wire.tileCells + localZ * wire.tileColumns + localX]!;
  };
  const site = plan.sites[0]!;
  for (const lane of [0, 1, 2] as const) assert(floraAt(site.x, site.z, lane) === wire.emptyCell, `floor pad retained flora lane ${lane}`);
  const red = plan.paths.find((path) => path.id === 'tram-red')!;
  for (const lane of [0, 1, 2] as const) assert(floraAt(red.points[0]!.x, red.points[0]!.z, lane) === wire.emptyCell, `rail corridor retained flora lane ${lane}`);
  const terrainSampleAt = (x: number, z: number): { height: number; water: number } => {
    const globalX = Math.round((x + wire.chunkMeters / 2) / wire.sampleSpacingM);
    const globalZ = Math.round((z + wire.chunkMeters / 2) / wire.sampleSpacingM);
    const samplesPerChunk = wire.sampleColumns - 1;
    const cx = Math.min(wire.chunkColumns - 1, Math.floor(globalX / samplesPerChunk));
    const cz = Math.min(wire.chunkRows - 1, Math.floor(globalZ / samplesPerChunk));
    const localX = globalX - cx * samplesPerChunk, localZ = globalZ - cz * samplesPerChunk;
    const chunkBase = wire.chunkHeaderFloats + (cz * wire.chunkColumns + cx) * stride + wire.chunkCoordFloats;
    const sample = localZ * wire.sampleColumns + localX;
    return { height: packed.chunks[chunkBase + sample]!, water: packed.chunks[chunkBase + wire.sampleCells + sample]! };
  };
  for (const crossing of plan.crossings) {
    const packedCrossing = terrainSampleAt(crossing.x, crossing.z);
    assert(packedCrossing.height >= COASTAL_CITY_TUNING.river.causewayHeightM - 1e-5, `${crossing.id} packed below dry causeway height`);
    assert(packedCrossing.water === 0, `${crossing.id} packed with water depth ${packedCrossing.water}`);
  }
  for (let i = 0; i < packed.chunks.length; i += 1) assert(Number.isFinite(packed.chunks[i]!), `chunk wire NaN/Infinity at ${i}`);
  for (let i = 0; i < packed.paths.length; i += 1) assert(Number.isFinite(packed.paths[i]!), `path wire NaN/Infinity at ${i}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
