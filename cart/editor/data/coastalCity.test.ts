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
  packCoastalCityPaintingStream,
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

test('plan fills the 25x25 three-kilometre native chunk window', () => {
  assert(plan.chunks.length === 625, `expected 625 chunks, got ${plan.chunks.length}`);
  assert(plan.bounds.minX === -60 && plan.bounds.maxX === 2940, 'world X bounds drifted');
  assert(plan.bounds.minZ === -60 && plan.bounds.maxZ === 2940, 'world Z bounds drifted');
  assert((plan.bounds.maxX - plan.bounds.minX) * (plan.bounds.maxZ - plan.bounds.minZ) === 9_000_000, 'world is not exactly 9 km²');
  const keys = new Set(plan.chunks.map((chunk) => `${chunk.cx},${chunk.cz}`));
  assert(keys.size === 625 && keys.has('0,0') && keys.has('24,24'), 'chunk coordinates are not 0..24 squared');
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
  assert(plan.stats.roadCount >= 150, `city-scale street hierarchy is too small (${plan.stats.roadCount})`);
  assert(plan.paths.some((path) => path.hierarchy === 'highway'), 'highway missing');
  assert(plan.paths.some((path) => path.hierarchy === 'arterial'), 'arterial missing');
  assert(plan.paths.some((path) => path.hierarchy === 'collector'), 'collector missing');
  assert(plan.paths.some((path) => path.hierarchy === 'mainStreet'), 'main street missing');
  assert(plan.paths.some((path) => path.hierarchy === 'local'), 'local road missing');
  assert(plan.paths.filter((path) => path.hierarchy === 'local').every((path) => !path.profile.sidewalks), 'dense local streets should use the narrow 7m no-sidewalk native profile');
  assert(plan.paths.filter((path) => path.hierarchy === 'mainStreet' || path.hierarchy === 'collector' || path.hierarchy === 'arterial').every((path) => path.profile.sidewalks), 'formal urban roads lost their sidewalks');
  assert(plan.stats.railwayCount === 1, 'planner should carry one restrained railway');
  assert(plan.stats.lightRailCount === 5, 'light rail should contain the five unique network edges');
  const lightRail = plan.paths.filter((path) => path.kind === 'lightRail');
  const edgeIds = new Set(lightRail.map((path) => path.id));
  for (const id of ['tram-harbor-central', 'tram-central-north', 'tram-south-central', 'tram-central-east', 'tram-east-foothills']) {
    assert(edgeIds.has(id), `missing unique light-rail edge ${id}`);
  }
  const geometryKey = (path: (typeof lightRail)[number]): string => path.points.map((point) => `${point.x},${point.z}`).join('|');
  const geometries = new Set<string>();
  for (const path of lightRail) {
    const forward = geometryKey(path), reverse = [...path.points].reverse().map((point) => `${point.x},${point.z}`).join('|');
    assert(!geometries.has(forward) && !geometries.has(reverse), `${path.id} duplicates an already-authored transit edge`);
    geometries.add(forward);
  }
  const segmentOwners = new Map<string, string>();
  for (const path of plan.paths) for (let index = 0; index + 1 < path.points.length; index += 1) {
    const a = path.points[index]!, b = path.points[index + 1]!;
    const aKey = `${a.x},${a.z},${a.elevationM}`, bKey = `${b.x},${b.z},${b.elevationM}`;
    const segmentKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const owner = segmentOwners.get(segmentKey);
    assert(!owner || owner === path.id, `${path.id} shares an authored segment with ${owner}`);
    segmentOwners.set(segmentKey, path.id);
  }
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
  assert(plan.crossings.length === 6 && plan.crossings.every((crossing) => crossing.kind === 'causeway' && crossing.name.includes('Causeway') && crossing.pathIds.length > 0), 'named causeway constraints disappeared');
  assert(new Set(plan.crossings.map((crossing) => crossing.x)).size === plan.crossings.length, 'unrelated transport paths still share a bridge deck');
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
  assert(plan.sites.length >= 1_800, `only ${plan.sites.length} sites survived city-scale validation`);
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
  const transit = plan.paths.find((path) => path.kind === 'lightRail')!;
  assert(!coastalCityFloraAllowedAt(plan, transit.points[0]!.x, transit.points[0]!.z), 'rail centerline permits flora');
  const local = plan.paths.find((path) => path.kind === 'road' && path.hierarchy === 'local')!;
  assert(!coastalCityFloraAllowedAt(plan, local.points[0]!.x, local.points[0]!.z), 'road centerline permits flora');
  const curved = plan.paths.find((path) => path.id === 'road-state-route-8')!;
  const corner = curved.points[1]!;
  assert(coastalCityTransportClearanceAt(plan, corner.x, corner.z), 'shared native-curve corridor misses an authored bend');
  assert(!coastalCityFloraAllowedAt(plan, corner.x, corner.z), 'native road bend permits flora');
});

