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
import { type Color, type PropPartSpec } from '../../game/kinds/propModels';
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
import { grassPatchParts } from './grassPatch';
import { grassTallParts } from './grassTall';
import { rockJaggedParts } from './rockJagged';
import { rockShardParts } from './rockShard';
import { boulderParts } from './boulder';
import { bushParts } from './bush';
import { diningChairParts } from './diningChair';
import { armchairParts } from './armchair';
import { officeChairParts } from './officeChair';
import { foldingChairParts } from './foldingChair';
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
import { barStoolParts } from './barStool';
import { bathtubParts } from './bathtub';
import { blenderParts } from './blender';
import { bongParts } from './bong';
import { bookcaseParts } from './bookcase';
import { bottleParts } from './bottle';
import { bowlParts } from './bowl';
import { broomParts } from './broom';
import { bucketParts } from './bucket';
import { bunkBedParts } from './bunkBed';
import { canParts } from './can';
import { cardboardBoxParts } from './cardboardBox';
import { chaiseLoungeParts } from './chaiseLounge';
import { clockParts } from './clock';
import { coatRackParts } from './coatRack';
import { coffeeTableParts } from './coffeeTable';
import { computerDeskParts } from './computerDesk';
import { conferenceTableParts } from './conferenceTable';
import { cupParts } from './cup';
import { curtainParts } from './curtain';
import { deskLampParts } from './deskLamp';
import { diceParts } from './dice';
import { diningTableParts } from './diningTable';
import { directorsChairParts } from './directorsChair';
import { displayShelfParts } from './displayShelf';
import { draftingTableParts } from './draftingTable';
import { dresserParts } from './dresser';
import { dryerParts } from './dryer';
import { endTableParts } from './endTable';
import { exitSignParts } from './exitSign';
import { filingCabinetParts } from './filingCabinet';
import { fireExtinguisherParts } from './fireExtinguisher';
import { fishOnWallParts } from './fishOnWall';
import { fishWallParts } from './fishWall';
import { fishtankParts } from './fishtank';
import { forkParts } from './fork';
import { gameConsoleParts } from './gameConsole';
import { highChairParts } from './highChair';
import { hospitalBedParts } from './hospitalBed';
import { jarParts } from './jar';
import { katanaParts } from './katana';
import { keyboardParts } from './keyboard';
import { knifeParts } from './knife';
import { laptopParts } from './laptop';
import { loveseatParts } from './loveseat';
import { magazineRackParts } from './magazineRack';
import { makeupParts } from './makeup';
import { makeupPaletteParts } from './makeupPalette';
import { mattressParts } from './mattress';
import { microwaveParts } from './microwave';
import { monitorParts } from './monitor';
import { mugParts } from './mug';
import { monumentParts } from './monument';
import { neonSignParts } from './neonSign';
import { blockLettersParts } from './blockText';
import { officeDeskParts } from './officeDesk';
import { phoneParts } from './phone';
import { plateParts } from './plate';
import { sodaCanParts } from './sodaCan';
import { soupCanParts } from './soupCan';
import { spoonParts } from './spoon';
import { pokerTableParts } from './pokerTable';
import { pottedPlantParts } from './pottedPlant';
import { printerParts } from './printer';
import { radiatorParts } from './radiator';
import { receptionDeskParts } from './receptionDesk';
import { reclinerParts } from './recliner';
import { rockingChairParts } from './rockingChair';
import { routerParts } from './router';
import { rugParts } from './rug';
import { safeParts } from './safe';
import { serverRackParts } from './serverRack';
import { showerParts } from './shower';
import { sofaParts } from './sofa';
import { stageParts } from './stage';
import { standingDeskParts } from './standingDesk';
import { stoolParts } from './stool';
import { storageBinParts } from './storageBin';
import { storageShelfParts } from './storageShelf';
import { tabletParts } from './tablet';
import { toasterParts } from './toaster';
import { toiletParts } from './toilet';
import { towelParts } from './towel';
import { towelRackParts } from './towelRack';
import { tvParts } from './tv';
import { tvCRTParts } from './tvCRT';
import { tvFlatParts } from './tvFlat';
import { tvStandParts } from './tvStand';
import { vaseParts } from './vase';
import { wallSconceParts } from './wallSconce';
import { waterBottleParts } from './waterBottle';
import { wineBottleParts } from './wineBottle';
import { wallShelfParts } from './wallShelf';
import { wardrobeParts } from './wardrobe';
import { washingMachineParts } from './washingMachine';
import { waterCoolerParts } from './waterCooler';
import { beanBagParts } from './beanBag';
import { ceilingLampParts } from './ceilingLamp';
import { chalkboardParts } from './chalkboard';
import { classroomDeskParts } from './classroomDesk';
import { consoleTableParts } from './consoleTable';
import { corkboardParts } from './corkboard';
import { cornerDeskParts } from './cornerDesk';
import { daybedParts } from './daybed';
import { dvdShelfParts } from './dvdShelf';
import { floatingShelfParts } from './floatingShelf';
import { futonParts } from './futon';
import { nightstandParts } from './nightstand';
import { noticeBoardParts } from './noticeBoard';
import { ottomanParts } from './ottoman';
import { patioChairParts } from './patioChair';
import { picnicTableParts } from './picnicTable';
import { posterLargeParts } from './posterLarge';
import { posterSmallParts } from './posterSmall';
import { posterTallParts } from './posterTall';
import { posterWideParts } from './posterWide';
import { sectionalParts } from './sectional';
import { sideTableParts } from './sideTable';
import { toolCabinetParts } from './toolCabinet';
import { toolShelfParts } from './toolShelf';
import { whiteboardParts } from './whiteboard';
import { wineRackParts } from './wineRack';
import { wireShelfParts } from './wireShelf';
import { workbenchParts } from './workbench';
import { writingDeskParts } from './writingDesk';

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
 *  footprint all read the SAME geometry. Each kind resolves to its own per-prop
 *  file; anything without one gets a registry-derived placeholder box. */
