// coastalCity.ts — deterministic infrastructure-first coastal city planner.
//
// This is the useful world-planning idea from coastal-city-sketch rewritten as
// editor data.  It deliberately has no browser/canvas surface and it does not
// invent another map format: terrain/cell channels and semantic transport paths
// are packed directly for the native map painter, while building intent remains
// one accepted SITE record for the document compiler to lower into floor pieces.

export type CoastalGenerationStage = 'terrain' | 'protectedLand' | 'transport' | 'buildingSites';
export type CoastalPathKind = 'road' | 'lightRail' | 'railway';
export type CoastalRoadHierarchy = 'highway' | 'arterial' | 'collector' | 'mainStreet' | 'local';
export type CoastalProtectedKind = 'beach' | 'wetland' | 'mountain' | 'forest' | 'reserve';
export type CoastalSiteYaw = 0 | 90 | 180 | 270;
export type CoastalIntendedUse =
  | 'downtownCore'
  | 'harborIndustrial'
  | 'mainStreetBusiness'
  | 'mixedUse'
  | 'residential'
  | 'beachfront'
  | 'transitOriented';

export type CoastalPoint = { x: number; z: number; elevationM: number };

export type CoastalPathProfile = {
  lanesF: number;
  lanesB: number;
  sidewalks: boolean;
  tracks: number;
  curveRadiusM: number;
  speedLimitKph: number;
};

export type CoastalTransportPath = {
  id: string;
  name: string;
  kind: CoastalPathKind;
  hierarchy: CoastalRoadHierarchy | 'lightRail' | 'railway';
  profile: CoastalPathProfile;
  points: readonly CoastalPoint[];
  formalFrontage: boolean;
  districtId?: string;
  crossingId?: string;
  generationStage: 'transport';
};

export type CoastalCityZone = { id: string; name: string; color: string };

export type CoastalLandUse = {
  id: string;
  name: string;
  kind: CoastalProtectedKind;
  protected: true;
  shape: 'corridor' | 'ellipse';
  points?: readonly { x: number; z: number }[];
  center?: { x: number; z: number };
  radiusX?: number;
  radiusZ?: number;
  generationStage: 'protectedLand';
};

export type CoastalDistrictKind = 'downtown' | 'industrial' | 'mixed' | 'residential' | 'beachfront';

export type CoastalDistrict = {
  id: string;
  name: string;
  kind: CoastalDistrictKind;
  center: { x: number; z: number };
  radiusX: number;
  radiusZ: number;
};

export type CoastalCrossing = {
  id: string;
  name: string;
  kind: 'causeway';
  x: number;
  z: number;
  pathIds: readonly string[];
};

export type CoastalBuildingSite = {
  id: string;
  intendedUse: CoastalIntendedUse;
  widthM: number;
  depthM: number;
  suggestedMaxFloors: number;
  frontagePathId: string;
  x: number;
  y: number;
  z: number;
  yawDegrees: CoastalSiteYaw;
  generationStage: 'buildingSites';
};

export type CoastalCityStats = {
  chunkCount: number;
  pathCount: number;
  roadCount: number;
  lightRailCount: number;
  railwayCount: number;
  siteCount: number;
  rejectedSiteCount: number;
  maxPointsPerPath: number;
  infrastructureCompleteBeforeSites: true;
};

export type CoastalCityPlan = {
  version: 1;
  seed: number;
  name: string;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  chunks: readonly { cx: number; cz: number }[];
  zones: readonly CoastalCityZone[];
  landUses: readonly CoastalLandUse[];
  districts: readonly CoastalDistrict[];
  crossings: readonly CoastalCrossing[];
  paths: readonly CoastalTransportPath[];
  sites: readonly CoastalBuildingSite[];
  stageOrder: readonly CoastalGenerationStage[];
  stats: CoastalCityStats;
};

export type CoastalCityPaintingLegend = {
  tiles: Readonly<{ grass: number; sand: number; mud: number }>;
  flora: Readonly<{
    grassSparse: number;
    grassLush: number;
    grassReeds: number;
    pine: number;
    cedar: number;
    bushDense: number;
  }>;
};

export type PackedCoastalCityPainting = { chunks: Float32Array; paths: Float32Array };

/**
 * The one behavior table.  Numbers in the planner are either mathematical/wire
 * structure (zero, one, tuple offsets) or come from here, so the baseline can
 * be tuned without hunting through generation code for buried policy.
 */
export const COASTAL_CITY_TUNING = {
  wire: {
    version: 1,
    chunkHeaderFloats: 5,
    chunkCoordFloats: 2,
    chunkCount: 81,
    chunkColumns: 9,
    chunkRows: 9,
    chunkMeters: 120,
    sampleSpacingM: 0.5,
    sampleColumns: 241,
    sampleCells: 58_081,
    tileColumns: 120,
    tileCells: 14_400,
    tileCenterOffsetM: 0.5,
    cellChannelCount: 5,
    pathHeaderFloats: 2,
    pathRecordFloats: 8,
    pathPointFloats: 3,
    maxPaths: 128,
    maxPointsPerPath: 128,
    emptyCell: -1,
    maxLegendIndex: 32_767,
    pathKind: { road: 0, lightRail: 1, railway: 2 },
  },
  world: {
    minX: -60,
    minZ: -60,
    maxX: 1020,
    maxZ: 1020,
    buildModuleM: 3,
    moduleCenterM: 1.5,
    pathPointSnapM: 0.25,
    terrainHeightMinM: -14,
    terrainHeightMaxM: 54,
    dryTerrainMinM: 0.25,
  },
  random: {
    fnvBasis: 2_166_136_261,
    fnvPrime: 16_777_619,
    zeroState: 0x6d2b79f5,
    divisor: 4_294_967_296,
    xorshiftA: 13,
    xorshiftB: 17,
    xorshiftC: 5,
    cellMixX: 73_856_093,
    cellMixZ: 19_349_663,
    cellMixLane: 83_492_791,
  },
  coast: {
    baseX: 24,
    primaryAmplitudeM: 18,
    primaryPeriodM: 165,
    secondaryAmplitudeM: 7,
    secondaryPeriodM: 61,
    beachWidthM: 34,
    bedEdgeDepthM: 0.8,
    bedSlope: 0.045,
    maxDepthM: 12,
    primaryPhaseSalt: 0x23a1,
    secondaryPhaseSalt: 0x71d3,
  },
  river: {
    baseZ: 520,
    bendAmplitudeM: 46,
    bendPeriodM: 205,
    secondaryAmplitudeM: 16,
    secondaryPeriodM: 83,
    downstreamBend: 0.035,
    baseHalfWidthM: 11,
    halfWidthAmplitudeM: 4,
    estuaryExtraHalfWidthM: 17,
    estuaryFadeM: 230,
    bedDepthM: 3.2,
    bedDepthAmplitudeM: 1.1,
    wetlandMarginM: 34,
    crossingApproachM: 46,
    crossingAllowedRadiusM: 92,
    causewayHalfWidthM: 7,
    causewayShoulderM: 1.5,
    causewayBankExtensionM: 12,
    causewayHeightM: 0.35,
    bendPhaseSalt: 0x19b7,
    secondaryPhaseSalt: 0xa531,
    widthPhaseSalt: 0x47c9,
  },
  terrain: {
    baseHeightM: 2.2,
    eastRiseM: 13,
    eastRiseStartX: 160,
    eastRiseSpanM: 860,
    waveXAmplitudeM: 1.35,
    waveXPeriodM: 119,
    waveZAmplitudeM: 1.05,
    waveZPeriodM: 93,
    mountainExtraHeightM: 30,
    forestRidgeExtraHeightM: 8,
    padElevationStepM: 0.5,
    padFeatherM: 2,
    padIndexCellM: 30,
    waveXPhaseSalt: 0x830f,
    waveZPhaseSalt: 0x36bd,
  },
  protectedLand: {
    mountain: { centerX: 875, centerZ: 125, radiusX: 135, radiusZ: 175 },
    forest: { centerX: 870, centerZ: 875, radiusX: 130, radiusZ: 170 },
    reserve: { centerX: 555, centerZ: 165, radiusX: 105, radiusZ: 72 },
    corridorPointStepM: 30,
  },
  districts: [
    { id: 'beachfront', name: 'West Beach', kind: 'beachfront', centerX: 170, centerZ: 250, radiusX: 78, radiusZ: 125, gridSpacingX: 48, gridSpacingZ: 54 },
    { id: 'northside', name: 'Northside', kind: 'mixed', centerX: 360, centerZ: 275, radiusX: 155, radiusZ: 120, gridSpacingX: 58, gridSpacingZ: 62 },
    { id: 'eastbank', name: 'Eastbank', kind: 'mixed', centerX: 725, centerZ: 300, radiusX: 125, radiusZ: 108, gridSpacingX: 62, gridSpacingZ: 66 },
    { id: 'harbor', name: 'Working Harbor', kind: 'industrial', centerX: 185, centerZ: 745, radiusX: 105, radiusZ: 145, gridSpacingX: 78, gridSpacingZ: 82 },
    { id: 'downtown', name: 'Downtown', kind: 'downtown', centerX: 455, centerZ: 755, radiusX: 155, radiusZ: 145, gridSpacingX: 52, gridSpacingZ: 58 },
    { id: 'southside', name: 'South Neighborhoods', kind: 'residential', centerX: 695, centerZ: 775, radiusX: 150, radiusZ: 145, gridSpacingX: 54, gridSpacingZ: 60 },
  ],
  districtJitterM: 12,
  districtGridInsetM: 12,
  districtRoadWarpM: 7,
  districtPathProbeStepM: 6,
  minDistrictGridLines: 2,
  roads: {
    highway: { lanesF: 2, lanesB: 2, sidewalks: false, tracks: 0, curveRadiusM: 12, speedLimitKph: 90 },
    arterial: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 10, speedLimitKph: 50 },
    collector: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 8, speedLimitKph: 40 },
    mainStreet: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 8, speedLimitKph: 30 },
    local: { lanesF: 1, lanesB: 1, sidewalks: true, tracks: 0, curveRadiusM: 6, speedLimitKph: 30 },
    laneWidthM: 3,
    opposingMedianM: 1,
    sidewalkWidthEachM: 2,
  },
  transportLayout: {
    crossings: {
      harbor: { id: 'harbor-causeway', name: 'Harbor Lift Causeway', x: 170 },
      central: { id: 'central-causeway', name: 'Central Transit Causeway', x: 460 },
      east: { id: 'eastbank-causeway', name: 'Eastbank Causeway', x: 760 },
    },
    coastHighway: { northZ: 30, northCoastOffsetM: 102, southZ: 990, southCoastOffsetM: 108 },
    centralAvenue: { northX: 400, northZ: 35, southX: 465, southZ: 995 },
    eastbankParkway: { northX: 680, northZ: 45, southX: 650, southZ: 990 },
    stateRoute8: { northX: 260, northZ: 25, northViaX: 355, northViaZ: 305, southX: 690, southZ: 965 },
    northArterial: [{ x: 90, z: 385 }, { x: 490, z: 365 }, { x: 840, z: 400 }],
    southArterial: [{ x: 80, z: 690 }, { x: 505, z: 710 }, { x: 835, z: 685 }],
    harborCollector: [{ x: 95, z: 845 }, { x: 285, z: 820 }, { x: 405, z: 760 }],
    railway: { northX: 260, northZ: 50, southX: 665, southZ: 985 },
    redLine: [{ x: 390, z: 85 }, { x: 460, z: 300 }, { x: 460, z: 930 }],
    blueLine: [{ x: 135, z: 700 }, { x: 460, z: 710 }, { x: 830, z: 705 }],
    goldLine: [{ x: 130, z: 310 }, { x: 460, z: 305 }, { x: 800, z: 315 }],
  },
  rail: {
    railwayTracks: 2,
    lightRailTracks: 2,
    railwayCurveRadiusM: 28,
    lightRailCurveRadiusM: 18,
    railwayMinCurveM: 12,
    lightRailMinCurveM: 6,
    maxCurveRadiusM: 96,
    minSegmentM: 0.5,
    turnReachSegmentFraction: 0.45,
    curveSamplesPerMeter: 1.5,
    minCurveSamplesPerCorner: 4,
    maxCurveSamplesPerCorner: 32,
    straightDotThreshold: 0.985,
    railwayMaxGrade: 0.04,
    lightRailMaxGrade: 0.09,
    railwayClearHalfWidthM: 5,
    lightRailClearHalfWidthM: 4,
  },
  sites: {
    startInsetM: 13,
    endInsetM: 12,
    localIntervalM: 25,
    mainStreetIntervalM: 22,
    collectorIntervalM: 28,
    arterialIntervalM: 34,
    intervalJitterM: 4,
    candidateChance: 0.72,
    setbackMinM: 2.5,
    setbackMaxM: 5.5,
    transportClearanceM: 1.25,
    railExtraClearanceM: 2.5,
    frontageMaxGapM: 8,
    overlapGapM: 1.5,
    footprintProbeM: 3,
    boundsInsetM: 2,
    maxTerrainReliefM: 2.5,
    dimensions: {
      downtownCore: { widths: [9, 12, 15], depths: [12, 15, 18], floorsMin: 4, floorsMax: 14 },
      harborIndustrial: { widths: [12, 15, 18], depths: [15, 18, 21], floorsMin: 1, floorsMax: 5 },
      mainStreetBusiness: { widths: [6, 9, 12], depths: [9, 12, 15], floorsMin: 1, floorsMax: 5 },
      mixedUse: { widths: [6, 9, 12], depths: [9, 12, 15], floorsMin: 2, floorsMax: 8 },
      residential: { widths: [6, 9], depths: [9, 12], floorsMin: 1, floorsMax: 3 },
      beachfront: { widths: [6, 9, 12], depths: [9, 12, 15], floorsMin: 2, floorsMax: 7 },
      transitOriented: { widths: [9, 12, 15], depths: [12, 15, 18], floorsMin: 3, floorsMax: 10 },
    },
  },
  flora: {
    infrastructureClearanceM: 1.5,
    clearanceIndexCellM: 30,
    ordinaryGrassChance: 0.68,
    lushGrassChance: 0.76,
    beachGrassChance: 0.16,
    wetlandReedChance: 0.72,
    mountainPineChance: 0.24,
    forestCedarChance: 0.52,
    ordinaryCedarChance: 0.018,
    wetlandBushChance: 0.12,
    forestBushChance: 0.28,
  },
  names: ['Alder Bay', 'Morrow Reach', 'Cedar Sound', 'Greywater', 'Port Vesper', 'Sable Inlet'],
} as const;