test('streamed painting manifest and individual chunks have exact wire shapes', () => {
  const stream = packCoastalCityPaintingStream(plan, {
    tiles: { grass: 17, sand: 5, mud: 4 },
    flora: { grassSparse: 0, grassLush: 2, grassReeds: 15, pine: 9, cedar: 12, bushDense: 17 },
  });
  const wire = COASTAL_CITY_TUNING.wire;
  const stride = wire.chunkCoordFloats + wire.sampleCells * 2 + wire.tileCells * wire.cellChannelCount;
  assert(stream.chunkCount === 625, 'stream chunk count drifted');
  assert(stream.manifest.length === 2 + 625 * 2, 'manifest length is not exact');
  assert(stream.manifest[0] === 1 && stream.manifest[1] === 625, 'manifest header is malformed');
  assert(stream.manifest[2] === 0 && stream.manifest[3] === 0, 'manifest first coordinate is malformed');
  assert(stream.manifest[stream.manifest.length - 2] === 24 && stream.manifest[stream.manifest.length - 1] === 24, 'manifest last coordinate is malformed');
  const firstChunk = stream.packChunk(0);
  assert(firstChunk[0] === 0 && firstChunk[1] === 0, 'first streamed chunk coordinate is malformed');
  const lastChunk = stream.packChunk(624);
  assert(firstChunk === lastChunk, 'stream allocates instead of reusing one chunk buffer');
  assert(lastChunk[0] === 24 && lastChunk[1] === 24, 'last streamed chunk coordinate is malformed');
  const expectedPathFloats = wire.pathHeaderFloats + plan.paths.reduce((sum, path) => sum + wire.pathRecordFloats + path.points.length * wire.pathPointFloats, 0);
  assert(stream.paths.length === expectedPathFloats, 'path wire length is not exact');
  assert(stream.paths[0] === 1 && stream.paths[1] === plan.paths.length, 'path wire header is malformed');
  const chunkIndexAt = (x: number, z: number): number => {
    const cx = Math.floor((x + wire.chunkMeters / 2) / wire.chunkMeters);
    const cz = Math.floor((z + wire.chunkMeters / 2) / wire.chunkMeters);
    return cz * wire.chunkColumns + cx;
  };
  const site = plan.sites[0]!;
  const siteChunk = stream.packChunk(chunkIndexAt(site.x, site.z));
  assert(siteChunk.length === stride && siteChunk.byteLength < 1_000_000, 'single chunk record is not bounded');
  const siteMinX = siteChunk[0]! * wire.chunkMeters - wire.chunkMeters / 2;
  const siteMinZ = siteChunk[1]! * wire.chunkMeters - wire.chunkMeters / 2;
  const siteLocalX = Math.floor(site.x - siteMinX), siteLocalZ = Math.floor(site.z - siteMinZ);
  const floraStart = wire.chunkCoordFloats + wire.sampleCells * 2 + wire.tileCells * 2;
  for (const lane of [0, 1, 2] as const) {
    assert(siteChunk[floraStart + lane * wire.tileCells + siteLocalZ * wire.tileColumns + siteLocalX] === wire.emptyCell, `floor pad retained flora lane ${lane}`);
  }
  const terrainSampleAt = (x: number, z: number): { height: number; water: number } => {
    const packed = stream.packChunk(chunkIndexAt(x, z));
    const minX = packed[0]! * wire.chunkMeters - wire.chunkMeters / 2;
    const minZ = packed[1]! * wire.chunkMeters - wire.chunkMeters / 2;
    const localX = Math.round((x - minX) / wire.sampleSpacingM);
    const localZ = Math.round((z - minZ) / wire.sampleSpacingM);
    const sample = localZ * wire.sampleColumns + localX;
    return { height: packed[wire.chunkCoordFloats + sample]!, water: packed[wire.chunkCoordFloats + wire.sampleCells + sample]! };
  };
  for (const crossing of plan.crossings) {
    const packedCrossing = terrainSampleAt(crossing.x, crossing.z);
    assert(packedCrossing.height >= COASTAL_CITY_TUNING.river.causewayHeightM - 1e-5, `${crossing.id} packed below dry causeway height`);
    assert(packedCrossing.water === 0, `${crossing.id} packed with water depth ${packedCrossing.water}`);
  }
  for (let i = 0; i < siteChunk.length; i += 1) assert(Number.isFinite(siteChunk[i]!), `chunk wire NaN/Infinity at ${i}`);
  for (let i = 0; i < stream.paths.length; i += 1) assert(Number.isFinite(stream.paths[i]!), `path wire NaN/Infinity at ${i}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
