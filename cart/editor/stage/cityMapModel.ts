import type { MapPathSnapshot, MapPathSnapshotPath } from '../../../runtime/game/map';
import {
  COASTAL_CITY_TUNING,
  coastXAt,
  coastalCityOverview,
  riverHalfWidthAt,
  riverZAt,
  type CoastalDistrictKind,
  type CoastalProtectedKind,
} from '../data/coastalCity';
import type { PlacedPiece } from '../world/pieces';

export const CITY_MAP_TUNING = {
  chunkMeters: COASTAL_CITY_TUNING.wire.chunkMeters,
  chunkAuthorOriginM: COASTAL_CITY_TUNING.wire.chunkMeters / 2,
  minimumBoundsSpanM: COASTAL_CITY_TUNING.wire.chunkMeters,
  geographySampleM: 30,
  ellipseSamples: 40,
  laneWidthM: COASTAL_CITY_TUNING.roads.laneWidthM,
  opposingMedianM: COASTAL_CITY_TUNING.roads.opposingMedianM,
  sidewalkWidthEachM: COASTAL_CITY_TUNING.roads.sidewalkWidthEachM,
  roadCasingExtraM: 2.5,
  railTrackVisualM: 1.6,
  railCasingExtraM: 3,
  highwaySpeedKph: 70,
  majorRoadSpeedKph: 45,
} as const;

export type CityMapBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  widthM: number;
  depthM: number;
};

export type CityMapChunkTopology = {
  maxCol: number;
  maxRow: number;
  chunks: readonly { cx: number; cz: number }[];
};

export type CityMapRoadTier = 'highway' | 'major' | 'local';

export type CityMapPathBatch = {
  key: string;
  kind: MapPathSnapshotPath['kind'];
  tier: CityMapRoadTier | 'lightRail' | 'railway';
  outerWidthM: number;
  innerWidthM: number;
  d: string;
};

export type CityMapSiteRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  intendedUse: string;
};

export type CityMapGeography = {
  seed: number;
  seaD: string;
  beachD: string;
  riverD: string;
  districts: readonly { id: string; name: string; kind: CoastalDistrictKind; x: number; z: number; d: string }[];
  protectedAreas: readonly { id: string; kind: CoastalProtectedKind; d: string }[];
};

const finite = (value: number): boolean => Number.isFinite(value);
const metric = (value: number): string => Number(value.toFixed(2)).toString();

function polygonD(points: readonly { x: number; z: number }[]): string {
  if (points.length < 3) return '';
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${metric(point.x)} ${metric(point.z)}`).join(' ')} Z`;
}