export const COASTAL_CITY_ZONES: readonly CoastalCityZone[] = [
  { id: 'beach', name: 'West Beach', color: '#d8c58b' },
  { id: 'wetland', name: 'Tidal Wetlands', color: '#7fa88a' },
  { id: 'mountain', name: 'Cascade Foothills', color: '#8e9b86' },
  { id: 'forest', name: 'Cedar Ridge Forest', color: '#477054' },
  { id: 'reserve', name: 'Growth Reserve', color: '#a8b890' },
  { id: 'downtown', name: 'Downtown', color: '#9b7aa5' },
  { id: 'harbor', name: 'Working Harbor', color: '#778694' },
  { id: 'neighborhoods', name: 'Neighborhoods', color: '#c39272' },
];

const STAGE_ORDER: readonly CoastalGenerationStage[] = ['terrain', 'protectedLand', 'transport', 'buildingSites'];
const DEG_PER_QUARTER = 90;
const FULL_TURN_DEGREES = 360;
const QUARTER_TURN_RADIANS = Math.PI / 2;

class XorShift32 {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || COASTAL_CITY_TUNING.random.zeroState; }
  next(): number {
    let x = this.state;
    x ^= x << COASTAL_CITY_TUNING.random.xorshiftA;
    x ^= x >>> COASTAL_CITY_TUNING.random.xorshiftB;
    x ^= x << COASTAL_CITY_TUNING.random.xorshiftC;
    this.state = x >>> 0;
    return this.state / COASTAL_CITY_TUNING.random.divisor;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
  pick<T>(values: readonly T[]): T { return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))]!; }
}

export function normalizeCoastalCitySeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new Error('coastal city seed must be finite');
  return Math.trunc(seed) >>> 0;
}

function labelHash(seed: number, label: string): number {
  let h = (COASTAL_CITY_TUNING.random.fnvBasis ^ seed) >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, COASTAL_CITY_TUNING.random.fnvPrime) >>> 0;
  }
  return h || COASTAL_CITY_TUNING.random.zeroState;
}

