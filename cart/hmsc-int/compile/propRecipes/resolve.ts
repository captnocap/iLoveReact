// resolve.ts — the ONE prop → PropPartSpec[] resolver, shared by BOTH the
// compile bake (worldGeometry) AND the /test render (render3d/props/DataProp).
//
// GUIDING_LIGHT: store each thing once, reference it everywhere. A prop's
// geometry used to live twice — a bespoke render component AND a bake recipe —
// which had to be hand-kept in sync (rank). This is the single source: every
// prop is a recipe (ONE file per prop in this dir), and render + bake + the
// click-to-skin part pipeline all read it through here. So every prop "undergoes
// the exact same thing": one recipe → parts → rendered, baked, and skinnable,
// with no per-prop code on any consumer. This dispatch carries NO geometry — a
// new prop is a new file + one import + one case, like dropping in a download.

import type { WorldProp } from '../../design';
import { propKindDefinition, type PropKind } from '../../game/kinds/props';
import { propModelParts, type Color, type PropPartSpec } from '../../game/kinds/propModels';
import { ballBasketballParts } from './ballBasketball';
import { ballBeachParts } from './ballBeach';
import { ballSoccerParts } from './ballSoccer';
import { barrierParts } from './barrier';
import { basketballHoopParts } from './basketballHoop';
import { bedParts } from './bed';
import { benchParts } from './bench';
import { boulderParts } from './boulder';
import { bushParts } from './bush';
import { chairParts } from './chair';
import { computerParts } from './computer';
import { couchParts } from './couch';
import { cupboardParts } from './cupboard';
import { dumpsterParts } from './dumpster';
import { fenceParts } from './fence';
import { fireHydrantParts } from './fireHydrant';
import { floorLampParts } from './floorLamp';
import { fridgeParts } from './fridge';
import { ledLightParts } from './ledLight';
import { mailboxParts } from './mailbox';
import { mirrorParts } from './mirror';
import { ovenParts } from './oven';
import { payphoneParts } from './payphone';
import { planterParts } from './planter';
import { rockParts } from './rock';
import { rockFlatParts } from './rockFlat';
import { rockMossyParts } from './rockMossy';
import { rockPileParts } from './rockPile';
import { rockSpireParts } from './rockSpire';
import { sinkParts } from './sink';
import { stopSignParts } from './stopSign';
import { streetLightParts } from './streetLight';
import { streetSignParts } from './streetSign';
import { tableParts } from './table';
import { telephonePoleParts } from './telephonePole';
import { trafficConeParts } from './trafficCone';
import { trafficLightParts } from './trafficLight';
import { trashCanParts } from './trashCan';
import { treeBirchParts } from './treeBirch';
import { treeCypressParts } from './treeCypress';
import { treeDeadParts } from './treeDead';
import { treeOakParts } from './treeOak';
import { treePalmParts } from './treePalm';
import { treePineParts } from './treePine';
import { wallPaintingParts } from './wallPainting';

// The registry-derived placeholder colour for a kind with no recipe case.
function propColor(kind: PropKind | string): Color {
  switch (kind) {
    case 'fireHydrant':
    case 'stopSign':
      return [0.82, 0.22, 0.16];
    case 'trafficLight':
      return [0.85, 0.7, 0.2];
    case 'streetLight':
    case 'streetSign':
    case 'payphone':
    case 'mailbox':
      return [0.5, 0.5, 0.55];
    case 'dumpster':
      return [0.25, 0.45, 0.3];
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return [0.5, 0.5, 0.52];
    case 'fence':
      return [0.55, 0.4, 0.25];
    default:
      return [0.7, 0.6, 0.4];
  }
}

/** Every prop's parts, in ONE place. Bespoke kinds resolve to their recipe (the
 *  per-prop file in this dir); data-recipe kinds fall through to propModelParts;
 *  anything else gets a registry-derived box. */