function polylineD(points: readonly { x: number; z: number }[]): string {
  if (points.length < 2) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${metric(point.x)} ${metric(point.z)}`).join(' ');
}

function sampledRange(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let value = start; value < end; value += step) out.push(value);
  out.push(end);
  return out;
}

function ellipseD(center: { x: number; z: number }, radiusX: number, radiusZ: number, angleRadians = 0): string {
  const points: { x: number; z: number }[] = [];
  const ca = Math.cos(angleRadians);
  const sa = Math.sin(angleRadians);
  for (let index = 0; index < CITY_MAP_TUNING.ellipseSamples; index += 1) {
    const angle = (index / CITY_MAP_TUNING.ellipseSamples) * Math.PI * 2;
    const lx = Math.cos(angle) * radiusX;
    const lz = Math.sin(angle) * radiusZ;
    points.push({ x: center.x + lx * ca - lz * sa, z: center.z + lx * sa + lz * ca });
  }
  return polygonD(points);
}

export function coastalSeedFromPieces(pieces: readonly PlacedPiece[]): number | null {
  for (const piece of pieces) {
    const provenance = piece.generatedSite;
    if (provenance?.generator === 'coastal-city' && finite(provenance.seed)) return Math.trunc(provenance.seed);
  }
  return null;
}

export function cityMapBounds(
  topology: CityMapChunkTopology,
  snapshot: MapPathSnapshot | null,
  pieces: readonly PlacedPiece[],
  preferred?: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
): CityMapBounds {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const include = (x: number, z: number): void => {
    if (!finite(x) || !finite(z)) return;
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  };
  if (preferred) {
    include(preferred.minX, preferred.minZ);
    include(preferred.maxX, preferred.maxZ);
  }
  for (const chunk of topology.chunks) {
    const originX = chunk.cx * CITY_MAP_TUNING.chunkMeters - CITY_MAP_TUNING.chunkAuthorOriginM;
    const originZ = chunk.cz * CITY_MAP_TUNING.chunkMeters - CITY_MAP_TUNING.chunkAuthorOriginM;
    include(originX, originZ);
    include(originX + CITY_MAP_TUNING.chunkMeters, originZ + CITY_MAP_TUNING.chunkMeters);
  }
  for (const path of snapshot?.paths ?? []) for (const point of path.points) include(point.x, point.z);
  for (const piece of pieces) {
    const site = piece.generatedSite;
    if (!site) continue;
    const turnsOdd = Math.abs(Math.round(piece.yawDegrees / 90)) % 2 === 1;
    const width = turnsOdd ? site.depthM : site.widthM;
    const depth = turnsOdd ? site.widthM : site.depthM;
    include(piece.x - width / 2, piece.z - depth / 2);
    include(piece.x + width / 2, piece.z + depth / 2);
  }
  if (!finite(minX)) {
    const half = CITY_MAP_TUNING.minimumBoundsSpanM / 2;
    minX = -half; minZ = -half; maxX = half; maxZ = half;
  }
  const widthM = Math.max(CITY_MAP_TUNING.minimumBoundsSpanM, maxX - minX);
  const depthM = Math.max(CITY_MAP_TUNING.minimumBoundsSpanM, maxZ - minZ);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  return {
    minX: centerX - widthM / 2,
    minZ: centerZ - depthM / 2,
    maxX: centerX + widthM / 2,
    maxZ: centerZ + depthM / 2,
    widthM,
    depthM,
  };
}

export function cityMapChunkPath(topology: CityMapChunkTopology): string {
  if (topology.chunks.length === 0) return '';
  const size = CITY_MAP_TUNING.chunkMeters;
  const offset = CITY_MAP_TUNING.chunkAuthorOriginM;
  const minCx = Math.min(...topology.chunks.map((chunk) => chunk.cx));
  const maxCx = Math.max(...topology.chunks.map((chunk) => chunk.cx));
  const minCz = Math.min(...topology.chunks.map((chunk) => chunk.cz));
  const maxCz = Math.max(...topology.chunks.map((chunk) => chunk.cz));
  const columns = maxCx - minCx + 1;
  const rows = maxCz - minCz + 1;
  const keys = new Set(topology.chunks.map((chunk) => `${chunk.cx},${chunk.cz}`));
  const solidRectangle = topology.chunks.length === columns * rows
    && Array.from({ length: rows }, (_, row) => row + minCz)
      .every((cz) => Array.from({ length: columns }, (_, column) => column + minCx).every((cx) => keys.has(`${cx},${cz}`)));
  if (solidRectangle) {
    const minX = minCx * size - offset;
    const minZ = minCz * size - offset;
    const maxX = (maxCx + 1) * size - offset;
    const maxZ = (maxCz + 1) * size - offset;
    const vertical = Array.from({ length: columns + 1 }, (_, index) => {
      const x = minX + index * size;
      return `M ${metric(x)} ${metric(minZ)} L ${metric(x)} ${metric(maxZ)}`;
    });
    const horizontal = Array.from({ length: rows + 1 }, (_, index) => {
      const z = minZ + index * size;
      return `M ${metric(minX)} ${metric(z)} L ${metric(maxX)} ${metric(z)}`;
    });
    return [...vertical, ...horizontal].join(' ');
  }
  return topology.chunks.map(({ cx, cz }) => {
    const x = cx * size - offset;
    const z = cz * size - offset;
    return `M ${metric(x)} ${metric(z)} h ${metric(size)} v ${metric(size)} h -${metric(size)} Z`;
  }).join(' ');
}

export function cityMapPathBatches(snapshot: MapPathSnapshot | null): CityMapPathBatch[] {
  const grouped = new Map<string, CityMapPathBatch>();
  for (const path of snapshot?.paths ?? []) {
    const d = polylineD(path.points);
    if (!d) continue;
    const profile = path.profile;
    let tier: CityMapPathBatch['tier'];
    let innerWidthM: number;
    let outerWidthM: number;
    if (path.kind === 'road') {
      const laneCount = profile.lanesF + profile.lanesB;
      const median = profile.lanesF > 0 && profile.lanesB > 0 ? CITY_MAP_TUNING.opposingMedianM : 0;
      innerWidthM = Math.max(CITY_MAP_TUNING.laneWidthM, laneCount * CITY_MAP_TUNING.laneWidthM + median);
      outerWidthM = innerWidthM
        + (profile.sidewalks ? CITY_MAP_TUNING.sidewalkWidthEachM * 2 : CITY_MAP_TUNING.roadCasingExtraM);
      tier = profile.speedLimitKph >= CITY_MAP_TUNING.highwaySpeedKph || laneCount >= 4
        ? 'highway'
        : profile.speedLimitKph >= CITY_MAP_TUNING.majorRoadSpeedKph ? 'major' : 'local';
    } else {
      tier = path.kind;
      innerWidthM = Math.max(CITY_MAP_TUNING.railTrackVisualM, profile.tracks * CITY_MAP_TUNING.railTrackVisualM);
      outerWidthM = innerWidthM + CITY_MAP_TUNING.railCasingExtraM;
    }
    const key = `${path.kind}:${tier}:${outerWidthM}:${innerWidthM}`;
    const previous = grouped.get(key);
    if (previous) previous.d += ` ${d}`;
    else grouped.set(key, { key, kind: path.kind, tier, outerWidthM, innerWidthM, d });
  }
  return [...grouped.values()];
}

export function cityMapSiteRects(pieces: readonly PlacedPiece[], bounds: CityMapBounds): CityMapSiteRect[] {
  const out: CityMapSiteRect[] = [];
  for (const piece of pieces) {
    const site = piece.generatedSite;
    if (!site) continue;
    const turnsOdd = Math.abs(Math.round(piece.yawDegrees / 90)) % 2 === 1;
    const width = turnsOdd ? site.depthM : site.widthM;
    const depth = turnsOdd ? site.widthM : site.depthM;
    out.push({
      x: piece.x - width / 2 - bounds.minX,
      y: piece.z - depth / 2 - bounds.minZ,
      w: width,
      h: depth,
      intendedUse: site.intendedUse,
    });
  }
  return out;
}

export function coastalCityMapGeography(seed: number): CityMapGeography {
  const overview = coastalCityOverview(seed);
  const { minX, minZ, maxX, maxZ } = overview.bounds;
  const zSamples = sampledRange(minZ, maxZ, CITY_MAP_TUNING.geographySampleM);
  const riverMinX = Math.max(minX, COASTAL_CITY_TUNING.river.waterStartX);
  const riverMaxX = Math.min(maxX, COASTAL_CITY_TUNING.river.waterEndX);
  const xSamples = sampledRange(riverMinX, riverMaxX, CITY_MAP_TUNING.geographySampleM);
  const coast = zSamples.map((z) => ({ x: coastXAt(z, overview.seed), z }));
  const seaD = polygonD([{ x: minX, z: minZ }, ...coast, { x: minX, z: maxZ }]);
  const beachD = polygonD([
    ...coast,
    ...[...coast].reverse().map((point) => ({ x: point.x + COASTAL_CITY_TUNING.coast.beachWidthM, z: point.z })),
  ]);
  const riverNorth = xSamples.map((x) => ({ x, z: riverZAt(x, overview.seed) - riverHalfWidthAt(x, overview.seed) }));
  const riverSouth = [...xSamples].reverse().map((x) => ({ x, z: riverZAt(x, overview.seed) + riverHalfWidthAt(x, overview.seed) }));
  const riverD = polygonD([...riverNorth, ...riverSouth]);
  return {
    seed: overview.seed,
    seaD,
    beachD,
    riverD,
    districts: overview.districts.map((district) => ({
      id: district.id,
      name: district.name,
      kind: district.kind,
      x: district.center.x,
      z: district.center.z,
      d: ellipseD(district.center, district.radiusX, district.radiusZ, district.angleRadians),
    })),
    protectedAreas: overview.landUses.flatMap((landUse) => landUse.shape === 'ellipse' && landUse.center && landUse.radiusX && landUse.radiusZ
      ? [{ id: landUse.id, kind: landUse.kind, d: ellipseD(landUse.center, landUse.radiusX, landUse.radiusZ) }]
      : []),
  };
}