/** A named substream prevents a new draw in one stage/item reshuffling others. */
function rngFor(seed: number, stage: string, item = ''): XorShift32 {
  return new XorShift32(labelHash(seed, `${stage}:${item}`));
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function sq(value: number): number { return value * value; }
function ellipseMetric(x: number, z: number, area: { centerX: number; centerZ: number; radiusX: number; radiusZ: number }): number {
  return sq((x - area.centerX) / area.radiusX) + sq((z - area.centerZ) / area.radiusZ);
}
function seedPhase(seed: number, salt: number): number {
  return ((Math.imul(seed ^ salt, COASTAL_CITY_TUNING.random.fnvPrime) >>> 0) / COASTAL_CITY_TUNING.random.divisor) * Math.PI * 2;
}

export function coastXAt(z: number, seed: number): number {
  const s = normalizeCoastalCitySeed(seed);
  const c = COASTAL_CITY_TUNING.coast;
  return c.baseX
    + Math.sin(z / c.primaryPeriodM + seedPhase(s, c.primaryPhaseSalt)) * c.primaryAmplitudeM
    + Math.sin(z / c.secondaryPeriodM + seedPhase(s, c.secondaryPhaseSalt)) * c.secondaryAmplitudeM;
}

export function riverZAt(x: number, seed: number): number {
  const s = normalizeCoastalCitySeed(seed);
  const r = COASTAL_CITY_TUNING.river;
  const centeredX = x - (COASTAL_CITY_TUNING.world.minX + COASTAL_CITY_TUNING.world.maxX) / 2;
  return r.baseZ
    + Math.sin(x / r.bendPeriodM + seedPhase(s, r.bendPhaseSalt)) * r.bendAmplitudeM
    + Math.sin(x / r.secondaryPeriodM + seedPhase(s, r.secondaryPhaseSalt)) * r.secondaryAmplitudeM
    + centeredX * r.downstreamBend;
}

export function riverHalfWidthAt(x: number, seed: number): number {
  const r = COASTAL_CITY_TUNING.river;
  const coast = coastXAt(riverZAt(x, seed), seed);
  const estuary = clamp(1 - (x - coast) / r.estuaryFadeM, 0, 1);
  return r.baseHalfWidthM
    + Math.sin(x / r.secondaryPeriodM + seedPhase(normalizeCoastalCitySeed(seed), r.widthPhaseSalt)) * r.halfWidthAmplitudeM
    + estuary * r.estuaryExtraHalfWidthM;
}

export function isWaterAt(x: number, z: number, seed: number): boolean {
  if (x < coastXAt(z, seed)) return true;
  return x >= coastXAt(riverZAt(x, seed), seed) - COASTAL_CITY_TUNING.river.estuaryExtraHalfWidthM
    && Math.abs(z - riverZAt(x, seed)) <= riverHalfWidthAt(x, seed);
}

export function isBeachAt(x: number, z: number, seed: number): boolean {
  if (isWaterAt(x, z, seed)) return false;
  const shore = coastXAt(z, seed);
  return x >= shore && x <= shore + COASTAL_CITY_TUNING.coast.beachWidthM;
}

export function protectedLandKindAt(x: number, z: number, seed: number): CoastalProtectedKind | null {
  if (isBeachAt(x, z, seed)) return 'beach';
  if (!isWaterAt(x, z, seed)) {
    const riverDistance = Math.abs(z - riverZAt(x, seed));
    const wetlandOuter = riverHalfWidthAt(x, seed) + COASTAL_CITY_TUNING.river.wetlandMarginM;
    if (riverDistance <= wetlandOuter) return 'wetland';
  }
  const protectedTuning = COASTAL_CITY_TUNING.protectedLand;
  if (ellipseMetric(x, z, protectedTuning.mountain) <= 1) return 'mountain';
  if (ellipseMetric(x, z, protectedTuning.forest) <= 1) return 'forest';
  if (ellipseMetric(x, z, protectedTuning.reserve) <= 1) return 'reserve';
  return null;
}

export function isProtectedAt(x: number, z: number, seed: number): boolean {
  return protectedLandKindAt(x, z, seed) !== null;
}

function dryTerrainHeightAt(x: number, z: number, seed: number): number {
  const t = COASTAL_CITY_TUNING.terrain;
  const w = COASTAL_CITY_TUNING.world;
  const s = normalizeCoastalCitySeed(seed);
  const east = clamp((x - t.eastRiseStartX) / t.eastRiseSpanM, 0, 1) * t.eastRiseM;
  const waves = Math.sin(x / t.waveXPeriodM + seedPhase(s, t.waveXPhaseSalt)) * t.waveXAmplitudeM
    + Math.sin(z / t.waveZPeriodM + seedPhase(s, t.waveZPhaseSalt)) * t.waveZAmplitudeM;
  const mountainMetric = ellipseMetric(x, z, COASTAL_CITY_TUNING.protectedLand.mountain);
  const forestMetric = ellipseMetric(x, z, COASTAL_CITY_TUNING.protectedLand.forest);
  const ridge = Math.max(0, 1 - mountainMetric) * t.mountainExtraHeightM
    + Math.max(0, 1 - forestMetric) * t.forestRidgeExtraHeightM;
  return clamp(t.baseHeightM + east + waves + ridge, Math.max(w.dryTerrainMinM, w.terrainHeightMinM), w.terrainHeightMaxM);
}

export function terrainHeightAt(x: number, z: number, seed: number): number {
  const coast = coastXAt(z, seed);
  let depth = 0;
  if (x < coast) {
    const c = COASTAL_CITY_TUNING.coast;
    depth = clamp(c.bedEdgeDepthM + (coast - x) * c.bedSlope, c.bedEdgeDepthM, c.maxDepthM);
  }
  const riverDistance = Math.abs(z - riverZAt(x, seed));
  if (riverDistance <= riverHalfWidthAt(x, seed)) {
    const r = COASTAL_CITY_TUNING.river;
    const riverDepth = r.bedDepthM + Math.sin(x / r.bendPeriodM) * r.bedDepthAmplitudeM;
    depth = Math.max(depth, riverDepth);
  }
  return depth > 0
    ? clamp(-depth, COASTAL_CITY_TUNING.world.terrainHeightMinM, -COASTAL_CITY_TUNING.coast.bedEdgeDepthM)
    : dryTerrainHeightAt(x, z, seed);
}

export function waterDepthAt(x: number, z: number, seed: number): number {
  const height = terrainHeightAt(x, z, seed);
  return isWaterAt(x, z, seed) ? -height : 0;
}

function snap(value: number, step: number): number { return Math.round(value / step) * step; }
function snapModuleCenter(value: number): number {
  const world = COASTAL_CITY_TUNING.world;
  return Math.floor(value / world.buildModuleM) * world.buildModuleM + world.moduleCenterM;
}
function normalizeYaw(value: number): CoastalSiteYaw {
  const rounded = Math.round(value / DEG_PER_QUARTER) * DEG_PER_QUARTER;
  const yaw = ((rounded % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;
  return yaw as CoastalSiteYaw;
}

function point(x: number, z: number): CoastalPoint { return { x, z, elevationM: 0 }; }
function distance(a: { x: number; z: number }, b: { x: number; z: number }): number { return Math.hypot(b.x - a.x, b.z - a.z); }

function normalizePathPoints(raw: readonly CoastalPoint[]): readonly CoastalPoint[] {
  const step = COASTAL_CITY_TUNING.world.pathPointSnapM;
  const points: CoastalPoint[] = [];
  for (const source of raw) {
    if (![source.x, source.z, source.elevationM].every(Number.isFinite)) throw new Error('coastal path contains a non-finite point');
    const next = { x: snap(source.x, step), z: snap(source.z, step), elevationM: snap(source.elevationM, step) };
    const prior = points[points.length - 1];
    if (!prior || prior.x !== next.x || prior.z !== next.z || prior.elevationM !== next.elevationM) points.push(next);
  }
  // Validated simplification: only exactly collinear interior anchors are
  // removed. Nothing is sliced to fit the native cap.
  for (let i = points.length - 2; i > 0; i -= 1) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const elevationCollinear = (b.elevationM - a.elevationM) === (c.elevationM - b.elevationM);
    if (Math.abs(cross) < 1e-9 && elevationCollinear) points.splice(i, 1);
  }
  if (points.length < 2) throw new Error('coastal path requires at least two distinct points');
  if (points.length > COASTAL_CITY_TUNING.wire.maxPointsPerPath) {
    throw new Error(`coastal path has ${points.length} points; native cap is ${COASTAL_CITY_TUNING.wire.maxPointsPerPath}`);
  }
  return points;
}

function roadProfile(hierarchy: CoastalRoadHierarchy): CoastalPathProfile {
  const source = COASTAL_CITY_TUNING.roads[hierarchy];
  return { ...source };
}

function makeRoad(
  id: string,
  name: string,
  hierarchy: CoastalRoadHierarchy,
  rawPoints: readonly CoastalPoint[],
  options: { formalFrontage?: boolean; districtId?: string; crossingId?: string } = {},
): CoastalTransportPath {
  return {
    id, name, kind: 'road', hierarchy, profile: roadProfile(hierarchy),
    points: normalizePathPoints(rawPoints),
    formalFrontage: options.formalFrontage ?? false,
    districtId: options.districtId,
    crossingId: options.crossingId,
    generationStage: 'transport',
  };
}

function makeRail(
  id: string,
  name: string,
  kind: 'lightRail' | 'railway',
  rawPoints: readonly CoastalPoint[],
  crossingId?: string,
): CoastalTransportPath {
  const rail = COASTAL_CITY_TUNING.rail;
  return {
    id, name, kind, hierarchy: kind,
    profile: {
      lanesF: 0, lanesB: 0, sidewalks: false,
      tracks: kind === 'railway' ? rail.railwayTracks : rail.lightRailTracks,
      curveRadiusM: kind === 'railway' ? rail.railwayCurveRadiusM : rail.lightRailCurveRadiusM,
      speedLimitKph: 0,
    },
    points: normalizePathPoints(rawPoints),
    formalFrontage: false,
    crossingId,
    generationStage: 'transport',
  };
}

function roadWidthM(path: CoastalTransportPath): number {
  if (path.kind !== 'road') return path.kind === 'railway'
    ? COASTAL_CITY_TUNING.rail.railwayClearHalfWidthM * 2
    : COASTAL_CITY_TUNING.rail.lightRailClearHalfWidthM * 2;
  const p = path.profile;
  const roads = COASTAL_CITY_TUNING.roads;
  return (p.lanesF + p.lanesB) * roads.laneWidthM
    + (p.lanesF > 0 && p.lanesB > 0 ? roads.opposingMedianM : 0)
    + (p.sidewalks ? roads.sidewalkWidthEachM * 2 : 0);
}

type TransportClearanceSegment = { a: CoastalPoint; b: CoastalPoint; radiusM: number };
type TransportBucketIndex = { columns: number; rows: number; buckets: TransportClearanceSegment[][] };
const CURVED_PATH_CACHE = new WeakMap<object, readonly CoastalPoint[]>();

function transportClearanceSegments(paths: readonly CoastalTransportPath[]): TransportClearanceSegment[] {
  const segments: TransportClearanceSegment[] = [];
  for (const path of paths) {
    const radiusM = roadWidthM(path) / 2 + COASTAL_CITY_TUNING.flora.infrastructureClearanceM;
    const geometry = curvedPathPoints(path);
    for (let i = 0; i + 1 < geometry.length; i += 1) segments.push({ a: geometry[i]!, b: geometry[i + 1]!, radiusM });
  }
  return segments;
}

function crossingAt(id: string, name: string, x: number, seed: number): CoastalCrossing {
  return { id, name, kind: 'causeway', x, z: riverZAt(x, seed), pathIds: [] };
}

function crossingRoute(crossing: CoastalCrossing, north: { x: number; z: number }, south: { x: number; z: number }, seed: number): CoastalPoint[] {
  const half = riverHalfWidthAt(crossing.x, seed);
  const approach = COASTAL_CITY_TUNING.river.crossingApproachM;
  return [
    point(north.x, north.z),
    point(crossing.x, crossing.z - half - approach),
    point(crossing.x, crossing.z + half + approach),
    point(south.x, south.z),
  ];
}

function samplePath(path: CoastalTransportPath, atM: number): { point: { x: number; z: number }; tangent: { x: number; z: number } } | null {
  const geometry = curvedPathPoints(path);
  let remaining = atM;
  for (let i = 0; i + 1 < geometry.length; i += 1) {
    const a = geometry[i]!, b = geometry[i + 1]!;
    const length = distance(a, b);
    if (remaining <= length || i + 2 === geometry.length) {
      const t = length > 0 ? clamp(remaining / length, 0, 1) : 0;
      return {
        point: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
        tangent: { x: length > 0 ? (b.x - a.x) / length : 1, z: length > 0 ? (b.z - a.z) / length : 0 },
      };
    }
    remaining -= length;
  }
  return null;
}

function pathLength(path: CoastalTransportPath): number {
  const geometry = curvedPathPoints(path);
  let length = 0;
  for (let i = 0; i + 1 < geometry.length; i += 1) length += distance(geometry[i]!, geometry[i + 1]!);
  return length;
}

function pathIsDryAndUnprotected(path: CoastalTransportPath, seed: number): boolean {
  const points = curvedPathPoints(path);
  const probeStep = COASTAL_CITY_TUNING.districtPathProbeStepM;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    const length = distance(a, b);
    const steps = Math.max(1, Math.ceil(length / probeStep));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (isWaterAt(x, z, seed) || isProtectedAt(x, z, seed)) return false;
    }
  }
  return true;
}