export function resolvePropParts(prop: WorldProp): PropPartSpec[] {
  const def = propKindDefinition(prop.kind);
  switch (prop.kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
      return bushParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return rockParts(prop.kind, def.heightMeters, def.footprintRadiusMeters);
    case 'dumpster': return dumpsterParts();
    case 'streetSign': return streetSignParts(def.heightMeters);
    case 'stopSign': return stopSignParts(def.heightMeters);
    case 'streetLight': return streetLightParts(def.heightMeters);
    case 'trafficLight': return trafficLightParts(def.heightMeters);
    case 'payphone': return payphoneParts(def.heightMeters);
    case 'mailbox': return mailboxParts(def.heightMeters);
    case 'fence': return fenceParts(def.heightMeters, def.footprintRadiusMeters);
    case 'fireHydrant': return fireHydrantParts(def.heightMeters);
    case 'treeOakYoung':
    case 'treeOakGiant':
    case 'treeOak':
      return treeOakParts(prop.kind, def.heightMeters, def.footprintRadiusMeters);
    case 'treePineYoung':
    case 'treePineGiant':
    case 'treePine':
      return treePineParts(prop.kind, def.heightMeters, def.footprintRadiusMeters);
    case 'treeBirch':
      return treeBirchParts(def.heightMeters, def.footprintRadiusMeters);
    case 'treeCypress':
      return treeCypressParts(def.heightMeters, def.footprintRadiusMeters);
    case 'treePalm':
      return treePalmParts(def.heightMeters, def.footprintRadiusMeters);
    case 'treeDead':
      return treeDeadParts(def.heightMeters, def.footprintRadiusMeters);
    case 'boulder': return boulderParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rockFlat': return rockFlatParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rockSpire': return rockSpireParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rockMossy': return rockMossyParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rockPile': return rockPileParts(def.heightMeters, def.footprintRadiusMeters);
    case 'ballBeach': return ballBeachParts(def.footprintRadiusMeters);
    case 'ballSoccer': return ballSoccerParts(def.footprintRadiusMeters);
    case 'ballBasketball': return ballBasketballParts(def.footprintRadiusMeters);
    case 'wallPainting': return wallPaintingParts();
    case 'ledLight': return ledLightParts();
    case 'chair':
    case 'chairRed':
    case 'chairBlue':
    case 'chairGreen':
      return chairParts(prop.kind);
    case 'couch': return couchParts(def.footprintRadiusMeters);
    case 'table': return tableParts(def.heightMeters, def.footprintRadiusMeters);
    case 'floorLamp': return floorLampParts(def.heightMeters);
    case 'bench': return benchParts(def.footprintRadiusMeters);
    case 'trafficCone': return trafficConeParts(def.heightMeters, def.footprintRadiusMeters);
    case 'barrier': return barrierParts(def.heightMeters, def.footprintRadiusMeters);
    case 'trashCan': return trashCanParts(def.heightMeters, def.footprintRadiusMeters);
    case 'planter': return planterParts(def.heightMeters, def.footprintRadiusMeters);
    case 'bedSingle':
    case 'bedDouble':
      return bedParts(prop.kind, def.heightMeters, def.footprintRadiusMeters);
    case 'cupboard': return cupboardParts(def.heightMeters, def.footprintRadiusMeters);
    case 'mirror': return mirrorParts();
    case 'sink': return sinkParts(def.heightMeters);
    case 'oven': return ovenParts(def.heightMeters, def.footprintRadiusMeters);
    case 'fridge': return fridgeParts(def.heightMeters, def.footprintRadiusMeters);
    case 'computer': return computerParts();
    case 'telephonePole': return telephonePoleParts(def.heightMeters, def.footprintRadiusMeters);
    case 'basketballHoop': return basketballHoopParts(def.heightMeters);
    default: {
      // data-recipe kinds (propModels.RECIPES) resolve here; the two paths agree
      // by construction since everyone calls this one function.
      const recipe = propModelParts(prop.kind);
      if (recipe) return recipe;
      // registry-derived placeholder for any kind without a recipe case.
      const fallback: readonly [number, number, number] = [def.footprintRadiusMeters * 2, def.heightMeters, def.footprintRadiusMeters * 2];
      return [{ shape: 'box', local: [0, fallback[1] / 2, 0], size: fallback, color: propColor(prop.kind) }];
    }
  }
}
