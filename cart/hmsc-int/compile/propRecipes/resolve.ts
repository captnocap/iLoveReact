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
import { barrelParts } from './barrel';
import { barrierParts } from './barrier';
import { basketballHoopParts } from './basketballHoop';
import { bedParts } from './bed';
import { benchParts } from './bench';
import { brickParts } from './brick';
import { cinderBlockParts } from './cinderBlock';
import { jerryCanParts } from './jerryCan';
import { propaneTankParts } from './propaneTank';
import { steelDrumParts } from './steelDrum';
import { tireParts } from './tire';
import { tireStackParts } from './tireStack';
import { shippingContainerParts } from './shippingContainer';
import { concretePipeParts } from './concretePipe';
import { pipeStackParts } from './pipeStack';
import { corrugatedSheetParts } from './corrugatedSheet';
import { cableSpoolParts } from './cableSpool';
import { lockerSetParts } from './lockerSet';
import { oilTankParts } from './oilTank';
import { rubblePileParts } from './rubblePile';
import { toiletPaperParts } from './toiletPaper';
import { radioTowerParts } from './radioTower';
import { gasPumpParts } from './gasPump';
import { vendingMachineParts } from './vendingMachine';
import { storeShelfParts } from './storeShelf';
import { crateParts } from './crate';
import { palletParts } from './pallet';
import { palletStackParts } from './palletStack';
import { businessSignParts } from './businessSign';
import { shopSignParts } from './shopSign';
import { posterParts } from './poster';
import { hospitalSignParts } from './hospitalSign';
import { policeSignParts } from './policeSign';
import { bookStackParts } from './bookStack';
import { recordPlayerParts } from './recordPlayer';
import { vinylRecordParts } from './vinylRecord';
import { albumCoverParts } from './albumCover';
import { speakerParts } from './speaker';
import { speakerStackParts } from './speakerStack';
import { cassetteParts } from './cassette';
import { fountainParts } from './fountain';
import { drinkingFountainParts } from './drinkingFountain';
import { loungeChairParts } from './loungeChair';
import { swingsetParts } from './swingset';
import { sandCastleParts } from './sandCastle';
import { picketFenceParts } from './picketFence';
import { appleTreeParts } from './appleTree';
import { appleParts } from './apple';
import { arcadeCabinetParts } from './arcadeCabinet';
import { slotMachineParts } from './slotMachine';
import { clothingRackParts } from './clothingRack';
import { displayCaseParts } from './displayCase';
import { liquorShelfParts } from './liquorShelf';
import { beerCaseParts } from './beerCase';
import { dinerBoothParts } from './dinerBooth';
import { orderCounterParts } from './orderCounter';
import { menuBoardParts } from './menuBoard';
import { sodaMachineParts } from './sodaMachine';
import { openSignParts } from './openSign';
import { greenCrossSignParts } from './greenCrossSign';
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

/** Every prop's parts, in ONE place — by kind, so render, bake, AND the physics
 *  footprint all read the SAME geometry. Bespoke kinds resolve to their per-prop
 *  file; data-recipe kinds fall through to propModelParts; anything else gets a
 *  registry-derived box. */
export function resolvePropParts(prop: WorldProp): PropPartSpec[] {
  return resolvePartsForKind(prop.kind);
}

/** Resolve a kind's parts directly, with no WorldProp instance — the footprint
 *  derivation calls this so EVERY prop gets a measured collision footprint, not
 *  just the old RECIPES kinds. */