function makeDistricts(seed: number): CoastalDistrict[] {
  return COASTAL_CITY_TUNING.districts.map((source) => {
    const rng = rngFor(seed, 'districts', source.id);
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      center: {
        x: snap(source.centerX + rng.range(-COASTAL_CITY_TUNING.districtJitterM, COASTAL_CITY_TUNING.districtJitterM), COASTAL_CITY_TUNING.world.pathPointSnapM),
        z: snap(source.centerZ + rng.range(-COASTAL_CITY_TUNING.districtJitterM, COASTAL_CITY_TUNING.districtJitterM), COASTAL_CITY_TUNING.world.pathPointSnapM),
      },
      radiusX: source.radiusX,
      radiusZ: source.radiusZ,
    } as CoastalDistrict;
  });
}

function buildDistrictRoads(seed: number, districts: readonly CoastalDistrict[]): CoastalTransportPath[] {
  const roads: CoastalTransportPath[] = [];
  for (const district of districts) {
    const config = COASTAL_CITY_TUNING.districts.find((row) => row.id === district.id)!;
    const minX = district.center.x - district.radiusX + COASTAL_CITY_TUNING.districtGridInsetM;
    const maxX = district.center.x + district.radiusX - COASTAL_CITY_TUNING.districtGridInsetM;
    const minZ = district.center.z - district.radiusZ + COASTAL_CITY_TUNING.districtGridInsetM;
    const maxZ = district.center.z + district.radiusZ - COASTAL_CITY_TUNING.districtGridInsetM;
    const horizontalCount = Math.max(COASTAL_CITY_TUNING.minDistrictGridLines, Math.floor((maxZ - minZ) / config.gridSpacingZ));
    const verticalCount = Math.max(COASTAL_CITY_TUNING.minDistrictGridLines, Math.floor((maxX - minX) / config.gridSpacingX));
    for (let row = 0; row <= horizontalCount; row += 1) {
      const z = minZ + (maxZ - minZ) * (row / horizontalCount);
      const id = `road-${district.id}-east-west-${row + 1}`;
      const rng = rngFor(seed, 'districtRoads', id);
      const raw = [point(minX, z), point((minX + maxX) / 2, z + rng.range(-COASTAL_CITY_TUNING.districtRoadWarpM, COASTAL_CITY_TUNING.districtRoadWarpM)), point(maxX, z)];
      const hierarchy: CoastalRoadHierarchy = row === Math.floor(horizontalCount / 2) ? 'mainStreet' : 'local';
      const candidate = makeRoad(id, `${district.name} ${row === Math.floor(horizontalCount / 2) ? 'Main Street' : `Street ${row + 1}`}`, hierarchy, raw, { formalFrontage: true, districtId: district.id });
      if (pathIsDryAndUnprotected(candidate, seed)) roads.push(candidate);
    }
    for (let col = 0; col <= verticalCount; col += 1) {
      const x = minX + (maxX - minX) * (col / verticalCount);
      const id = `road-${district.id}-north-south-${col + 1}`;
      const rng = rngFor(seed, 'districtRoads', id);
      const raw = [point(x, minZ), point(x + rng.range(-COASTAL_CITY_TUNING.districtRoadWarpM, COASTAL_CITY_TUNING.districtRoadWarpM), (minZ + maxZ) / 2), point(x, maxZ)];
      const hierarchy: CoastalRoadHierarchy = col === Math.floor(verticalCount / 2) ? 'collector' : 'local';
      const candidate = makeRoad(id, `${district.name} ${hierarchy === 'collector' ? 'Connector' : `Avenue ${col + 1}`}`, hierarchy, raw, { formalFrontage: true, districtId: district.id });
      if (pathIsDryAndUnprotected(candidate, seed)) roads.push(candidate);
    }
  }
  return roads;
}

function buildTransport(seed: number, districts: readonly CoastalDistrict[]): { paths: CoastalTransportPath[]; crossings: CoastalCrossing[] } {
  const layout = COASTAL_CITY_TUNING.transportLayout;
  const harbor = crossingAt(layout.crossings.harbor.id, layout.crossings.harbor.name, layout.crossings.harbor.x, seed);
  const central = crossingAt(layout.crossings.central.id, layout.crossings.central.name, layout.crossings.central.x, seed);
  const east = crossingAt(layout.crossings.east.id, layout.crossings.east.name, layout.crossings.east.x, seed);
  const crossings = [harbor, central, east];
  const paths: CoastalTransportPath[] = [];

  paths.push(makeRoad('road-coast-highway', 'Coast Highway', 'arterial', crossingRoute(
    harbor,
    { x: coastXAt(layout.coastHighway.northZ, seed) + layout.coastHighway.northCoastOffsetM, z: layout.coastHighway.northZ },
    { x: coastXAt(layout.coastHighway.southZ, seed) + layout.coastHighway.southCoastOffsetM, z: layout.coastHighway.southZ },
    seed,
  ), { formalFrontage: true, crossingId: harbor.id }));
  paths.push(makeRoad('road-central-avenue', 'Central Avenue', 'arterial', crossingRoute(
    central,
    { x: layout.centralAvenue.northX, z: layout.centralAvenue.northZ },
    { x: layout.centralAvenue.southX, z: layout.centralAvenue.southZ },
    seed,
  ), { formalFrontage: true, crossingId: central.id }));
  paths.push(makeRoad('road-eastbank-parkway', 'Eastbank Parkway', 'arterial', crossingRoute(
    east,
    { x: layout.eastbankParkway.northX, z: layout.eastbankParkway.northZ },
    { x: layout.eastbankParkway.southX, z: layout.eastbankParkway.southZ },
    seed,
  ), { formalFrontage: true, crossingId: east.id }));
  const stateRoute8 = crossingRoute(
    east,
    { x: layout.stateRoute8.northX, z: layout.stateRoute8.northZ },
    { x: layout.stateRoute8.southX, z: layout.stateRoute8.southZ },
    seed,
  );
  stateRoute8.splice(1, 0, point(layout.stateRoute8.northViaX, layout.stateRoute8.northViaZ));
  paths.push(makeRoad('road-state-route-8', 'State Route 8', 'highway', stateRoute8, { crossingId: east.id }));
  paths.push(makeRoad('road-north-arterial', 'Alder Boulevard', 'arterial', layout.northArterial.map((p) => point(p.x, p.z)), { formalFrontage: true }));
  paths.push(makeRoad('road-south-arterial', 'Division Way', 'arterial', layout.southArterial.map((p) => point(p.x, p.z)), { formalFrontage: true }));
  paths.push(makeRoad('road-harbor-collector', 'Harbor Freight Road', 'collector', layout.harborCollector.map((p) => point(p.x, p.z)), { formalFrontage: true, districtId: 'harbor' }));

  paths.push(...buildDistrictRoads(seed, districts));

  // Rail alignments are flat in terrain-relative elevation. Straight or broad
  // bends keep them comfortably inside transport.zig's 6m/12m curve minima.
  paths.push(makeRail('rail-coast-regional', 'Coast Freight & Regional', 'railway', [
    point(layout.railway.northX, layout.railway.northZ),
    point(layout.crossings.central.x, central.z),
    point(layout.railway.southX, layout.railway.southZ),
  ], central.id));
  paths.push(makeRail('tram-red', 'Red Line', 'lightRail', [
    ...layout.redLine.map((p) => point(p.x, p.z)),
  ], central.id));
  // The slight broad bends keep the shared Red-Line interchange as an authored
  // anchor (an exactly collinear middle point would be validly simplified).
  paths.push(makeRail('tram-blue', 'Blue Line', 'lightRail', layout.blueLine.map((p) => point(p.x, p.z))));
  paths.push(makeRail('tram-gold', 'Gold Line', 'lightRail', layout.goldLine.map((p) => point(p.x, p.z))));

  const crossingPaths = new Map<string, string[]>();
  for (const path of paths) if (path.crossingId) {
    const ids = crossingPaths.get(path.crossingId) ?? [];
    ids.push(path.id);
    crossingPaths.set(path.crossingId, ids);
  }
  const resolvedCrossings = crossings.map((crossing) => ({ ...crossing, pathIds: crossingPaths.get(crossing.id) ?? [] }));
  validateTransport(paths, resolvedCrossings, seed);
  return { paths, crossings: resolvedCrossings };
}

