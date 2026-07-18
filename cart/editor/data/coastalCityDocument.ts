// Turns a validated coastal-city authoring plan into the React-owned half of a
// named map document. Terrain, water, and transport are compiled into the
// sibling native RMAP; this boundary owns only the semantic building-site
// anchors and the matching zone definitions.
import { catalogRowFor } from '../world/buildCatalog';
import {
  GENERATED_SITE_GENERATOR,
  GENERATED_SITE_FLOOR_PIECE_ID,
  GENERATED_SITE_LIMITS,
  GENERATED_SITE_VERSION,
  PIECE_MODULE_METERS,
  type GeneratedSiteProvenance,
  type PlacedPiece,
} from '../world/pieces';
import type { MapZoneDef } from '../stage/mapPaint';
import type { CoastalCityPlan } from './coastalCity';
import { emptyWorldSave, type WorldSave } from './worldStore';

const QUARTER_TURN_YAWS = new Set([0, 90, 180, 270]);

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedNonemptyText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= GENERATED_SITE_LIMITS.maxTextChars
    && value.trim() === value;
}

function isModuleCentered(value: number): boolean {
  return Number.isInteger((value - PIECE_MODULE_METERS / 2) / PIECE_MODULE_METERS);
}

function isModuleAlignedLength(value: number): boolean {
  return value > 0
    && value <= GENERATED_SITE_LIMITS.maxFootprintMeters
    && Number.isInteger(value / PIECE_MODULE_METERS);
}

function validateZones(zones: unknown): MapZoneDef[] {
  if (!Array.isArray(zones)) throw new Error('coastal city zones must be an array');
  const ids = new Set<string>();
  return zones.map((raw, index) => {
    const zone = raw as Partial<MapZoneDef> | null;
    if (!zone || !boundedNonemptyText(zone.id) || !boundedNonemptyText(zone.name) || !boundedNonemptyText(zone.color)) {
      throw new Error(`coastal city zone ${index} is malformed`);
    }
    if (ids.has(zone.id)) throw new Error(`duplicate coastal city zone '${zone.id}'`);
    ids.add(zone.id);
    return { id: zone.id, name: zone.name, color: zone.color };
  });
}

function floorAnchorPieceId(): string {
  const row = catalogRowFor(GENERATED_SITE_FLOOR_PIECE_ID);
  if (!row || row.kind !== 'floor') throw new Error(`unknown generated-site floor '${GENERATED_SITE_FLOOR_PIECE_ID}'`);
  return row.id;
}

/** Build the document-side save for a coastal city.
 *
 * One generated site becomes exactly one real floor piece. Its footprint is
 * provenance for the future building-type replacement pass; it is not expanded
 * into a carpet of tiles or guessed walls/roofs here. */
export function coastalCityWorldSave(stem: string, startingSeq: number, plan: CoastalCityPlan): WorldSave {
  if (!Number.isSafeInteger(startingSeq) || startingSeq < 1) {
    throw new Error('coastal city starting sequence must be a positive safe integer');
  }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.sites)) {
    throw new Error('coastal city plan is malformed');
  }
  if (!Number.isInteger(plan.seed) || plan.seed < 0 || plan.seed > GENERATED_SITE_LIMITS.maxSeed) {
    throw new Error('coastal city seed must be an unsigned 32-bit integer');
  }
  if (!Number.isSafeInteger(startingSeq + plan.sites.length)) {
    throw new Error('coastal city piece sequence exceeds the safe integer range');
  }

  const pieceId = floorAnchorPieceId();
  const siteIds = new Set<string>();
  const pieces: PlacedPiece[] = plan.sites.map((site, index) => {
    if (!site || typeof site !== 'object') throw new Error(`coastal city site ${index} is malformed`);
    if (!boundedNonemptyText(site.id)) throw new Error(`coastal city site ${index} has an invalid id`);
    if (siteIds.has(site.id)) throw new Error(`duplicate coastal city site '${site.id}'`);
    siteIds.add(site.id);
    if (!boundedNonemptyText(site.intendedUse)) throw new Error(`coastal city site '${site.id}' has an invalid intended use`);
    if (!boundedNonemptyText(site.frontagePathId)) throw new Error(`coastal city site '${site.id}' has an invalid frontage path`);
    if (!finite(site.x) || !isModuleCentered(site.x) || !finite(site.z) || !isModuleCentered(site.z)) {
      throw new Error(`coastal city site '${site.id}' must sit at a 3m module center`);
    }
    if (!finite(site.y)) throw new Error(`coastal city site '${site.id}' has a non-finite elevation`);
    if (!finite(site.yawDegrees) || !QUARTER_TURN_YAWS.has(site.yawDegrees)) {
      throw new Error(`coastal city site '${site.id}' must use a quarter-turn yaw`);
    }
    if (!finite(site.widthM) || !isModuleAlignedLength(site.widthM) || !finite(site.depthM) || !isModuleAlignedLength(site.depthM)) {
      throw new Error(`coastal city site '${site.id}' footprint must be positive and 3m-aligned`);
    }
    if (!finite(site.suggestedMaxFloors)
      || !Number.isInteger(site.suggestedMaxFloors)
      || site.suggestedMaxFloors < 1
      || site.suggestedMaxFloors > GENERATED_SITE_LIMITS.maxSuggestedFloors) {
      throw new Error(`coastal city site '${site.id}' has an invalid floor suggestion`);
    }

    const generatedSite: GeneratedSiteProvenance = {
      generator: GENERATED_SITE_GENERATOR,
      version: GENERATED_SITE_VERSION,
      seed: plan.seed,
      siteId: site.id,
      intendedUse: site.intendedUse,
      widthM: site.widthM,
      depthM: site.depthM,
      suggestedMaxFloors: site.suggestedMaxFloors,
      frontagePathId: site.frontagePathId,
    };
    return {
      id: `bp_${startingSeq + index}`,
      pieceId,
      x: site.x,
      y: site.y,
      z: site.z,
      yawDegrees: site.yawDegrees,
      floor: 0,
      generatedSite,
    };
  });

  const save = emptyWorldSave(stem, startingSeq + pieces.length);
  save.pieces = pieces;
  save.zones = validateZones(plan.zones);
  return save;
}
