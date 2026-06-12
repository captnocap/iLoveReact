// editors/workbench/paint/live.ts — the bench's LIVE singleton + doors
// (AGNOSTICPAINT-0606). Split from store.ts so the headless factory stays
// P4-bundleable: this module is the one that touches the React-half doors
// (the textures registry is a .tsx, cutout/sources runs host process calls)
// and the editor store/session singletons. Mount-side code (PaintBench, the
// PAINT source, the character PAINT lens) imports the singleton from HERE.

import { createPaintBenchStore, type Commitish, type PaintBenchDeps, type PaintBenchStore } from './store';
import type { Dims, VehiclesStateLike } from './targets';
import type { GraySource } from '../../paint/strokes';
import { cutoutStream, type CutoutEvent } from '../../cutout/stream';
import { charactersStream, type CharactersEvent } from '../../../game/figure/stream';
import { vehiclesStream } from '../../../game/vehicle/stream';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { saveCustomTexture, saveDecalTexture } from '../../../game/textures/materials';
import { allTextures, textureById as registryTextureById } from '../../../game/textures/registry';
import { identifyImage, loadGraySource } from '../../cutout/sources';
import { characterWorkbenchStore } from '../characters/store';
import { clothingVariantsStream, type ClothingVariantsEvent } from '../../../game/figure/clothingVariants';
import { garmentLabelById } from '../clothing/store';

let liveBench: PaintBenchStore | null = null;

export function paintBenchStore(): PaintBenchStore {
  if (liveBench) return liveBench;
  let deps: PaintBenchDeps;
  try {
    const library = editorChannel(cutoutStream);
    const figures = editorChannel(charactersStream);
    const vehicles = editorChannel(vehiclesStream) as unknown as { state(): VehiclesStateLike };
    const session = editorSessions().open('/workbench', library) as RouteSession<CutoutEvent>;
    let figSession: Commitish | null = null;
    let vehSession: Commitish | null = null;
    // CLOTHFLIP-0607: the garment-design family's channel (lazy, the
    // figure/vehicle session idiom)
    const garmentVariants = editorChannel(clothingVariantsStream);
    let garmentSess: Commitish | null = null;
    deps = {
      library, session, error: null,
      figures, vehicles,
      figureSession: () => (figSession ??= editorSessions().open('/workbench', figures) as RouteSession<CharactersEvent>),
      vehicleSession: () => (vehSession ??= editorSessions().open('/workbench', editorChannel(vehiclesStream)) as unknown as Commitish),
      garmentLabel: (id) => garmentLabelById(id),
      garmentDesigns: garmentVariants,
      garmentSession: () => (garmentSess ??= editorSessions().open('/workbench', garmentVariants) as RouteSession<ClothingVariantsEvent>),
      materialize: (name, recipeId, data, opts) => saveCustomTexture(name, recipeId, data, opts),
      materializeDecal: (name, doc) => saveDecalTexture(name, doc),
      textureById: (id) => (registryTextureById(id) as { id: string; label: string } | null) ?? null,
      catalogs: () => {
        const shaders = allTextures().filter((t: any) => t.source?.kind === 'shader');
        return {
          materials: shaders.filter((t: any) => t.id.startsWith('custom:')),
          recipes: shaders.filter((t: any) => !t.id.startsWith('custom:')),
        };
      },
      charAdopt: (docId, next) => {
        try {
          const chr = characterWorkbenchStore();
          // adopt-only: the bench already committed; the open draft follows
          if (chr.draftId === docId) chr.adoptPaintedDocument(next);
        } catch { /* character store unavailable */ }
      },
      identify: (path: string): Promise<Dims | null> => identifyImage(path),
      grayLoad: (path: string, dims: Dims): Promise<GraySource | null> => loadGraySource(path, dims),
    };
  } catch (e) {
    deps = {
      library: null, session: null, error: String(e),
      figures: null, vehicles: null, figureSession: null, vehicleSession: null,
      materialize: null, textureById: () => null, catalogs: () => ({ materials: [], recipes: [] }),
      charAdopt: null, identify: null, grayLoad: null,
    };
  }
  liveBench = createPaintBenchStore(deps);
  return liveBench;
}