function turnReach(a: CoastalPoint, b: CoastalPoint, c: CoastalPoint, radiusM: number): number | null {
  const ab = distance(a, b), bc = distance(b, c);
  if (ab < COASTAL_CITY_TUNING.rail.minSegmentM || bc < COASTAL_CITY_TUNING.rail.minSegmentM) return 0;
  const dot = ((b.x - a.x) / ab) * ((c.x - b.x) / bc) + ((b.z - a.z) / ab) * ((c.z - b.z) / bc);
  if (dot > COASTAL_CITY_TUNING.rail.straightDotThreshold) return null;
  return Math.min(radiusM, ab * COASTAL_CITY_TUNING.rail.turnReachSegmentFraction, bc * COASTAL_CITY_TUNING.rail.turnReachSegmentFraction);
}

/** Mirror transport.zig curvePoints: this is the line native rendering, road
 * stamping, and gameplay sampling consume—not merely the editable chords. */
function curvedPathPoints(path: CoastalTransportPath): readonly CoastalPoint[] {
  const cached = CURVED_PATH_CACHE.get(path);
  if (cached) return cached;
  const authored = path.points;
  const radiusM = path.profile.curveRadiusM;
  if (authored.length < 3 || radiusM <= 0) {
    CURVED_PATH_CACHE.set(path, authored);
    return authored;
  }
  const out: CoastalPoint[] = [authored[0]!];
  for (let i = 1; i + 1 < authored.length; i += 1) {
    const a = authored[i - 1]!, vertex = authored[i]!, b = authored[i + 1]!;
    const incoming = distance(a, vertex), outgoing = distance(vertex, b);
    const reach = turnReach(a, vertex, b, radiusM);
    if (reach === null || reach < COASTAL_CITY_TUNING.rail.minSegmentM || incoming === 0 || outgoing === 0) {
      out.push(vertex);
      continue;
    }
    const r = reach;
    const inX = (vertex.x - a.x) / incoming, inZ = (vertex.z - a.z) / incoming;
    const outX = (b.x - vertex.x) / outgoing, outZ = (b.z - vertex.z) / outgoing;
    const p1 = {
      x: vertex.x - inX * r,
      z: vertex.z - inZ * r,
      elevationM: vertex.elevationM - (vertex.elevationM - a.elevationM) * (r / incoming),
    };
    const p2 = {
      x: vertex.x + outX * r,
      z: vertex.z + outZ * r,
      elevationM: vertex.elevationM + (b.elevationM - vertex.elevationM) * (r / outgoing),
    };
    const wanted = Math.ceil(r * COASTAL_CITY_TUNING.rail.curveSamplesPerMeter);
    const samples = clamp(wanted, COASTAL_CITY_TUNING.rail.minCurveSamplesPerCorner, COASTAL_CITY_TUNING.rail.maxCurveSamplesPerCorner);
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = sample / samples, omt = 1 - t;
      out.push({
        x: omt * omt * p1.x + 2 * omt * t * vertex.x + t * t * p2.x,
        z: omt * omt * p1.z + 2 * omt * t * vertex.z + t * t * p2.z,
        elevationM: omt * omt * p1.elevationM + 2 * omt * t * vertex.elevationM + t * t * p2.elevationM,
      });
    }
  }
  out.push(authored[authored.length - 1]!);
  CURVED_PATH_CACHE.set(path, out);
  return out;
}

function validateRailPath(path: CoastalTransportPath): void {
  if (path.kind === 'road') return;
  const requiredCurve = path.kind === 'railway' ? COASTAL_CITY_TUNING.rail.railwayMinCurveM : COASTAL_CITY_TUNING.rail.lightRailMinCurveM;
  const maxGrade = path.kind === 'railway' ? COASTAL_CITY_TUNING.rail.railwayMaxGrade : COASTAL_CITY_TUNING.rail.lightRailMaxGrade;
  for (let i = 0; i + 1 < path.points.length; i += 1) {
    const a = path.points[i]!, b = path.points[i + 1]!;
    const horizontal = distance(a, b);
    if (horizontal < COASTAL_CITY_TUNING.rail.minSegmentM) throw new Error(`${path.id} has a short rail segment`);
    if (Math.abs(b.elevationM - a.elevationM) / horizontal > maxGrade) throw new Error(`${path.id} exceeds native rail grade`);
  }
  for (let i = 1; i + 1 < path.points.length; i += 1) {
    const reach = turnReach(path.points[i - 1]!, path.points[i]!, path.points[i + 1]!, path.profile.curveRadiusM);
    if (reach !== null && reach < requiredCurve) throw new Error(`${path.id} is tighter than native rail curve minimum`);
  }
}

function pointNearCrossing(x: number, z: number, crossing: CoastalCrossing): boolean {
  return Math.hypot(x - crossing.x, z - crossing.z) <= COASTAL_CITY_TUNING.river.crossingAllowedRadiusM;
}

function validateTransport(paths: readonly CoastalTransportPath[], crossings: readonly CoastalCrossing[], seed: number): void {
  if (paths.length > COASTAL_CITY_TUNING.wire.maxPaths) throw new Error(`coastal plan has ${paths.length} paths; native cap is ${COASTAL_CITY_TUNING.wire.maxPaths}`);
  const ids = new Set<string>();
  const crossingById = new Map(crossings.map((crossing) => [crossing.id, crossing]));
  for (const path of paths) {
    if (ids.has(path.id)) throw new Error(`duplicate coastal path id ${path.id}`);
    ids.add(path.id);
    if (path.points.length > COASTAL_CITY_TUNING.wire.maxPointsPerPath) throw new Error(`${path.id} exceeds native point cap`);
    validateRailPath(path);
    const namedCrossing = path.crossingId ? crossingById.get(path.crossingId) : undefined;
    const geometry = curvedPathPoints(path);
    for (let i = 0; i + 1 < geometry.length; i += 1) {
      const a = geometry[i]!, b = geometry[i + 1]!;
      const length = distance(a, b);
      const probes = Math.max(1, Math.ceil(length / COASTAL_CITY_TUNING.districtPathProbeStepM));
      for (let sample = 0; sample <= probes; sample += 1) {
        const t = sample / probes;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (isWaterAt(x, z, seed) && (!namedCrossing || !pointNearCrossing(x, z, namedCrossing))) {
          throw new Error(`${path.id} enters water outside a named crossing`);
        }
        const protectedKind = protectedLandKindAt(x, z, seed);
        const crossingWetland = protectedKind === 'wetland' && namedCrossing && pointNearCrossing(x, z, namedCrossing);
        if (protectedKind && !crossingWetland) {
          throw new Error(`${path.id} enters protected ${protectedKind} land`);
        }
      }
    }
  }
}

export function buildingSiteBounds(site: Pick<CoastalBuildingSite, 'x' | 'z' | 'widthM' | 'depthM' | 'yawDegrees'>, gapM = 0): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const turnsOdd = site.yawDegrees === 90 || site.yawDegrees === 270;
  const spanX = turnsOdd ? site.depthM : site.widthM;
  const spanZ = turnsOdd ? site.widthM : site.depthM;
  return { minX: site.x - spanX / 2 - gapM, maxX: site.x + spanX / 2 + gapM, minZ: site.z - spanZ / 2 - gapM, maxZ: site.z + spanZ / 2 + gapM };
}

function rectsOverlap(a: { minX: number; minZ: number; maxX: number; maxZ: number }, b: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function pointSegmentDistance(x: number, z: number, a: CoastalPoint, b: CoastalPoint): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const denom = dx * dx + dz * dz;
  const t = denom > 0 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / denom, 0, 1) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function segmentIntersectsRect(a: CoastalPoint, b: CoastalPoint, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  let lo = 0, hi = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const tests: readonly [number, number][] = [
    [-dx, a.x - rect.minX], [dx, rect.maxX - a.x],
    [-dz, a.z - rect.minZ], [dz, rect.maxZ - a.z],
  ];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
    if (lo > hi) return false;
  }
  return true;
}