export function resolvePartsForKind(kind: PropKind): PropPartSpec[] {
  const def = propKindDefinition(kind);
  switch (kind) {
    case 'bush':
    case 'bushLarge':
    case 'bushLow':
    case 'bushSparse':
      return bushParts(def.heightMeters, def.footprintRadiusMeters);
    case 'rock':
    case 'rockLarge':
    case 'rockSmall':
      return rockParts(kind, def.heightMeters, def.footprintRadiusMeters);
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
      return treeOakParts(kind, def.heightMeters, def.footprintRadiusMeters);
    case 'treePineYoung':
    case 'treePineGiant':
    case 'treePine':
      return treePineParts(kind, def.heightMeters, def.footprintRadiusMeters);
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
      return chairParts(kind);
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
      return bedParts(kind, def.heightMeters, def.footprintRadiusMeters);
    case 'cupboard': return cupboardParts(def.heightMeters, def.footprintRadiusMeters);
    case 'mirror': return mirrorParts();
    case 'sink': return sinkParts(def.heightMeters);
    case 'oven': return ovenParts(def.heightMeters, def.footprintRadiusMeters);
    case 'fridge': return fridgeParts(def.heightMeters, def.footprintRadiusMeters);
    case 'computer': return computerParts();
    case 'telephonePole': return telephonePoleParts(def.heightMeters, def.footprintRadiusMeters);
    case 'basketballHoop': return basketballHoopParts(def.heightMeters);
    case 'tire': return tireParts();
    case 'tireStack': return tireStackParts();
    case 'barrel': return barrelParts();
    case 'steelDrum': return steelDrumParts();
    case 'propaneTank': return propaneTankParts();
    case 'jerryCan': return jerryCanParts();
    case 'cinderBlock': return cinderBlockParts();
    case 'brick': return brickParts();
    case 'shippingContainer': return shippingContainerParts();
    case 'concretePipe': return concretePipeParts();
    case 'pipeStack': return pipeStackParts();
    case 'corrugatedSheet': return corrugatedSheetParts();
    case 'cableSpool': return cableSpoolParts();
    case 'lockerSet': return lockerSetParts();
    case 'oilTank': return oilTankParts();
    case 'rubblePile': return rubblePileParts();
    case 'toiletPaper': return toiletPaperParts();
    case 'radioTower': return radioTowerParts();
    case 'gasPump': return gasPumpParts();
    case 'vendingMachine': return vendingMachineParts();
    case 'storeShelf': return storeShelfParts();
    case 'crate': return crateParts();
    case 'pallet': return palletParts();
    case 'palletStack': return palletStackParts();
    case 'businessSign': return businessSignParts();
    case 'shopSign': return shopSignParts();
    case 'poster': return posterParts();
    case 'hospitalSign': return hospitalSignParts();
    case 'policeSign': return policeSignParts();
    case 'bookStack': return bookStackParts();
    case 'recordPlayer': return recordPlayerParts();
    case 'vinylRecord': return vinylRecordParts();
    case 'albumCover': return albumCoverParts();
    case 'speaker': return speakerParts();
    case 'speakerStack': return speakerStackParts();
    case 'cassette': return cassetteParts();
    case 'fountain': return fountainParts();
    case 'drinkingFountain': return drinkingFountainParts();
    case 'loungeChair': return loungeChairParts();
    case 'swingset': return swingsetParts();
    case 'sandCastle': return sandCastleParts();
    case 'picketFence': return picketFenceParts();
    case 'appleTree': return appleTreeParts();
    case 'apple': return appleParts();
    case 'arcadeCabinet': return arcadeCabinetParts();
    case 'slotMachine': return slotMachineParts();
    case 'clothingRack': return clothingRackParts();
    case 'displayCase': return displayCaseParts();
    case 'liquorShelf': return liquorShelfParts();
    case 'beerCase': return beerCaseParts();
    case 'dinerBooth': return dinerBoothParts();
    case 'orderCounter': return orderCounterParts();
    case 'menuBoard': return menuBoardParts();
    case 'sodaMachine': return sodaMachineParts();
    case 'openSign': return openSignParts();
    case 'greenCrossSign': return greenCrossSignParts();
    default: {
      // data-recipe kinds (propModels.RECIPES) resolve here; the two paths agree
      // by construction since everyone calls this one function.
      const recipe = propModelParts(kind);
      if (recipe) return recipe;
      // registry-derived placeholder for any kind without a recipe case.
      const fallback: readonly [number, number, number] = [def.footprintRadiusMeters * 2, def.heightMeters, def.footprintRadiusMeters * 2];
      return [{ shape: 'box', local: [0, fallback[1] / 2, 0], size: fallback, color: propColor(kind) }];
    }
  }
}