export function resolvePropParts(prop: WorldProp): PropPartSpec[] {
  // PARAMETRIC props (req_0893): the recipe is a function of the instance's
  // `text`, not the kind alone. These are the ONLY kinds that read the WorldProp
  // beyond its kind; everything else resolves purely by kind (and so shares the
  // footprint path below, which has no instance).
  switch (prop.kind) {
    case 'blockLetters':
      return blockLettersParts(propKindDefinition('blockLetters').heightMeters, prop.text);
    default:
      return resolvePartsForKind(prop.kind);
  }
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
    case 'diningChair': return diningChairParts();
    case 'armchair': return armchairParts();
    case 'officeChair': return officeChairParts();
    case 'foldingChair': return foldingChairParts();
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
    case 'grassPatch': return grassPatchParts();
    case 'grassTall': return grassTallParts();
    case 'rockJagged': return rockJaggedParts();
    case 'rockShard': return rockShardParts();
    case 'barStool': return barStoolParts();
    case 'bathtub': return bathtubParts();
    case 'blender': return blenderParts();
    case 'bong': return bongParts();
    case 'bookcase': return bookcaseParts();
    case 'bottle': return bottleParts();
    case 'bowl': return bowlParts();
    case 'broom': return broomParts();
    case 'bucket': return bucketParts();
    case 'bunkBed': return bunkBedParts();
    case 'can': return canParts();
    case 'cardboardBox': return cardboardBoxParts();
    case 'chaiseLounge': return chaiseLoungeParts();
    case 'clock': return clockParts();
    case 'coatRack': return coatRackParts();
    case 'coffeeTable': return coffeeTableParts();
    case 'computerDesk': return computerDeskParts();
    case 'conferenceTable': return conferenceTableParts();
    case 'cup': return cupParts();
    case 'curtain': return curtainParts();
    case 'deskLamp': return deskLampParts();
    case 'dice': return diceParts();
    case 'diningTable': return diningTableParts();
    case 'directorsChair': return directorsChairParts();
    case 'displayShelf': return displayShelfParts();
    case 'draftingTable': return draftingTableParts();
    case 'dresser': return dresserParts();
    case 'dryer': return dryerParts();
    case 'endTable': return endTableParts();
    case 'exitSign': return exitSignParts();
    case 'filingCabinet': return filingCabinetParts();
    case 'fireExtinguisher': return fireExtinguisherParts();
    case 'fishOnWall': return fishOnWallParts();
    case 'fishWall': return fishWallParts();
    case 'fishtank': return fishtankParts();
    case 'fork': return forkParts();
    case 'gameConsole': return gameConsoleParts();
    case 'highChair': return highChairParts();
    case 'hospitalBed': return hospitalBedParts();
    case 'jar': return jarParts();
    case 'katana': return katanaParts();
    case 'keyboard': return keyboardParts();
    case 'knife': return knifeParts();
    case 'laptop': return laptopParts();
    case 'loveseat': return loveseatParts();
    case 'magazineRack': return magazineRackParts();
    case 'makeup': return makeupParts();
    case 'makeupPalette': return makeupPaletteParts();
    case 'mattress': return mattressParts();
    case 'mug': return mugParts();
    case 'microwave': return microwaveParts();
    case 'monitor': return monitorParts();
    case 'monument': return monumentParts();
    case 'neonSign': return neonSignParts();
    // PARAMETRIC: no instance here, so lower the DEFAULT word — this path only
    // feeds the measured collision footprint. The live geometry comes through
    // resolvePropParts (above), which passes the placement's real text.
    case 'blockLetters': return blockLettersParts(def.heightMeters);
    case 'officeDesk': return officeDeskParts();
    case 'phone': return phoneParts();
    case 'plate': return plateParts();
    case 'sodaCan': return sodaCanParts();
    case 'soupCan': return soupCanParts();
    case 'spoon': return spoonParts();
    case 'pokerTable': return pokerTableParts();
    case 'pottedPlant': return pottedPlantParts();
    case 'printer': return printerParts();
    case 'radiator': return radiatorParts();
    case 'receptionDesk': return receptionDeskParts();
    case 'recliner': return reclinerParts();
    case 'rockingChair': return rockingChairParts();
    case 'router': return routerParts();
    case 'rug': return rugParts();
    case 'safe': return safeParts();
    case 'serverRack': return serverRackParts();
    case 'shower': return showerParts();
    case 'sofa': return sofaParts();
    case 'stage': return stageParts();
    case 'standingDesk': return standingDeskParts();
    case 'stool': return stoolParts();
    case 'storageBin': return storageBinParts();
    case 'storageShelf': return storageShelfParts();
    case 'tablet': return tabletParts();
    case 'toaster': return toasterParts();
    case 'toilet': return toiletParts();
    case 'towel': return towelParts();
    case 'towelRack': return towelRackParts();
    case 'tv': return tvParts();
    case 'tvCRT': return tvCRTParts();
    case 'tvFlat': return tvFlatParts();
    case 'tvStand': return tvStandParts();
    case 'vase': return vaseParts();
    case 'wallSconce': return wallSconceParts();
    case 'wallShelf': return wallShelfParts();
    case 'waterBottle': return waterBottleParts();
    case 'wineBottle': return wineBottleParts();
    case 'wardrobe': return wardrobeParts();
    case 'washingMachine': return washingMachineParts();
    case 'waterCooler': return waterCoolerParts();
    case 'beanBag': return beanBagParts();
    case 'ceilingLamp': return ceilingLampParts();
    case 'chalkboard': return chalkboardParts();
    case 'classroomDesk': return classroomDeskParts();
    case 'consoleTable': return consoleTableParts();
    case 'corkboard': return corkboardParts();
    case 'cornerDesk': return cornerDeskParts();
    case 'daybed': return daybedParts();
    case 'dvdShelf': return dvdShelfParts();
    case 'floatingShelf': return floatingShelfParts();
    case 'futon': return futonParts();
    case 'nightstand': return nightstandParts();
    case 'noticeBoard': return noticeBoardParts();
    case 'ottoman': return ottomanParts();
    case 'patioChair': return patioChairParts();
    case 'picnicTable': return picnicTableParts();
    case 'posterLarge': return posterLargeParts();
    case 'posterSmall': return posterSmallParts();
    case 'posterTall': return posterTallParts();
    case 'posterWide': return posterWideParts();
    case 'sectional': return sectionalParts();
    case 'sideTable': return sideTableParts();
    case 'toolCabinet': return toolCabinetParts();
    case 'toolShelf': return toolShelfParts();
    case 'whiteboard': return whiteboardParts();
    case 'wineRack': return wineRackParts();
    case 'wireShelf': return wireShelfParts();
    case 'workbench': return workbenchParts();
    case 'writingDesk': return writingDeskParts();
    default: {
      // Any kind without its own recipe file gets a registry-derived placeholder
      // box (sized from its footprint/height). Imported/bespoke props may carry an
      // explicit width/depth pair; use it so physics sees the measured rectangle
      // instead of a coarse radius square (FOOTPRINT-0756).
      const width = def.footprintWidthMeters ?? def.footprintRadiusMeters * 2;
      const depth = def.footprintDepthMeters ?? def.footprintRadiusMeters * 2;
      const fallback: readonly [number, number, number] = [width, def.heightMeters, depth];
      return [{ shape: 'box', local: [0, fallback[1] / 2, 0], size: fallback, color: propColor(kind) }];
    }
  }
}