function pointRectDistance(x: number, z: number, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

function segmentRectDistance(a: CoastalPoint, b: CoastalPoint, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): number {
  if (segmentIntersectsRect(a, b, rect)) return 0;
  let best = Math.min(pointRectDistance(a.x, a.z, rect), pointRectDistance(b.x, b.z, rect));
  const corners = [
    { x: rect.minX, z: rect.minZ }, { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ }, { x: rect.minX, z: rect.maxZ },
  ];
  for (const corner of corners) best = Math.min(best, pointSegmentDistance(corner.x, corner.z, a, b));
  return best;
}

function pathRectDistance(path: CoastalTransportPath, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): number {
  const geometry = curvedPathPoints(path);
  let best = Infinity;
  for (let i = 0; i + 1 < geometry.length; i += 1) best = Math.min(best, segmentRectDistance(geometry[i]!, geometry[i + 1]!, rect));
  return best;
}

function intendedUse(path: CoastalTransportPath, district?: CoastalDistrict): CoastalIntendedUse {
  if (path.hierarchy === 'mainStreet') return 'mainStreetBusiness';
  if (path.id === 'road-central-avenue' || path.id === 'road-south-arterial') return 'transitOriented';
  if (district?.kind === 'downtown') return 'downtownCore';
  if (district?.kind === 'industrial') return 'harborIndustrial';
  if (district?.kind === 'residential') return 'residential';
  if (district?.kind === 'beachfront') return 'beachfront';
  return 'mixedUse';
}

function siteInterval(path: CoastalTransportPath): number {
  const s = COASTAL_CITY_TUNING.sites;
  switch (path.hierarchy) {
    case 'mainStreet': return s.mainStreetIntervalM;
    case 'collector': return s.collectorIntervalM;
    case 'arterial': return s.arterialIntervalM;
    default: return s.localIntervalM;
  }
}

function footprintIsBuildable(candidate: CoastalBuildingSite, seed: number): { valid: boolean; relief: number } {
  const bounds = buildingSiteBounds(candidate);
  const world = COASTAL_CITY_TUNING.world;
  const inset = COASTAL_CITY_TUNING.sites.boundsInsetM;
  if (bounds.minX < world.minX + inset || bounds.maxX > world.maxX - inset || bounds.minZ < world.minZ + inset || bounds.maxZ > world.maxZ - inset) return { valid: false, relief: Infinity };
  let minHeight = Infinity, maxHeight = -Infinity;
  const step = COASTAL_CITY_TUNING.sites.footprintProbeM;
  for (let z = bounds.minZ; z <= bounds.maxZ + 1e-6; z += step) for (let x = bounds.minX; x <= bounds.maxX + 1e-6; x += step) {
    const px = Math.min(x, bounds.maxX), pz = Math.min(z, bounds.maxZ);
    if (isWaterAt(px, pz, seed) || isProtectedAt(px, pz, seed)) return { valid: false, relief: Infinity };
    const height = terrainHeightAt(px, pz, seed);
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  const relief = maxHeight - minHeight;
  return { valid: relief <= COASTAL_CITY_TUNING.sites.maxTerrainReliefM, relief };
}

function transportClearsSite(candidate: CoastalBuildingSite, frontage: CoastalTransportPath, paths: readonly CoastalTransportPath[]): boolean {
  const bounds = buildingSiteBounds(candidate);
  const tuning = COASTAL_CITY_TUNING.sites;
  for (const path of paths) {
    const halfWidth = roadWidthM(path) / 2;
    const railExtra = path.kind === 'road' ? 0 : tuning.railExtraClearanceM;
    const clearance = halfWidth + tuning.transportClearanceM + railExtra;
    if (pathRectDistance(path, bounds) < clearance - 1e-6) return false;
  }
  const frontageDistance = pathRectDistance(frontage, bounds);
  return frontageDistance <= roadWidthM(frontage) / 2 + tuning.frontageMaxGapM;
}

function buildSites(seed: number, paths: readonly CoastalTransportPath[], districts: readonly CoastalDistrict[]): { sites: CoastalBuildingSite[]; rejected: number } {
  const sites: CoastalBuildingSite[] = [];
  let rejected = 0;
  const districtById = new Map(districts.map((district) => [district.id, district]));
  for (const frontage of paths.filter((path) => path.kind === 'road' && path.formalFrontage && path.hierarchy !== 'highway')) {
    const length = pathLength(frontage);
    const rng = rngFor(seed, 'buildingSites', frontage.id);
    const interval = siteInterval(frontage);
    let cursor = COASTAL_CITY_TUNING.sites.startInsetM + rng.range(0, COASTAL_CITY_TUNING.sites.intervalJitterM);
    let ordinal = 0;
    while (cursor <= length - COASTAL_CITY_TUNING.sites.endInsetM) {
      const sampled = samplePath(frontage, cursor);
      if (!sampled) break;
      for (const side of [-1, 1] as const) {
        ordinal += 1;
        if (rng.next() > COASTAL_CITY_TUNING.sites.candidateChance) { rejected += 1; continue; }
        const district = frontage.districtId ? districtById.get(frontage.districtId) : undefined;
        const use = intendedUse(frontage, district);
        const dimensions = COASTAL_CITY_TUNING.sites.dimensions[use];
        const widthM = rng.pick(dimensions.widths);
        const depthM = rng.pick(dimensions.depths);
        const yawDegrees = normalizeYaw(Math.atan2(sampled.tangent.z, sampled.tangent.x) / QUARTER_TURN_RADIANS * DEG_PER_QUARTER);
        const normal = { x: -sampled.tangent.z * side, z: sampled.tangent.x * side };
        const turnsOdd = yawDegrees === 90 || yawDegrees === 270;
        const halfX = (turnsOdd ? depthM : widthM) / 2;
        const halfZ = (turnsOdd ? widthM : depthM) / 2;
        const perpendicularHalf = Math.abs(normal.x) * halfX + Math.abs(normal.z) * halfZ;
        const setback = rng.range(COASTAL_CITY_TUNING.sites.setbackMinM, COASTAL_CITY_TUNING.sites.setbackMaxM);
        const offset = roadWidthM(frontage) / 2 + COASTAL_CITY_TUNING.sites.transportClearanceM + setback + perpendicularHalf;
        const x = snapModuleCenter(sampled.point.x + normal.x * offset);
        const z = snapModuleCenter(sampled.point.z + normal.z * offset);
        const elevationStep = COASTAL_CITY_TUNING.terrain.padElevationStepM;
        const y = snap(terrainHeightAt(x, z, seed), elevationStep);
        const candidate: CoastalBuildingSite = {
          id: `site-${frontage.id}-${ordinal}-${side < 0 ? 'right' : 'left'}`,
          intendedUse: use,
          widthM,
          depthM,
          suggestedMaxFloors: rng.int(dimensions.floorsMin, dimensions.floorsMax),
          frontagePathId: frontage.id,
          x, y, z, yawDegrees,
          generationStage: 'buildingSites',
        };
        if (!footprintIsBuildable(candidate, seed).valid || !transportClearsSite(candidate, frontage, paths)) { rejected += 1; continue; }
        const padded = buildingSiteBounds(candidate, COASTAL_CITY_TUNING.sites.overlapGapM);
        if (sites.some((other) => rectsOverlap(padded, buildingSiteBounds(other, COASTAL_CITY_TUNING.sites.overlapGapM)))) { rejected += 1; continue; }
        sites.push(candidate);
      }
      cursor += interval + rng.range(-COASTAL_CITY_TUNING.sites.intervalJitterM, COASTAL_CITY_TUNING.sites.intervalJitterM);
    }
  }
  return { sites, rejected };
}

function makeChunks(): { cx: number; cz: number }[] {
  const chunks: { cx: number; cz: number }[] = [];
  for (let cz = 0; cz < COASTAL_CITY_TUNING.wire.chunkRows; cz += 1) {
    for (let cx = 0; cx < COASTAL_CITY_TUNING.wire.chunkColumns; cx += 1) chunks.push({ cx, cz });
  }
  return chunks;
}

function makeLandUses(seed: number): CoastalLandUse[] {
  const points: { x: number; z: number }[] = [];
  const step = COASTAL_CITY_TUNING.protectedLand.corridorPointStepM;
  for (let x = COASTAL_CITY_TUNING.world.minX; x <= COASTAL_CITY_TUNING.world.maxX; x += step) points.push({ x, z: riverZAt(x, seed) });
  const p = COASTAL_CITY_TUNING.protectedLand;
  return [
    { id: 'west-beach', name: 'West Beach', kind: 'beach', protected: true, shape: 'corridor', points: [
      { x: coastXAt(COASTAL_CITY_TUNING.world.minZ, seed), z: COASTAL_CITY_TUNING.world.minZ },
      { x: coastXAt(COASTAL_CITY_TUNING.world.maxZ, seed), z: COASTAL_CITY_TUNING.world.maxZ },
    ], generationStage: 'protectedLand' },
    { id: 'tidal-wetland', name: 'Tidal Wetlands & Floodplain', kind: 'wetland', protected: true, shape: 'corridor', points, generationStage: 'protectedLand' },
    { id: 'cascade-foothills', name: 'Cascade Foothills', kind: 'mountain', protected: true, shape: 'ellipse', center: { x: p.mountain.centerX, z: p.mountain.centerZ }, radiusX: p.mountain.radiusX, radiusZ: p.mountain.radiusZ, generationStage: 'protectedLand' },
    { id: 'cedar-ridge', name: 'Cedar Ridge Forest', kind: 'forest', protected: true, shape: 'ellipse', center: { x: p.forest.centerX, z: p.forest.centerZ }, radiusX: p.forest.radiusX, radiusZ: p.forest.radiusZ, generationStage: 'protectedLand' },
    { id: 'growth-reserve', name: 'Valley Growth Reserve', kind: 'reserve', protected: true, shape: 'ellipse', center: { x: p.reserve.centerX, z: p.reserve.centerZ }, radiusX: p.reserve.radiusX, radiusZ: p.reserve.radiusZ, generationStage: 'protectedLand' },
  ];
}

export function generateCoastalCity(seed: number): CoastalCityPlan {
  const normalizedSeed = normalizeCoastalCitySeed(seed);
  const districts = makeDistricts(normalizedSeed);
  const { paths, crossings } = buildTransport(normalizedSeed, districts);
  // This call is intentionally after the complete path array: frontage sites
  // are derived output, never an input that roads route around after the fact.
  const built = buildSites(normalizedSeed, paths, districts);
  const chunks = makeChunks();
  const roadCount = paths.filter((path) => path.kind === 'road').length;
  const lightRailCount = paths.filter((path) => path.kind === 'lightRail').length;
  const railwayCount = paths.filter((path) => path.kind === 'railway').length;
  const nameRng = rngFor(normalizedSeed, 'name');
  return {
    version: COASTAL_CITY_TUNING.wire.version,
    seed: normalizedSeed,
    name: `${nameRng.pick(COASTAL_CITY_TUNING.names)} · ${normalizedSeed}`,
    bounds: {
      minX: COASTAL_CITY_TUNING.world.minX,
      minZ: COASTAL_CITY_TUNING.world.minZ,
      maxX: COASTAL_CITY_TUNING.world.maxX,
      maxZ: COASTAL_CITY_TUNING.world.maxZ,
    },
    chunks,
    zones: COASTAL_CITY_ZONES,
    landUses: makeLandUses(normalizedSeed),
    districts,
    crossings,
    paths,
    sites: built.sites,
    stageOrder: STAGE_ORDER,
    stats: {
      chunkCount: chunks.length,
      pathCount: paths.length,
      roadCount,
      lightRailCount,
      railwayCount,
      siteCount: built.sites.length,
      rejectedSiteCount: built.rejected,
      maxPointsPerPath: Math.max(...paths.map((path) => path.points.length)),
      infrastructureCompleteBeforeSites: true,
    },
  };
}

function siteHeightAt(sites: readonly CoastalBuildingSite[], x: number, z: number, base: number): number {
  let height = base;
  let bestWeight = 0;
  const feather = COASTAL_CITY_TUNING.terrain.padFeatherM;
  for (const site of sites) {
    const rect = buildingSiteBounds(site);
    const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
    const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
    const outside = Math.hypot(dx, dz);
    if (outside > feather) continue;
    const weight = outside === 0 ? 1 : 1 - outside / feather;
    if (weight > bestWeight) { height = base + (site.y - base) * weight; bestWeight = weight; }
  }
  return height;
}

/** Terrain actually packed for a plan: accepted floor footprints are level. */
export function terrainHeightForPlanAt(plan: CoastalCityPlan, x: number, z: number): number {
  const base = terrainHeightAt(x, z, plan.seed);
  if (coastalCityCausewayAt(plan, x, z)) return Math.max(base, COASTAL_CITY_TUNING.river.causewayHeightM);
  return isWaterAt(x, z, plan.seed) ? base : siteHeightAt(plan.sites, x, z, base);
}

/** The named dry crossing corridor at a point, or null on ordinary terrain. */
export function coastalCityCausewayAt(plan: CoastalCityPlan, x: number, z: number): CoastalCrossing | null {
  const river = COASTAL_CITY_TUNING.river;
  for (const crossing of plan.crossings) {
    const span = riverHalfWidthAt(crossing.x, plan.seed) + river.causewayBankExtensionM;
    if (Math.hypot(x - crossing.x, z - crossing.z) > span) continue;
    for (const path of plan.paths) {
      if (path.crossingId !== crossing.id) continue;
      const halfWidth = Math.max(river.causewayHalfWidthM, roadWidthM(path) / 2 + river.causewayShoulderM);
      const geometry = curvedPathPoints(path);
      for (let i = 0; i + 1 < geometry.length; i += 1) {
        if (pointSegmentDistance(x, z, geometry[i]!, geometry[i + 1]!) <= halfWidth) return crossing;
      }
    }
  }
  return null;
}

/** Water after authored causeways have replaced their portion of the bed. */
export function isWaterForPlanAt(plan: CoastalCityPlan, x: number, z: number): boolean {
  return isWaterAt(x, z, plan.seed) && coastalCityCausewayAt(plan, x, z) === null;
}

export function waterDepthForPlanAt(plan: CoastalCityPlan, x: number, z: number): number {
  if (!isWaterForPlanAt(plan, x, z)) return 0;
  return -terrainHeightAt(x, z, plan.seed);
}

function pointInsideRect(x: number, z: number, rect: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/**
 * The authored-infrastructure flora mask. Paths are wider than their
 * centerline and floor pads occupy their full accepted footprint; native road
 * restamping does not clear flora, so the source painting must reserve both.
 */
export function coastalCityFloraAllowedAt(plan: CoastalCityPlan, x: number, z: number): boolean {
  if (isWaterForPlanAt(plan, x, z)) return false;
  for (const site of plan.sites) if (pointInsideRect(x, z, buildingSiteBounds(site))) return false;
  return !coastalCityTransportClearanceAt(plan, x, z);
}

/** True inside the native-curved road/rail footprint plus flora shoulder. */
export function coastalCityTransportClearanceAt(plan: CoastalCityPlan, x: number, z: number): boolean {
  for (const segment of transportClearanceSegments(plan.paths)) {
    if (pointSegmentDistance(x, z, segment.a, segment.b) <= segment.radiusM) return true;
  }
  return false;
}

function zoneIndexAt(plan: CoastalCityPlan, x: number, z: number): number {
  const protectedKind = protectedLandKindAt(x, z, plan.seed);
  if (protectedKind) return COASTAL_CITY_ZONES.findIndex((zone) => zone.id === protectedKind);
  let nearest: CoastalDistrict | undefined;
  let metric = Infinity;
  for (const district of plan.districts) {
    const current = sq((x - district.center.x) / district.radiusX) + sq((z - district.center.z) / district.radiusZ);
    if (current <= 1 && current < metric) { nearest = district; metric = current; }
  }
  if (!nearest) return COASTAL_CITY_TUNING.wire.emptyCell;
  if (nearest.kind === 'downtown') return COASTAL_CITY_ZONES.findIndex((zone) => zone.id === 'downtown');
  if (nearest.kind === 'industrial') return COASTAL_CITY_ZONES.findIndex((zone) => zone.id === 'harbor');
  return COASTAL_CITY_ZONES.findIndex((zone) => zone.id === 'neighborhoods');
}

function cellNoise(seed: number, x: number, z: number, lane: number): number {
  const r = COASTAL_CITY_TUNING.random;
  const xi = Math.floor(x), zi = Math.floor(z);
  let h = seed ^ Math.imul(xi, r.cellMixX) ^ Math.imul(zi, r.cellMixZ) ^ Math.imul(lane, r.cellMixLane);
  h ^= h >>> r.xorshiftB;
  h = Math.imul(h, r.fnvPrime);
  h ^= h >>> r.xorshiftA;
  return (h >>> 0) / r.divisor;
}

function assertLegendIndex(value: number, label: string): void {
  if (!Number.isFinite(value) || Math.trunc(value) !== value || value < 0 || value > COASTAL_CITY_TUNING.wire.maxLegendIndex) throw new Error(`${label} must be an i16-compatible non-negative legend index`);
}

function validateLegend(legend: CoastalCityPaintingLegend): void {
  for (const [key, value] of Object.entries(legend.tiles)) assertLegendIndex(value, `tile.${key}`);
  for (const [key, value] of Object.entries(legend.flora)) assertLegendIndex(value, `flora.${key}`);
}

type PadBucketIndex = { columns: number; rows: number; buckets: CoastalBuildingSite[][] };

function makePadBuckets(plan: CoastalCityPlan): PadBucketIndex {
  const cellM = COASTAL_CITY_TUNING.terrain.padIndexCellM;
  const columns = Math.ceil((plan.bounds.maxX - plan.bounds.minX) / cellM);
  const rows = Math.ceil((plan.bounds.maxZ - plan.bounds.minZ) / cellM);
  const buckets: CoastalBuildingSite[][] = Array.from({ length: columns * rows }, () => []);
  const feather = COASTAL_CITY_TUNING.terrain.padFeatherM;
  for (const site of plan.sites) {
    const rect = buildingSiteBounds(site, feather);
    const minX = clamp(Math.floor((rect.minX - plan.bounds.minX) / cellM), 0, columns - 1);
    const maxX = clamp(Math.floor((rect.maxX - plan.bounds.minX) / cellM), 0, columns - 1);
    const minZ = clamp(Math.floor((rect.minZ - plan.bounds.minZ) / cellM), 0, rows - 1);
    const maxZ = clamp(Math.floor((rect.maxZ - plan.bounds.minZ) / cellM), 0, rows - 1);
    for (let iz = minZ; iz <= maxZ; iz += 1) for (let ix = minX; ix <= maxX; ix += 1) buckets[iz * columns + ix]!.push(site);
  }
  return { columns, rows, buckets };
}

function bucketSites(index: PadBucketIndex, plan: CoastalCityPlan, x: number, z: number): readonly CoastalBuildingSite[] {
  const cellM = COASTAL_CITY_TUNING.terrain.padIndexCellM;
  const ix = clamp(Math.floor((x - plan.bounds.minX) / cellM), 0, index.columns - 1);
  const iz = clamp(Math.floor((z - plan.bounds.minZ) / cellM), 0, index.rows - 1);
  return index.buckets[iz * index.columns + ix]!;
}

function makeTransportBuckets(plan: CoastalCityPlan): TransportBucketIndex {
  const cellM = COASTAL_CITY_TUNING.flora.clearanceIndexCellM;
  const columns = Math.ceil((plan.bounds.maxX - plan.bounds.minX) / cellM);
  const rows = Math.ceil((plan.bounds.maxZ - plan.bounds.minZ) / cellM);
  const buckets: TransportClearanceSegment[][] = Array.from({ length: columns * rows }, () => []);
  for (const segment of transportClearanceSegments(plan.paths)) {
    const minX = clamp(Math.floor((Math.min(segment.a.x, segment.b.x) - segment.radiusM - plan.bounds.minX) / cellM), 0, columns - 1);
    const maxX = clamp(Math.floor((Math.max(segment.a.x, segment.b.x) + segment.radiusM - plan.bounds.minX) / cellM), 0, columns - 1);
    const minZ = clamp(Math.floor((Math.min(segment.a.z, segment.b.z) - segment.radiusM - plan.bounds.minZ) / cellM), 0, rows - 1);
    const maxZ = clamp(Math.floor((Math.max(segment.a.z, segment.b.z) + segment.radiusM - plan.bounds.minZ) / cellM), 0, rows - 1);
    for (let iz = minZ; iz <= maxZ; iz += 1) for (let ix = minX; ix <= maxX; ix += 1) buckets[iz * columns + ix]!.push(segment);
  }
  return { columns, rows, buckets };
}

function bucketTransport(index: TransportBucketIndex, plan: CoastalCityPlan, x: number, z: number): readonly TransportClearanceSegment[] {
  const cellM = COASTAL_CITY_TUNING.flora.clearanceIndexCellM;
  const ix = clamp(Math.floor((x - plan.bounds.minX) / cellM), 0, index.columns - 1);
  const iz = clamp(Math.floor((z - plan.bounds.minZ) / cellM), 0, index.rows - 1);
  return index.buckets[iz * index.columns + ix]!;
}

function indexedFloraAllowedAt(plan: CoastalCityPlan, pads: PadBucketIndex, transport: TransportBucketIndex, x: number, z: number): boolean {
  if (isWaterForPlanAt(plan, x, z)) return false;
  for (const site of bucketSites(pads, plan, x, z)) if (pointInsideRect(x, z, buildingSiteBounds(site))) return false;
  for (const segment of bucketTransport(transport, plan, x, z)) {
    if (pointSegmentDistance(x, z, segment.a, segment.b) <= segment.radiusM) return false;
  }
  return true;
}

function validatePlanForPack(plan: CoastalCityPlan): void {
  if (plan.version !== 1) throw new Error(`unsupported coastal plan version ${plan.version}`);
  if (plan.chunks.length !== COASTAL_CITY_TUNING.wire.chunkCount) throw new Error('coastal plan must contain exactly 81 native chunks');
  validateTransport(plan.paths, plan.crossings, plan.seed);
  for (const site of plan.sites) {
    if (![site.x, site.y, site.z, site.widthM, site.depthM, site.suggestedMaxFloors].every(Number.isFinite)) throw new Error(`${site.id} contains a non-finite field`);
  }
}

function packedPathLength(paths: readonly CoastalTransportPath[]): number {
  return COASTAL_CITY_TUNING.wire.pathHeaderFloats + paths.reduce(
    (sum, path) => sum + COASTAL_CITY_TUNING.wire.pathRecordFloats + path.points.length * COASTAL_CITY_TUNING.wire.pathPointFloats,
    0,
  );
}

/** Pack the planner output into the native replacement door's exact wire. */
export function packCoastalCityPainting(plan: CoastalCityPlan, legend: CoastalCityPaintingLegend): PackedCoastalCityPainting {
  validatePlanForPack(plan);
  validateLegend(legend);
  const wire = COASTAL_CITY_TUNING.wire;
  const chunkStride = wire.chunkCoordFloats + wire.sampleCells * 2 + wire.tileCells * wire.cellChannelCount;
  const chunks = new Float32Array(wire.chunkHeaderFloats + plan.chunks.length * chunkStride);
  chunks[0] = wire.version;
  chunks[1] = plan.chunks.length;
  chunks[2] = chunkStride;
  chunks[3] = wire.sampleCells;
  chunks[4] = wire.tileCells;
  const padIndex = makePadBuckets(plan);
  const transportIndex = makeTransportBuckets(plan);
  let at = wire.chunkHeaderFloats;
  for (const chunk of plan.chunks) {
    chunks[at++] = chunk.cx;
    chunks[at++] = chunk.cz;
    const minX = chunk.cx * wire.chunkMeters - wire.chunkMeters / 2;
    const minZ = chunk.cz * wire.chunkMeters - wire.chunkMeters / 2;
    const heightStart = at;
    const waterStart = heightStart + wire.sampleCells;
    for (let sz = 0; sz < wire.sampleColumns; sz += 1) for (let sx = 0; sx < wire.sampleColumns; sx += 1) {
      const sampleIndex = sz * wire.sampleColumns + sx;
      const x = minX + sx * wire.sampleSpacingM, z = minZ + sz * wire.sampleSpacingM;
      const base = terrainHeightAt(x, z, plan.seed);
      // Dry terrain is always positive and every geographic bed is negative,
      // so the already-computed base is also the cheapest exact wetness bit.
      const causeway = base < 0 && coastalCityCausewayAt(plan, x, z) !== null;
      const prepared = causeway ? Math.max(base, COASTAL_CITY_TUNING.river.causewayHeightM) : base;
      const packedWater = base < 0 && !causeway;
      chunks[heightStart + sampleIndex] = packedWater ? prepared : siteHeightAt(bucketSites(padIndex, plan, x, z), x, z, prepared);
      chunks[waterStart + sampleIndex] = packedWater ? -base : 0;
    }
    at = waterStart + wire.sampleCells;
    const tileStart = at;
    const zoneStart = tileStart + wire.tileCells;
    const grassStart = zoneStart + wire.tileCells;
    const treeStart = grassStart + wire.tileCells;
    const bushStart = treeStart + wire.tileCells;
    chunks.fill(wire.emptyCell, tileStart, bushStart + wire.tileCells);
    for (let tz = 0; tz < wire.tileColumns; tz += 1) for (let tx = 0; tx < wire.tileColumns; tx += 1) {
      const index = tz * wire.tileColumns + tx;
      const x = minX + tx + wire.tileCenterOffsetM, z = minZ + tz + wire.tileCenterOffsetM;
      const water = isWaterForPlanAt(plan, x, z);
      const protectedKind = protectedLandKindAt(x, z, plan.seed);
      chunks[tileStart + index] = water || protectedKind === 'wetland' ? legend.tiles.mud
        : protectedKind === 'beach' ? legend.tiles.sand : legend.tiles.grass;
      chunks[zoneStart + index] = zoneIndexAt(plan, x, z);
      if (water || !indexedFloraAllowedAt(plan, padIndex, transportIndex, x, z)) continue;
      const grassNoise = cellNoise(plan.seed, x, z, 0);
      const treeNoise = cellNoise(plan.seed, x, z, 1);
      const bushNoise = cellNoise(plan.seed, x, z, 2);
      if (protectedKind === 'wetland') {
        if (grassNoise < COASTAL_CITY_TUNING.flora.wetlandReedChance) chunks[grassStart + index] = legend.flora.grassReeds;
        if (bushNoise < COASTAL_CITY_TUNING.flora.wetlandBushChance) chunks[bushStart + index] = legend.flora.bushDense;
      } else if (protectedKind === 'beach') {
        if (grassNoise < COASTAL_CITY_TUNING.flora.beachGrassChance) chunks[grassStart + index] = legend.flora.grassSparse;
      } else if (protectedKind === 'mountain') {
        if (grassNoise < COASTAL_CITY_TUNING.flora.ordinaryGrassChance) chunks[grassStart + index] = legend.flora.grassSparse;
        if (treeNoise < COASTAL_CITY_TUNING.flora.mountainPineChance) chunks[treeStart + index] = legend.flora.pine;
      } else if (protectedKind === 'forest') {
        if (grassNoise < COASTAL_CITY_TUNING.flora.lushGrassChance) chunks[grassStart + index] = legend.flora.grassLush;
        if (treeNoise < COASTAL_CITY_TUNING.flora.forestCedarChance) chunks[treeStart + index] = legend.flora.cedar;
        if (bushNoise < COASTAL_CITY_TUNING.flora.forestBushChance) chunks[bushStart + index] = legend.flora.bushDense;
      } else {
        if (grassNoise < COASTAL_CITY_TUNING.flora.ordinaryGrassChance) chunks[grassStart + index] = legend.flora.grassSparse;
        if (treeNoise < COASTAL_CITY_TUNING.flora.ordinaryCedarChance) chunks[treeStart + index] = legend.flora.cedar;
      }
    }
    at = bushStart + wire.tileCells;
  }
  if (at !== chunks.length) throw new Error(`coastal chunk pack wrote ${at} floats into ${chunks.length}`);

  const paths = new Float32Array(packedPathLength(plan.paths));
  let pathAt = 0;
  paths[pathAt++] = wire.version;
  paths[pathAt++] = plan.paths.length;
  for (const path of plan.paths) {
    const p = path.profile;
    paths[pathAt++] = wire.pathKind[path.kind];
    paths[pathAt++] = p.lanesF;
    paths[pathAt++] = p.lanesB;
    paths[pathAt++] = p.sidewalks ? 1 : 0;
    paths[pathAt++] = p.tracks;
    paths[pathAt++] = p.curveRadiusM;
    paths[pathAt++] = p.speedLimitKph;
    paths[pathAt++] = path.points.length;
    for (const pathPoint of path.points) {
      paths[pathAt++] = pathPoint.x;
      paths[pathAt++] = pathPoint.z;
      paths[pathAt++] = pathPoint.elevationM;
    }
  }
  if (pathAt !== paths.length) throw new Error(`coastal path pack wrote ${pathAt} floats into ${paths.length}`);
  return { chunks, paths };
}
