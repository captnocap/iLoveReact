import type { ModelBasePaint } from '../data/modelPackageStore';
import type { PaintVariant } from '../data/paintVariants';

export type DecodedPaintRaster = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type PersistedPaintSources = {
  stale: boolean;
  basePaint: ModelBasePaint | null;
  readRasterBase: () => DecodedPaintRaster | null;
  readLatestVariant: () => PaintVariant | null;
  // Decode a variant's own raster base (basePng beneath strokes, else its composite
  // png). Full-look variants (req_3439) restore through this exactly like v4 base
  // paint; without it they can only fall back to the plain program/atlas paths.
  readVariantRasterBase?: (variant: PaintVariant) => DecodedPaintRaster | null;
};

export type PaintHydrationPort = {
  invalidateLayout: () => void;
  setDetail: (detail: number) => void;
  importAtlas: (raster: DecodedPaintRaster) => boolean;
  applyLayout: (layout: Uint32Array) => boolean;
  applyCornerUv: (cornerUv: Float32Array) => boolean;
  applyProgram: (program: string) => boolean;
  applyProgramOverBase: (program: string) => boolean;
  applyAtlas: (detail: number, data: string) => boolean;
};

export type PaintHydrationResult =
  | { status: 'ready'; source: 'base' | 'variant' }
  | { status: 'missing' | 'stale' | 'failed' };

export type ResidentPaintResumeAction = 'none' | 'preview' | 'paint';

/**
 * Decide how a remounted React surface should expose paint that is already live
 * in the host. A resident atlas is document state even when the brush was not the
 * active tool, so the inactive-tool path must still publish its UV preview.
 */
export function residentPaintResumeAction(input: {
  atlasReady: boolean;
  atlasStale: boolean;
  paintToolActive: boolean;
}): ResidentPaintResumeAction {
  if (!input.atlasReady || input.atlasStale) return 'none';
  return input.paintToolActive ? 'paint' : 'preview';
}

/**
 * Restore one model's authored paint state without entering Paint mode.
 *
 * This boundary deliberately knows nothing about React or tool activation. A model
 * load and the Paint button both call the same operation; the button only decides
 * whether the brush owns input after hydration succeeds.
 */
export function hydratePersistedModelPaint(
  sources: PersistedPaintSources,
  port: PaintHydrationPort,
): PaintHydrationResult {
  if (sources.stale) {
    port.invalidateLayout();
    return { status: 'stale' };
  }

  let foundPersistedPaint = false;
  const base = sources.basePaint;
  if (base) {
    foundPersistedPaint = true;
    port.setDetail(base.detail > 1 ? base.detail : 1);
    let restored = false;
    if (base.version === 4) {
      const raster = sources.readRasterBase();
      const imported = !!raster && port.importAtlas(raster);
      const geometryRestored = imported
        && !!base.cornerUv?.length
        && port.applyCornerUv(new Float32Array(base.cornerUv));
      restored = geometryRestored
        && (!base.program || port.applyProgramOverBase(base.program));
    } else if (base.version === 3) {
      const raster = sources.readRasterBase();
      const imported = !!raster && port.importAtlas(raster);
      const layoutRestored = imported
        && (!base.layout?.length || port.applyLayout(new Uint32Array(base.layout)));
      restored = layoutRestored
        && (!base.program || port.applyProgramOverBase(base.program));
    } else {
      const layoutRestored = !base.layout?.length
        || port.applyLayout(new Uint32Array(base.layout));
      restored = layoutRestored && port.applyProgram(base.program);
    }
    if (restored) return { status: 'ready', source: 'base' };
  }

  // Legacy packages may predate atlases/base.paint.json but still carry a named
  // painting. Keep that compatibility path lazy: modern packages never parse a
  // potentially large variant program during load.
  const variant = sources.readLatestVariant();
  if (variant) {
    foundPersistedPaint = true;
    port.setDetail(variant.detail > 1 ? variant.detail : 1);
    let restored = false;
    if (variant.rasterBase && variant.cornerUv?.length) {
      // Full-look variant (req_3439): the same restore order as v4 base paint —
      // raster base in, exact UV geometry over it, then any strokes on top. An
      // imported-texture look with zero strokes is a valid painting here.
      const raster = sources.readVariantRasterBase?.(variant) ?? null;
      const imported = !!raster && port.importAtlas(raster);
      const geometryRestored = imported
        && port.applyCornerUv(new Float32Array(variant.cornerUv));
      restored = geometryRestored
        && (!variant.data || port.applyProgramOverBase(variant.data));
    } else {
      restored = variant.format === 'program'
        ? !!variant.data && port.applyProgram(variant.data)
        : !!variant.data && port.applyAtlas(variant.detail, variant.data);
    }
    if (restored) return { status: 'ready', source: 'variant' };
  }

  return { status: foundPersistedPaint ? 'failed' : 'missing' };
}
