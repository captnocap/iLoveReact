// game/kinds/props — the prop-kind registry: the pure, render-free property
// bundle for every prop kind. THE TABLE IS THE DATA (P2). The struct stores
// `kind`; this registry gives it meaning. Both the physics/pathing layer and
// the 3D prop models resolve a prop through here, so a hydrant's collision
// footprint and its mesh agree on one radius and one height. 1 tile = 1 meter.
//
// A prop borrows its gameplay property bundle (cover, concealment, line of
// sight, noise) from a TILE kind via `tileKind` — a bush points at the 'bush'
// foliage tile (walk-through, high concealment); solid obstacles point at
// 'wall' (they block sight and give cover). This is how a placement "gets all
// the property ideas of a tile" without a parallel schema.
//
// THE ONE TABLE since PROPMERGE-0611 (review §13.1): the legacy twin
// world/propKinds.ts is retired and every consumer — the editor palette,
// PropertiesPanel, placements, host physics, traffic, the prop meshes, AND
// compile/worldGeometry — resolves through here. The split-consumer
// divergence hazard (editor+compile on one table, the game door on another)
// is dead; a prop value edited here is the value everywhere.
// (Originally a fresh capture of cart/hmsc/world/propKinds.ts.)

import type { TileCoverHeight, TileKind } from './tiles';
import type { BuildPieceKind, BuildSnapMode } from '../build/pieces';
import {
  IMPORTED_PROP_DEFINITIONS,
  IMPORTED_PROP_KINDS,
  type ImportedPropKind,
} from './importedProps.generated';
// Per-prop defs live in each prop's own file (the file with the most data owns
// it); this registry assembles them. Migrating prop-by-prop — chairs first.
import { diningChairDef } from '../../compile/propRecipes/diningChair';
import { armchairDef } from '../../compile/propRecipes/armchair';
import { officeChairDef } from '../../compile/propRecipes/officeChair';
import { foldingChairDef } from '../../compile/propRecipes/foldingChair';
import { fireHydrantDef } from '../../compile/propRecipes/fireHydrant';
import { streetSignDef } from '../../compile/propRecipes/streetSign';
import { streetLightDef } from '../../compile/propRecipes/streetLight';
import { stopSignDef } from '../../compile/propRecipes/stopSign';
import { trafficLightDef } from '../../compile/propRecipes/trafficLight';
import { treeOakDef } from '../../compile/propRecipes/treeOak';
import { treePineDef } from '../../compile/propRecipes/treePine';
import { treeBirchDef } from '../../compile/propRecipes/treeBirch';
import { treeCypressDef } from '../../compile/propRecipes/treeCypress';
import { treePalmDef } from '../../compile/propRecipes/treePalm';
import { treeDeadDef } from '../../compile/propRecipes/treeDead';
import { boulderDef } from '../../compile/propRecipes/boulder';
import { rockFlatDef } from '../../compile/propRecipes/rockFlat';
import { rockSpireDef } from '../../compile/propRecipes/rockSpire';
import { rockMossyDef } from '../../compile/propRecipes/rockMossy';
import { rockPileDef } from '../../compile/propRecipes/rockPile';
import { payphoneDef } from '../../compile/propRecipes/payphone';
import { mailboxDef } from '../../compile/propRecipes/mailbox';
import { fenceDef } from '../../compile/propRecipes/fence';
import { trafficConeDef } from '../../compile/propRecipes/trafficCone';
import { barrierDef } from '../../compile/propRecipes/barrier';
import { trashCanDef } from '../../compile/propRecipes/trashCan';
import { benchDef } from '../../compile/propRecipes/bench';
import { planterDef } from '../../compile/propRecipes/planter';
import { ballBeachDef } from '../../compile/propRecipes/ballBeach';
import { ballSoccerDef } from '../../compile/propRecipes/ballSoccer';
import { ballBasketballDef } from '../../compile/propRecipes/ballBasketball';
import { wallPaintingDef } from '../../compile/propRecipes/wallPainting';
import { ledLightDef } from '../../compile/propRecipes/ledLight';
import { couchDef } from '../../compile/propRecipes/couch';
import { tableDef } from '../../compile/propRecipes/table';
import { floorLampDef } from '../../compile/propRecipes/floorLamp';
import { cupboardDef } from '../../compile/propRecipes/cupboard';
import { mirrorDef } from '../../compile/propRecipes/mirror';
import { sinkDef } from '../../compile/propRecipes/sink';
import { ovenDef } from '../../compile/propRecipes/oven';
import { fridgeDef } from '../../compile/propRecipes/fridge';
import { computerDef } from '../../compile/propRecipes/computer';
import { telephonePoleDef } from '../../compile/propRecipes/telephonePole';
import { basketballHoopDef } from '../../compile/propRecipes/basketballHoop';
import { radioTowerDef } from '../../compile/propRecipes/radioTower';
import { gasPumpDef } from '../../compile/propRecipes/gasPump';
import { vendingMachineDef } from '../../compile/propRecipes/vendingMachine';
import { storeShelfDef } from '../../compile/propRecipes/storeShelf';
import { businessSignDef } from '../../compile/propRecipes/businessSign';
import { shopSignDef } from '../../compile/propRecipes/shopSign';
import { posterDef } from '../../compile/propRecipes/poster';
import { hospitalSignDef } from '../../compile/propRecipes/hospitalSign';
import { policeSignDef } from '../../compile/propRecipes/policeSign';
import { bookStackDef } from '../../compile/propRecipes/bookStack';
import { recordPlayerDef } from '../../compile/propRecipes/recordPlayer';
import { vinylRecordDef } from '../../compile/propRecipes/vinylRecord';
import { albumCoverDef } from '../../compile/propRecipes/albumCover';
import { speakerDef } from '../../compile/propRecipes/speaker';
import { speakerStackDef } from '../../compile/propRecipes/speakerStack';
import { cassetteDef } from '../../compile/propRecipes/cassette';
import { shippingContainerDef } from '../../compile/propRecipes/shippingContainer';
import { concretePipeDef } from '../../compile/propRecipes/concretePipe';
import { pipeStackDef } from '../../compile/propRecipes/pipeStack';
import { corrugatedSheetDef } from '../../compile/propRecipes/corrugatedSheet';
import { cableSpoolDef } from '../../compile/propRecipes/cableSpool';
import { lockerSetDef } from '../../compile/propRecipes/lockerSet';
import { oilTankDef } from '../../compile/propRecipes/oilTank';
import { tireDef } from '../../compile/propRecipes/tire';
import { tireStackDef } from '../../compile/propRecipes/tireStack';
import { barrelDef } from '../../compile/propRecipes/barrel';
import { steelDrumDef } from '../../compile/propRecipes/steelDrum';
import { propaneTankDef } from '../../compile/propRecipes/propaneTank';
import { jerryCanDef } from '../../compile/propRecipes/jerryCan';
import { cinderBlockDef } from '../../compile/propRecipes/cinderBlock';
import { brickDef } from '../../compile/propRecipes/brick';
import { rubblePileDef } from '../../compile/propRecipes/rubblePile';
import { crateDef } from '../../compile/propRecipes/crate';
import { palletDef } from '../../compile/propRecipes/pallet';
import { palletStackDef } from '../../compile/propRecipes/palletStack';
import { toiletPaperDef } from '../../compile/propRecipes/toiletPaper';
import { fountainDef } from '../../compile/propRecipes/fountain';
import { drinkingFountainDef } from '../../compile/propRecipes/drinkingFountain';
import { loungeChairDef } from '../../compile/propRecipes/loungeChair';
import { swingsetDef } from '../../compile/propRecipes/swingset';
import { sandCastleDef } from '../../compile/propRecipes/sandCastle';
import { picketFenceDef } from '../../compile/propRecipes/picketFence';
import { appleTreeDef } from '../../compile/propRecipes/appleTree';

import { barStoolDef } from '../../compile/propRecipes/barStool';
import { bathtubDef } from '../../compile/propRecipes/bathtub';
import { blenderDef } from '../../compile/propRecipes/blender';
import { bongDef } from '../../compile/propRecipes/bong';
import { bookcaseDef } from '../../compile/propRecipes/bookcase';
import { bottleDef } from '../../compile/propRecipes/bottle';
import { bowlDef } from '../../compile/propRecipes/bowl';
import { broomDef } from '../../compile/propRecipes/broom';
import { bucketDef } from '../../compile/propRecipes/bucket';
import { bunkBedDef } from '../../compile/propRecipes/bunkBed';
import { canDef } from '../../compile/propRecipes/can';
import { cardboardBoxDef } from '../../compile/propRecipes/cardboardBox';
import { chaiseLoungeDef } from '../../compile/propRecipes/chaiseLounge';
import { clockDef } from '../../compile/propRecipes/clock';
import { coatRackDef } from '../../compile/propRecipes/coatRack';
import { coffeeTableDef } from '../../compile/propRecipes/coffeeTable';
import { computerDeskDef } from '../../compile/propRecipes/computerDesk';
import { conferenceTableDef } from '../../compile/propRecipes/conferenceTable';
import { cupDef } from '../../compile/propRecipes/cup';
import { curtainDef } from '../../compile/propRecipes/curtain';
import { deskLampDef } from '../../compile/propRecipes/deskLamp';
import { diceDef } from '../../compile/propRecipes/dice';
import { diningTableDef } from '../../compile/propRecipes/diningTable';
import { directorsChairDef } from '../../compile/propRecipes/directorsChair';
import { displayShelfDef } from '../../compile/propRecipes/displayShelf';
import { draftingTableDef } from '../../compile/propRecipes/draftingTable';
import { dresserDef } from '../../compile/propRecipes/dresser';
import { dryerDef } from '../../compile/propRecipes/dryer';
import { endTableDef } from '../../compile/propRecipes/endTable';
import { exitSignDef } from '../../compile/propRecipes/exitSign';
import { filingCabinetDef } from '../../compile/propRecipes/filingCabinet';
import { fireExtinguisherDef } from '../../compile/propRecipes/fireExtinguisher';
import { fishOnWallDef } from '../../compile/propRecipes/fishOnWall';
import { fishtankDef } from '../../compile/propRecipes/fishtank';
import { forkDef } from '../../compile/propRecipes/fork';
import { gameConsoleDef } from '../../compile/propRecipes/gameConsole';
import { highChairDef } from '../../compile/propRecipes/highChair';
import { hospitalBedDef } from '../../compile/propRecipes/hospitalBed';
import { jarDef } from '../../compile/propRecipes/jar';
import { katanaDef } from '../../compile/propRecipes/katana';
import { keyboardDef } from '../../compile/propRecipes/keyboard';
import { knifeDef } from '../../compile/propRecipes/knife';
import { laptopDef } from '../../compile/propRecipes/laptop';
import { loveseatDef } from '../../compile/propRecipes/loveseat';
import { magazineRackDef } from '../../compile/propRecipes/magazineRack';
import { makeupDef } from '../../compile/propRecipes/makeup';
import { mattressDef } from '../../compile/propRecipes/mattress';
import { microwaveDef } from '../../compile/propRecipes/microwave';
import { monitorDef } from '../../compile/propRecipes/monitor';
import { monumentDef } from '../../compile/propRecipes/monument';
import { neonSignDef } from '../../compile/propRecipes/neonSign';
import { blockLettersDef } from '../../compile/propRecipes/blockText';
import { neonLogoDef } from '../../compile/propRecipes/neonLogo';
import { neonLogoDoubleDef } from '../../compile/propRecipes/neonLogoDouble';
import { ledTickerDef } from '../../compile/propRecipes/ledTicker';
import { officeDeskDef } from '../../compile/propRecipes/officeDesk';
import { phoneDef } from '../../compile/propRecipes/phone';
import { plateDef } from '../../compile/propRecipes/plate';
import { pokerTableDef } from '../../compile/propRecipes/pokerTable';
import { pottedPlantDef } from '../../compile/propRecipes/pottedPlant';
import { printerDef } from '../../compile/propRecipes/printer';
import { radiatorDef } from '../../compile/propRecipes/radiator';
import { receptionDeskDef } from '../../compile/propRecipes/receptionDesk';
import { reclinerDef } from '../../compile/propRecipes/recliner';
import { rockingChairDef } from '../../compile/propRecipes/rockingChair';
import { routerDef } from '../../compile/propRecipes/router';
import { rugDef } from '../../compile/propRecipes/rug';
import { safeDef } from '../../compile/propRecipes/safe';
import { serverRackDef } from '../../compile/propRecipes/serverRack';
import { showerDef } from '../../compile/propRecipes/shower';
import { sofaDef } from '../../compile/propRecipes/sofa';
import { stageDef } from '../../compile/propRecipes/stage';
import { standingDeskDef } from '../../compile/propRecipes/standingDesk';
import { stoolDef } from '../../compile/propRecipes/stool';
import { storageBinDef } from '../../compile/propRecipes/storageBin';
import { storageShelfDef } from '../../compile/propRecipes/storageShelf';
import { tabletDef } from '../../compile/propRecipes/tablet';
import { toasterDef } from '../../compile/propRecipes/toaster';
import { toiletDef } from '../../compile/propRecipes/toilet';
import { towelDef } from '../../compile/propRecipes/towel';
import { tvDef } from '../../compile/propRecipes/tv';
import { tvStandDef } from '../../compile/propRecipes/tvStand';
import { vaseDef } from '../../compile/propRecipes/vase';
import { wallSconceDef } from '../../compile/propRecipes/wallSconce';
import { wallShelfDef } from '../../compile/propRecipes/wallShelf';
import { wardrobeDef } from '../../compile/propRecipes/wardrobe';
import { washingMachineDef } from '../../compile/propRecipes/washingMachine';
import { waterCoolerDef } from '../../compile/propRecipes/waterCooler';
import { rockDef } from '../../compile/propRecipes/rock';
import { rockLargeDef } from '../../compile/propRecipes/rockLarge';
import { rockSmallDef } from '../../compile/propRecipes/rockSmall';
import { bushDef } from '../../compile/propRecipes/bush';
import { bushLargeDef } from '../../compile/propRecipes/bushLarge';
import { bushLowDef } from '../../compile/propRecipes/bushLow';
import { bushSparseDef } from '../../compile/propRecipes/bushSparse';
import { dumpsterDef } from '../../compile/propRecipes/dumpster';
import { bedSingleDef } from '../../compile/propRecipes/bedSingle';
import { bedDoubleDef } from '../../compile/propRecipes/bedDouble';
import { grassPatchDef } from '../../compile/propRecipes/grassPatch';
import { grassTallDef } from '../../compile/propRecipes/grassTall';
import { rockJaggedDef } from '../../compile/propRecipes/rockJagged';
import { rockShardDef } from '../../compile/propRecipes/rockShard';
import { treeOakYoungDef } from '../../compile/propRecipes/treeOakYoung';
import { treeOakGiantDef } from '../../compile/propRecipes/treeOakGiant';
import { treePineYoungDef } from '../../compile/propRecipes/treePineYoung';
import { treePineGiantDef } from '../../compile/propRecipes/treePineGiant';
import { appleDef } from '../../compile/propRecipes/apple';
import { arcadeCabinetDef } from '../../compile/propRecipes/arcadeCabinet';
import { slotMachineDef } from '../../compile/propRecipes/slotMachine';
import { clothingRackDef } from '../../compile/propRecipes/clothingRack';
import { displayCaseDef } from '../../compile/propRecipes/displayCase';
import { liquorShelfDef } from '../../compile/propRecipes/liquorShelf';
import { beerCaseDef } from '../../compile/propRecipes/beerCase';
import { dinerBoothDef } from '../../compile/propRecipes/dinerBooth';
import { orderCounterDef } from '../../compile/propRecipes/orderCounter';
import { menuBoardDef } from '../../compile/propRecipes/menuBoard';
import { sodaMachineDef } from '../../compile/propRecipes/sodaMachine';
import { openSignDef } from '../../compile/propRecipes/openSign';
import { greenCrossSignDef } from '../../compile/propRecipes/greenCrossSign';
import { sodaCanDef } from '../../compile/propRecipes/sodaCan';
import { soupCanDef } from '../../compile/propRecipes/soupCan';
import { mugDef } from '../../compile/propRecipes/mug';
import { spoonDef } from '../../compile/propRecipes/spoon';
import { waterBottleDef } from '../../compile/propRecipes/waterBottle';
import { wineBottleDef } from '../../compile/propRecipes/wineBottle';
import { makeupPaletteDef } from '../../compile/propRecipes/makeupPalette';
import { towelRackDef } from '../../compile/propRecipes/towelRack';
import { tvCRTDef } from '../../compile/propRecipes/tvCRT';
import { tvFlatDef } from '../../compile/propRecipes/tvFlat';
import { fishWallDef } from '../../compile/propRecipes/fishWall';
import { beanBagDef } from '../../compile/propRecipes/beanBag';
import { ceilingLampDef } from '../../compile/propRecipes/ceilingLamp';
import { chalkboardDef } from '../../compile/propRecipes/chalkboard';
import { classroomDeskDef } from '../../compile/propRecipes/classroomDesk';
import { consoleTableDef } from '../../compile/propRecipes/consoleTable';
import { corkboardDef } from '../../compile/propRecipes/corkboard';
import { cornerDeskDef } from '../../compile/propRecipes/cornerDesk';
import { daybedDef } from '../../compile/propRecipes/daybed';
import { dvdShelfDef } from '../../compile/propRecipes/dvdShelf';
import { floatingShelfDef } from '../../compile/propRecipes/floatingShelf';
import { futonDef } from '../../compile/propRecipes/futon';
import { nightstandDef } from '../../compile/propRecipes/nightstand';
import { noticeBoardDef } from '../../compile/propRecipes/noticeBoard';
import { ottomanDef } from '../../compile/propRecipes/ottoman';
import { patioChairDef } from '../../compile/propRecipes/patioChair';
import { picnicTableDef } from '../../compile/propRecipes/picnicTable';
import { posterLargeDef } from '../../compile/propRecipes/posterLarge';
import { posterSmallDef } from '../../compile/propRecipes/posterSmall';
import { posterTallDef } from '../../compile/propRecipes/posterTall';
import { posterWideDef } from '../../compile/propRecipes/posterWide';
import { sectionalDef } from '../../compile/propRecipes/sectional';
import { sideTableDef } from '../../compile/propRecipes/sideTable';
import { toolCabinetDef } from '../../compile/propRecipes/toolCabinet';
import { toolShelfDef } from '../../compile/propRecipes/toolShelf';
import { whiteboardDef } from '../../compile/propRecipes/whiteboard';
import { wineRackDef } from '../../compile/propRecipes/wineRack';
import { wireShelfDef } from '../../compile/propRecipes/wireShelf';
import { workbenchDef } from '../../compile/propRecipes/workbench';
import { writingDeskDef } from '../../compile/propRecipes/writingDesk';

import { arcadeAirHockeyDef } from '../../compile/propRecipes/arcadeAirHockey';
import { arcadeChangeMachineDef } from '../../compile/propRecipes/arcadeChangeMachine';
import { arcadeClawDef } from '../../compile/propRecipes/arcadeClaw';
import { arcadeDanceDef } from '../../compile/propRecipes/arcadeDance';
import { arcadeFightingDef } from '../../compile/propRecipes/arcadeFighting';
import { arcadePinballDef } from '../../compile/propRecipes/arcadePinball';
import { arcadePrizeDef } from '../../compile/propRecipes/arcadePrize';
import { arcadeRacingDef } from '../../compile/propRecipes/arcadeRacing';
import { arcadeShootingDef } from '../../compile/propRecipes/arcadeShooting';
import { arcadeSkeeballDef } from '../../compile/propRecipes/arcadeSkeeball';
import { baccaratTableDef } from '../../compile/propRecipes/baccaratTable';
import { bakingSheetDef } from '../../compile/propRecipes/bakingSheet';
import { barbedWireDef } from '../../compile/propRecipes/barbedWire';
import { barrierJerseyDef } from '../../compile/propRecipes/barrierJersey';
import { barrierPlasticDef } from '../../compile/propRecipes/barrierPlastic';
import { benchBusDef } from '../../compile/propRecipes/benchBus';
import { bicycleDef } from '../../compile/propRecipes/bicycle';
import { bikeRackDef } from '../../compile/propRecipes/bikeRack';
import { blackjackTableDef } from '../../compile/propRecipes/blackjackTable';
import { bookcartDef } from '../../compile/propRecipes/bookcart';
import { bookcaseFullDef } from '../../compile/propRecipes/bookcaseFull';
import { breadBoxDef } from '../../compile/propRecipes/breadBox';
import { brokenFurnitureDef } from '../../compile/propRecipes/brokenFurniture';
import { bushBambooDef } from '../../compile/propRecipes/bushBamboo';
import { bushBerryDef } from '../../compile/propRecipes/bushBerry';
import { bushBoxwoodDef } from '../../compile/propRecipes/bushBoxwood';
import { bushFernDef } from '../../compile/propRecipes/bushFern';
import { bushHedgeDef } from '../../compile/propRecipes/bushHedge';
import { bushRoseDef } from '../../compile/propRecipes/bushRose';
import { campfireDef } from '../../compile/propRecipes/campfire';
import { carDoorDef } from '../../compile/propRecipes/carDoor';
import { cashRegisterDef } from '../../compile/propRecipes/cashRegister';
import { chainLinkFenceSectionDef } from '../../compile/propRecipes/chainLinkFenceSection';
import { coffeeMakerDef } from '../../compile/propRecipes/coffeeMaker';
import { colanderDef } from '../../compile/propRecipes/colander';
import { condimentStationDef } from '../../compile/propRecipes/condimentStation';
import { coolerDrinkDef } from '../../compile/propRecipes/coolerDrink';
import { coolerProduceDef } from '../../compile/propRecipes/coolerProduce';
import { crapsTableDef } from '../../compile/propRecipes/crapsTable';
import { crushedCarDef } from '../../compile/propRecipes/crushedCar';
import { crystalDef } from '../../compile/propRecipes/crystal';
import { cuttingBoardDef } from '../../compile/propRecipes/cuttingBoard';
import { dishRackDef } from '../../compile/propRecipes/dishRack';
import { dressFormDef } from '../../compile/propRecipes/dressForm';
import { drumKitDef } from '../../compile/propRecipes/drumKit';
import { dumpsterCardboardDef } from '../../compile/propRecipes/dumpsterCardboard';
import { dumpsterIndustrialDef } from '../../compile/propRecipes/dumpsterIndustrial';
import { dumpsterRecyclingDef } from '../../compile/propRecipes/dumpsterRecycling';
import { dumpsterSmallDef } from '../../compile/propRecipes/dumpsterSmall';
import { dumpsterTrashDef } from '../../compile/propRecipes/dumpsterTrash';
import { easelDef } from '../../compile/propRecipes/easel';
import { electricBoxDef } from '../../compile/propRecipes/electricBox';
import { engineBlockDef } from '../../compile/propRecipes/engineBlock';
import { fastFoodMenuDef } from '../../compile/propRecipes/fastFoodMenu';
import { fireHydrantYellowDef } from '../../compile/propRecipes/fireHydrantYellow';
import { freezerChestDef } from '../../compile/propRecipes/freezerChest';
import { freezerUprightDef } from '../../compile/propRecipes/freezerUpright';
import { fridgeSupermarketDef } from '../../compile/propRecipes/fridgeSupermarket';
import { fruitBowlDef } from '../../compile/propRecipes/fruitBowl';
import { fryBasketDef } from '../../compile/propRecipes/fryBasket';
import { geodeDef } from '../../compile/propRecipes/geode';
import { globeDef } from '../../compile/propRecipes/globe';
import { grassDeadDef } from '../../compile/propRecipes/grassDead';
import { grassFlowersDef } from '../../compile/propRecipes/grassFlowers';
import { grassMossDef } from '../../compile/propRecipes/grassMoss';
import { grassReedsDef } from '../../compile/propRecipes/grassReeds';
import { grassShortDef } from '../../compile/propRecipes/grassShort';
import { grillCharcoalDef } from '../../compile/propRecipes/grillCharcoal';
import { grillGasDef } from '../../compile/propRecipes/grillGas';
import { grillPitDef } from '../../compile/propRecipes/grillPit';
import { grillPropaneDef } from '../../compile/propRecipes/grillPropane';
import { grillSmokerDef } from '../../compile/propRecipes/grillSmoker';
import { guitarDef } from '../../compile/propRecipes/guitar';
import { gurneyDef } from '../../compile/propRecipes/gurney';
import { hayBaleDef } from '../../compile/propRecipes/hayBale';
import { hazardBarrelDef } from '../../compile/propRecipes/hazardBarrel';
import { hoseDef } from '../../compile/propRecipes/hose';
import { hvacUnitDef } from '../../compile/propRecipes/hvacUnit';
import { kenoMachineDef } from '../../compile/propRecipes/kenoMachine';
import { kettleDef } from '../../compile/propRecipes/kettle';
import { knifeBlockDef } from '../../compile/propRecipes/knifeBlock';
import { ladderDef } from '../../compile/propRecipes/ladder';
import { lavaRockDef } from '../../compile/propRecipes/lavaRock';
import { libraryShelfDef } from '../../compile/propRecipes/libraryShelf';
import { lifeguardTowerDef } from '../../compile/propRecipes/lifeguardTower';
import { luggageCartDef } from '../../compile/propRecipes/luggageCart';
import { mailboxApartmentDef } from '../../compile/propRecipes/mailboxApartment';
import { mailboxNewspaperDef } from '../../compile/propRecipes/mailboxNewspaper';
import { mailboxResidentialDef } from '../../compile/propRecipes/mailboxResidential';
import { mailboxWallDef } from '../../compile/propRecipes/mailboxWall';
import { mannequinDef } from '../../compile/propRecipes/mannequin';
import { merryGoRoundDef } from '../../compile/propRecipes/merryGoRound';
import { microscopeDef } from '../../compile/propRecipes/microscope';
import { mixerDef } from '../../compile/propRecipes/mixer';
import { newspaperBoxDef } from '../../compile/propRecipes/newspaperBox';
import { oxygenTankDef } from '../../compile/propRecipes/oxygenTank';
import { pachinkoMachineDef } from '../../compile/propRecipes/pachinkoMachine';
import { packageDropBoxDef } from '../../compile/propRecipes/packageDropBox';
import { panDef } from '../../compile/propRecipes/pan';
import { parkingMeterDef } from '../../compile/propRecipes/parkingMeter';
import { parkingMeterDoubleDef } from '../../compile/propRecipes/parkingMeterDouble';
import { pebbleDef } from '../../compile/propRecipes/pebble';
import { pepperShakerDef } from '../../compile/propRecipes/pepperShaker';
import { picnicBlanketDef } from '../../compile/propRecipes/picnicBlanket';
import { plantCactusDef } from '../../compile/propRecipes/plantCactus';
import { plantCactusLargeDef } from '../../compile/propRecipes/plantCactusLarge';
import { plantFicusDef } from '../../compile/propRecipes/plantFicus';
import { plantHangingDef } from '../../compile/propRecipes/plantHanging';
import { plantMonsteraDef } from '../../compile/propRecipes/plantMonstera';
import { plantPalmDef } from '../../compile/propRecipes/plantPalm';
import { plantRoseDef } from '../../compile/propRecipes/plantRose';
import { plantSucculentDef } from '../../compile/propRecipes/plantSucculent';
import { plantSunflowerDef } from '../../compile/propRecipes/plantSunflower';
import { plantVineDef } from '../../compile/propRecipes/plantVine';
import { planterBoxDef } from '../../compile/propRecipes/planterBox';
import { portaPottyDef } from '../../compile/propRecipes/portaPotty';
import { potDef } from '../../compile/propRecipes/pot';
import { roadSignBikeDef } from '../../compile/propRecipes/roadSignBike';
import { roadSignConstructionDef } from '../../compile/propRecipes/roadSignConstruction';
import { roadSignDoNotEnterDef } from '../../compile/propRecipes/roadSignDoNotEnter';
import { roadSignNoParkingDef } from '../../compile/propRecipes/roadSignNoParking';
import { roadSignOneWayDef } from '../../compile/propRecipes/roadSignOneWay';
import { roadSignParkingDef } from '../../compile/propRecipes/roadSignParking';
import { roadSignPedestrianDef } from '../../compile/propRecipes/roadSignPedestrian';
import { roadSignSchoolDef } from '../../compile/propRecipes/roadSignSchool';
import { roadSignSpeedLimitDef } from '../../compile/propRecipes/roadSignSpeedLimit';
import { roadSignYieldDef } from '../../compile/propRecipes/roadSignYield';
import { rockCoralDef } from '../../compile/propRecipes/rockCoral';
import { rockGraniteDef } from '../../compile/propRecipes/rockGranite';
import { rockLimestoneDef } from '../../compile/propRecipes/rockLimestone';
import { rockObsidianDef } from '../../compile/propRecipes/rockObsidian';
import { rockQuartzDef } from '../../compile/propRecipes/rockQuartz';
import { rockSandstoneDef } from '../../compile/propRecipes/rockSandstone';
import { rockSlateDef } from '../../compile/propRecipes/rockSlate';
import { rollingPinDef } from '../../compile/propRecipes/rollingPin';
import { rouletteTableDef } from '../../compile/propRecipes/rouletteTable';
import { rugOrientalDef } from '../../compile/propRecipes/rugOriental';
import { rugRoundDef } from '../../compile/propRecipes/rugRound';
import { rugRunnerDef } from '../../compile/propRecipes/rugRunner';
import { rustedBarrelDef } from '../../compile/propRecipes/rustedBarrel';
import { saltShakerDef } from '../../compile/propRecipes/saltShaker';
import { sandbagDef } from '../../compile/propRecipes/sandbag';
import { satelliteDishDef } from '../../compile/propRecipes/satelliteDish';
import { scaffoldDef } from '../../compile/propRecipes/scaffold';
import { scarecrowDef } from '../../compile/propRecipes/scarecrow';
import { scrapMetalDef } from '../../compile/propRecipes/scrapMetal';
import { scrapPileDef } from '../../compile/propRecipes/scrapPile';
import { sculptureDef } from '../../compile/propRecipes/sculpture';
import { securityCameraDef } from '../../compile/propRecipes/securityCamera';
import { shoppingBasketDef } from '../../compile/propRecipes/shoppingBasket';
import { shoppingCartDef } from '../../compile/propRecipes/shoppingCart';
import { slideDef } from '../../compile/propRecipes/slide';
import { slotMachineDigitalDef } from '../../compile/propRecipes/slotMachineDigital';
import { slotMachinePokerDef } from '../../compile/propRecipes/slotMachinePoker';
import { slotMachineVintageDef } from '../../compile/propRecipes/slotMachineVintage';
import { soccerGoalDef } from '../../compile/propRecipes/soccerGoal';
import { sodaCupDef } from '../../compile/propRecipes/sodaCup';
import { spiceRackDef } from '../../compile/propRecipes/spiceRack';
import { streetLightVintageDef } from '../../compile/propRecipes/streetLightVintage';
import { tentDef } from '../../compile/propRecipes/tent';
import { toiletBidetDef } from '../../compile/propRecipes/toiletBidet';
import { toiletPortableDef } from '../../compile/propRecipes/toiletPortable';
import { toiletStallDef } from '../../compile/propRecipes/toiletStall';
import { tombstoneDef } from '../../compile/propRecipes/tombstone';
import { toolboxDef } from '../../compile/propRecipes/toolbox';
import { trafficConeLargeDef } from '../../compile/propRecipes/trafficConeLarge';
import { trampolineDef } from '../../compile/propRecipes/trampoline';
import { trashCanRecyclingDef } from '../../compile/propRecipes/trashCanRecycling';
import { treadmillDef } from '../../compile/propRecipes/treadmill';
import { treeAcaciaDef } from '../../compile/propRecipes/treeAcacia';
import { treeCherryDef } from '../../compile/propRecipes/treeCherry';
import { treeDeadTwistedDef } from '../../compile/propRecipes/treeDeadTwisted';
import { treeLogDef } from '../../compile/propRecipes/treeLog';
import { treeMapleDef } from '../../compile/propRecipes/treeMaple';
import { treeSpruceDef } from '../../compile/propRecipes/treeSpruce';
import { treeStumpDef } from '../../compile/propRecipes/treeStump';
import { treeWillowDef } from '../../compile/propRecipes/treeWillow';
import { urinalDef } from '../../compile/propRecipes/urinal';
import { urinalTroughDef } from '../../compile/propRecipes/urinalTrough';
import { vendingDrinkDef } from '../../compile/propRecipes/vendingDrink';
import { vendingSnackDef } from '../../compile/propRecipes/vendingSnack';
import { warningLightDef } from '../../compile/propRecipes/warningLight';
import { weatherVaneDef } from '../../compile/propRecipes/weatherVane';
import { wheelbarrowDef } from '../../compile/propRecipes/wheelbarrow';
import { wheelchairDef } from '../../compile/propRecipes/wheelchair';

export type BuiltinPropKind =
  | 'rock'
  | 'rockLarge'
  | 'rockSmall'
  | 'fireHydrant'
  | 'streetSign'
  | 'streetLight'
  | 'bush'
  | 'bushLarge'
  | 'bushLow'
  | 'bushSparse'
  | 'stopSign'
  | 'trafficLight'
  | 'payphone'
  | 'dumpster'
  | 'mailbox'
  | 'fence'
  // street furniture
  | 'trafficCone'
  | 'barrier'
  | 'trashCan'
  | 'bench'
  | 'planter'
  // trees (trunk-sized collision; canopy is visual)
  | 'treeOak'
  | 'treePine'
  | 'treeBirch'
  | 'treeCypress'
  | 'treePalm'
  | 'treeDead'
  // rock forms beyond the small/medium/large trio
  | 'boulder'
  | 'rockFlat'
  | 'rockSpire'
  | 'rockMossy'
  | 'rockPile'
  // balls — solid colliders the player bumps
  | 'ballBeach'
  | 'ballSoccer'
  | 'ballBasketball'
  // wall-mounted decor (anchor at the wall base, decor hangs at height)
  | 'wallPainting'
  | 'ledLight'
  // furniture (chairs are type-named: diningChair/armchair/officeChair/foldingChair
  // below in the PROPFURNITURE union — color is a skin, never a kind id)
  | 'couch'
  | 'table'
  | 'floorLamp'
  // household (bedroom/kitchen/bathroom)
  | 'bedSingle'
  | 'bedDouble'
  | 'cupboard'
  | 'mirror'
  | 'sink'
  | 'oven'
  | 'fridge'
  | 'computer'
  // utility + sport
  | 'telephonePole'
  | 'basketballHoop'
  // ── PROPBATCH-0611 (req_0633/req_0634/req_0635): the big variety drop ──────
  // ground foliage
  | 'grassPatch'
  | 'grassTall'
  // jagged rock forms (rotated-box facets, not sphere blobs)
  | 'rockJagged'
  | 'rockShard'
  // tree size variants (same models, registry-scaled)
  | 'treeOakYoung'
  | 'treeOakGiant'
  | 'treePineYoung'
  | 'treePineGiant'
  // broadcast / street commerce
  | 'radioTower'
  | 'gasPump'
  | 'vendingMachine'
  | 'storeShelf'
  | 'businessSign'
  | 'shopSign'
  | 'poster'
  | 'hospitalSign'
  | 'policeSign'
  // music / media (tabletop)
  | 'bookStack'
  | 'recordPlayer'
  | 'vinylRecord'
  | 'albumCover'
  | 'speaker'
  | 'speakerStack'
  | 'cassette'
  // the junkyard set
  | 'shippingContainer'
  | 'concretePipe'
  | 'pipeStack'
  | 'corrugatedSheet'
  | 'cableSpool'
  | 'lockerSet'
  | 'oilTank'
  | 'tire'
  | 'tireStack'
  | 'barrel'
  | 'steelDrum'
  | 'propaneTank'
  | 'jerryCan'
  | 'cinderBlock'
  | 'brick'
  | 'rubblePile'
  | 'crate'
  | 'pallet'
  | 'palletStack'
  // bathroom wall
  | 'toiletPaper'
  // ── PROPVENUE-0611 (req_0640): parks + shop interiors ──────────────────────
  // park / playground
  | 'fountain'
  | 'drinkingFountain'
  | 'loungeChair'
  | 'swingset'
  | 'sandCastle'
  | 'picketFence'
  | 'appleTree'
  | 'apple'
  // venue / shop interiors (arcade, casino, dispensary, liquor, fast food)
  | 'arcadeCabinet'
  | 'slotMachine'
  | 'clothingRack'
  | 'displayCase'
  | 'liquorShelf'
  | 'beerCase'
  | 'dinerBooth'
  | 'orderCounter'
  | 'menuBoard'
  | 'sodaMachine'
  | 'openSign'
  | 'greenCrossSign'
  // ── PROPFURNITURE-0613 (req_0783): dozens of interior props — chairs, desks,
  // shelves, couches, computers, poster sizes, tables, beds, appliances, storage,
  // lights, decor. All data-recipe, all skinnable, exact scale + physics. ─────
  // chairs
  | 'stool'
  | 'barStool'
  | 'officeChair'
  | 'diningChair'
  | 'armchair'
  | 'foldingChair'
  | 'rockingChair'
  | 'beanBag'
  | 'highChair'
  | 'directorsChair'
  | 'patioChair'
  // desks
  | 'officeDesk'
  | 'receptionDesk'
  | 'standingDesk'
  | 'cornerDesk'
  | 'draftingTable'
  | 'computerDesk'
  | 'writingDesk'
  | 'classroomDesk'
  // shelves
  | 'bookcase'
  | 'wallShelf'
  | 'wireShelf'
  | 'floatingShelf'
  | 'storageShelf'
  | 'displayShelf'
  | 'magazineRack'
  | 'dvdShelf'
  | 'wineRack'
  | 'toolShelf'
  // couches + lounge
  | 'loveseat'
  | 'sectional'
  | 'sofa'
  | 'chaiseLounge'
  | 'ottoman'
  | 'futon'
  | 'daybed'
  | 'recliner'
  // tables
  | 'coffeeTable'
  | 'endTable'
  | 'nightstand'
  | 'diningTable'
  | 'conferenceTable'
  | 'picnicTable'
  | 'sideTable'
  | 'consoleTable'
  | 'pokerTable'
  | 'workbench'
  // computers + tech
  | 'laptop'
  | 'monitor'
  | 'keyboard'
  | 'serverRack'
  | 'printer'
  | 'router'
  | 'tv'
  | 'gameConsole'
  | 'phone'
  | 'tablet'
  // posters + wall surfaces
  | 'posterSmall'
  | 'posterLarge'
  | 'posterWide'
  | 'posterTall'
  | 'noticeBoard'
  | 'corkboard'
  | 'whiteboard'
  | 'chalkboard'
  // beds
  | 'bunkBed'
  | 'hospitalBed'
  | 'mattress'
  // appliances + fixtures
  | 'microwave'
  | 'toaster'
  | 'blender'
  | 'washingMachine'
  | 'dryer'
  | 'toilet'
  | 'bathtub'
  | 'radiator'
  | 'waterCooler'
  // storage
  | 'wardrobe'
  | 'dresser'
  | 'filingCabinet'
  | 'toolCabinet'
  | 'safe'
  | 'cardboardBox'
  | 'storageBin'
  | 'coatRack'
  // lights
  | 'deskLamp'
  | 'ceilingLamp'
  | 'wallSconce'
  | 'neonSign'
  | 'exitSign'
  // ── PARAMETRIC signage (req_0893): geometry/material is a function of the
  // placement's `text` (WorldProp.text). blockLetters = extruded 3D channel
  // letters spelling a business name. neonLogo/neonLogoDouble wear a glowing
  // SVG-path decal on one or two faces (the content rides partTextures, not text).
  | 'blockLetters'
  | 'neonLogo'
  | 'neonLogoDouble'
  // ledTicker = a scrolling LED ticker-tape; its `text` is the message (animated).
  | 'ledTicker'
  // decor
  | 'rug'
  | 'pottedPlant'
  | 'vase'
  | 'clock'
  | 'tvStand'
  | 'curtain'
  // ── PROPEXTRA-0613: user-requested variety props ───────────────────────────
  | 'bong'
  | 'bottle'
  | 'bowl'
  | 'broom'
  | 'bucket'
  | 'can'
  | 'cup'
  | 'dice'
  | 'fireExtinguisher'
  | 'fishOnWall'
  | 'fishWall'
  | 'fishtank'
  | 'fork'
  | 'jar'
  | 'katana'
  | 'knife'
  | 'makeup'
  | 'makeupPalette'
  | 'monument'
  | 'mug'
  | 'plate'
  | 'shower'
  | 'sodaCan'
  | 'soupCan'
  | 'spoon'
  | 'stage'
  | 'towel'
  | 'towelRack'
  | 'tvCRT'
  | 'tvFlat'
  | 'waterBottle'
  | 'wineBottle'
  | 'arcadeAirHockey'
  | 'arcadeChangeMachine'
  | 'arcadeClaw'
  | 'arcadeDance'
  | 'arcadeFighting'
  | 'arcadePinball'
  | 'arcadePrize'
  | 'arcadeRacing'
  | 'arcadeShooting'
  | 'arcadeSkeeball'
  | 'baccaratTable'
  | 'bakingSheet'
  | 'barbedWire'
  | 'barrierJersey'
  | 'barrierPlastic'
  | 'benchBus'
  | 'bicycle'
  | 'bikeRack'
  | 'blackjackTable'
  | 'bookcart'
  | 'bookcaseFull'
  | 'breadBox'
  | 'brokenFurniture'
  | 'bushBamboo'
  | 'bushBerry'
  | 'bushBoxwood'
  | 'bushFern'
  | 'bushHedge'
  | 'bushRose'
  | 'campfire'
  | 'carDoor'
  | 'cashRegister'
  | 'chainLinkFenceSection'
  | 'coffeeMaker'
  | 'colander'
  | 'condimentStation'
  | 'coolerDrink'
  | 'coolerProduce'
  | 'crapsTable'
  | 'crushedCar'
  | 'crystal'
  | 'cuttingBoard'
  | 'dishRack'
  | 'dressForm'
  | 'drumKit'
  | 'dumpsterCardboard'
  | 'dumpsterIndustrial'
  | 'dumpsterRecycling'
  | 'dumpsterSmall'
  | 'dumpsterTrash'
  | 'easel'
  | 'electricBox'
  | 'engineBlock'
  | 'fastFoodMenu'
  | 'fireHydrantYellow'
  | 'freezerChest'
  | 'freezerUpright'
  | 'fridgeSupermarket'
  | 'fruitBowl'
  | 'fryBasket'
  | 'geode'
  | 'globe'
  | 'grassDead'
  | 'grassFlowers'
  | 'grassMoss'
  | 'grassReeds'
  | 'grassShort'
  | 'grillCharcoal'
  | 'grillGas'
  | 'grillPit'
  | 'grillPropane'
  | 'grillSmoker'
  | 'guitar'
  | 'gurney'
  | 'hayBale'
  | 'hazardBarrel'
  | 'hose'
  | 'hvacUnit'
  | 'kenoMachine'
  | 'kettle'
  | 'knifeBlock'
  | 'ladder'
  | 'lavaRock'
  | 'libraryShelf'
  | 'lifeguardTower'
  | 'luggageCart'
  | 'mailboxApartment'
  | 'mailboxNewspaper'
  | 'mailboxResidential'
  | 'mailboxWall'
  | 'mannequin'
  | 'merryGoRound'
  | 'microscope'
  | 'mixer'
  | 'newspaperBox'
  | 'oxygenTank'
  | 'pachinkoMachine'
  | 'packageDropBox'
  | 'pan'
  | 'parkingMeter'
  | 'parkingMeterDouble'
  | 'pebble'
  | 'pepperShaker'
  | 'picnicBlanket'
  | 'plantCactus'
  | 'plantCactusLarge'
  | 'plantFicus'
  | 'plantHanging'
  | 'plantMonstera'
  | 'plantPalm'
  | 'plantRose'
  | 'plantSucculent'
  | 'plantSunflower'
  | 'plantVine'
  | 'planterBox'
  | 'portaPotty'
  | 'pot'
  | 'roadSignBike'
  | 'roadSignConstruction'
  | 'roadSignDoNotEnter'
  | 'roadSignNoParking'
  | 'roadSignOneWay'
  | 'roadSignParking'
  | 'roadSignPedestrian'
  | 'roadSignSchool'
  | 'roadSignSpeedLimit'
  | 'roadSignYield'
  | 'rockCoral'
  | 'rockGranite'
  | 'rockLimestone'
  | 'rockObsidian'
  | 'rockQuartz'
  | 'rockSandstone'
  | 'rockSlate'
  | 'rollingPin'
  | 'rouletteTable'
  | 'rugOriental'
  | 'rugRound'
  | 'rugRunner'
  | 'rustedBarrel'
  | 'saltShaker'
  | 'sandbag'
  | 'satelliteDish'
  | 'scaffold'
  | 'scarecrow'
  | 'scrapMetal'
  | 'scrapPile'
  | 'sculpture'
  | 'securityCamera'
  | 'shoppingBasket'
  | 'shoppingCart'
  | 'slide'
  | 'slotMachineDigital'
  | 'slotMachinePoker'
  | 'slotMachineVintage'
  | 'soccerGoal'
  | 'sodaCup'
  | 'spiceRack'
  | 'streetLightVintage'
  | 'tent'
  | 'toiletBidet'
  | 'toiletPortable'
  | 'toiletStall'
  | 'tombstone'
  | 'toolbox'
  | 'trafficConeLarge'
  | 'trampoline'
  | 'trashCanRecycling'
  | 'treadmill'
  | 'treeAcacia'
  | 'treeCherry'
  | 'treeDeadTwisted'
  | 'treeLog'
  | 'treeMaple'
  | 'treeSpruce'
  | 'treeStump'
  | 'treeWillow'
  | 'urinal'
  | 'urinalTrough'
  | 'vendingDrink'
  | 'vendingSnack'
  | 'warningLight'
  | 'weatherVane'
  | 'wheelbarrow'
  | 'wheelchair';

export type PropKind = BuiltinPropKind | ImportedPropKind;

// How a prop governs vehicle traffic. 'none' props are scenery; 'stopSign' is
// always a hard stop; 'signal' free-runs a green→caution→stop cycle (the
// traffic light). The traffic system turns this into a live phase that NPC
// vehicle pathing reads to decide whether to yield at a junction — part of the
// locked road grammar's right-of-way layer (signals gate the junction box at
// runtime, never in the path graph).
export type PropTrafficControl = 'none' | 'stopSign' | 'signal';

/** A SHAPE-AWARE collision box, in prop-local meters (anchor at origin, Y up from
 *  the ground the prop rests on — the SAME space the cooked mesh renders in). A
 *  multi-part / multi-island prop (an archway: two posts + a high beam) cooks one
 *  box PER connected component, so the collider follows the real shape instead of a
 *  single ground-to-top box that fills the gap under the beam (req_1587). A box
 *  whose `minY` sits above head height is one the player walks UNDER. Absent on a
 *  prop = the legacy single-footprint box (built-in props are unchanged). */
export type PropCollisionBox = {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
};

export type PropKindDefinition = {
  kind: PropKind;
  label: string;
  // Whether the player (and vehicles) collide with it. Solid props add a small
  // blocking footprint to host physics; non-solid props (bushes) you walk into.
  solid: boolean;
  // Collision half-extent in meters around the ground anchor. Drives the host
  // physics blocking rect AND the model's base width, so they never drift.
  // For a NON-solid prop it is not collision — it sizes the concealment query.
  footprintRadiusMeters: number;
  // Optional rectangular footprint for props whose local X/Z extents are not
  // square. When present, physics/placement use this yaw-aware rectangle and
  // `footprintRadiusMeters` remains the coarse reach/concealment fallback.
  footprintWidthMeters?: number;
  footprintDepthMeters?: number;
  // Visual top in meters above the ground anchor — the prop's full height,
  // used by the model and as a scale reference. 1 tile = 1 meter.
  heightMeters: number;
  // The tile kind whose gameplay property bundle this prop borrows.
  tileKind: TileKind;
  trafficControl: PropTrafficControl;
  // Present = this prop is a DYNAMIC body, not static scenery: placed, it
  // becomes a host physics sphere the player kicks around by running into it
  // (KICKPROP-0610). Dynamic props contribute NO static blocking rect.
  dynamics?: PropDynamics;
  // SHAPE-AWARE collision (req_1587): one box per connected component of the cooked
  // mesh, in prop-local meters. Present = physics uses these boxes (each with its own
  // vertical band, so you can walk under a high beam) instead of the single
  // ground-to-top footprint box. Absent = the legacy single-box behaviour.
  collisionBoxes?: PropCollisionBox[];
  // PROPUSE-0610: the interaction bundle (all optional — plain scenery omits
  // everything). See the types below; helpers propMount/propSeat/propContainer/
  // propCoverClass resolve defaults.
  mount?: PropMount;
  seat?: PropSeat;
  container?: PropContainer;
  coverClass?: PropCoverClass;
  // How this prop PLACES as a build piece (req_1684 — the custom-piece cook). A
  // mesh-backed placeable is always kind:'prop' (the one render/bake/collision
  // substrate); `buildPlacement` is what lets the cook give it piece-like BEHAVIOUR
  // without a parallel kind: a cooked railing carries `snap:'edge', cover:'low'`, a
  // wall-decal trim `snap:'surface'`. Absent = free-snap scenery (the legacy
  // default propCatalogEntry already produced). Read by propCatalogEntry only.
  buildPlacement?: PropBuildPlacement;
  /** DOOR COOK (req_1864): a wall-family cooked piece can carry a functional
   *  two-state door — the "Door Leaf" part becomes this toggleable panel. The
   *  compiled bake emits it into the DOORS lump (the SAME two-state machine as a
   *  built-in WallEdit door) and the editor play view toggles it. The panel
   *  geometry is MEASURED from the leaf part at cook time (derive, don't store
   *  twice). Absent = a plain piece (no door). */
  doorPanel?: PropDoorPanel;
};

/** How a cooked prop SNAPS + reads as cover when placed as a build piece (req_1684).
 *  Pairs the build-side snap mode with the kinds-side cover height so a Studio model
 *  can be cooked into a railing/trim/fence that behaves like a built-in piece while
 *  staying on the uniform prop substrate. */
export type PropBuildPlacement = {
  /** 'edge' (railings/fences), 'surface' (trim/decals onto a face), 'grid', or
   *  'free' (default scenery). */
  snap?: BuildSnapMode;
  /** cover height the placed piece grants — railings/walls give cover. */
  cover?: TileCoverHeight;
  /** does it block line of sight (a solid wall yes, an open railing no). */
  blocksSight?: boolean;
  /** the build-piece FAMILY this custom piece presents as (req_1698) — a Studio
   *  model seeded from a wall cooks `pieceKind:'wall'`, so it lists UNDER walls in a
   *  placed piece's "swap it out" pick (catalogPickOptions groups by this), and you
   *  can replace a placed wall with your custom one. The asset stays kind:'prop'
   *  (the uniform mesh substrate); this is presentation/grouping only. Absent → it
   *  lists under its raw kind ('props'). */
  pieceKind?: BuildPieceKind;
  /** doorway — the placed piece is a body/vehicle PORTAL that connects rooms
   *  (req_1864). Drives `tags.portal` (a door cook sets it true). */
  portal?: boolean;
};

/** A cooked door's toggleable LEAF panel (req_1864) — measured from the model's
 *  "Door Leaf" part at cook time. Mirrors the built-in DOORS-0611 door (a closed
 *  leaf blocks body + sight; E within `reachMeters` toggles it; open clears the
 *  doorway) but sourced from a custom mesh part rather than a WallEdit. Geometry
 *  is in the asset's local (ground-lifted) frame; the bake transforms it by the
 *  placed instance. */
export type PropDoorPanel = {
  /** leaf box center in the asset's local frame, meters */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** leaf box extents, meters */
  width: number;
  height: number;
  depth: number;
  /** E reach (from edits.ts walk/vehicle interaction default) */
  reachMeters: number;
  /** vehicle-sized portal (garage) vs a walk door */
  vehicle: boolean;
  /** the leaf's vertex sub-range in the cooked mesh blob (start vertex + count)
   *  — the loader/editor render it as a separate toggleable node and hide it
   *  when the door opens, the same way glass rides a trailing sub-range. */
  meshStart: number;
  meshCount: number;
};

/** The dynamic-body recipe for a kickable prop (host sphere body). */
export type PropDynamics = {
  /** sphere body radius in meters (the mesh rides at body.y - radius) */
  bodyRadiusMeters: number;
  /** bounce on world contact, 0..1 — balls high, cones/cans low */
  restitution: number;
};

/** The dynamics recipe for a kind, or null for static scenery. */
export function propDynamics(kind: PropKind): PropDynamics | null {
  return propKindDefinition(kind).dynamics ?? null;
}

// ── PROPUSE-0610: the interaction bundle — what a prop IS to gameplay ────────
// The user's taxonomy, as data: containers can be searched, seats can be sat
// in, soft cover hides you, hard cover blocks bullets/LoS, trash/utility
// objects hold junk, appliances hold category-appropriate loot. Street objects
// already affect movement through collision + dynamics; their perception hooks
// (noise on bump, light pools) ride the tile bundle and the perception system
// when those integrate. ITEMS ARE NOT BUILT YET — lootCategory names the slot
// the item system fills next; the schema (capacity, spawn rate, access) is
// authored NOW so containers don't need a second pass.

/** Where a prop may be placed: on the ground, on a piece's top face (a
 *  computer on a table), or against a wall (paintings, mirrors, LED strips). */
export type PropMount = 'floor' | 'surface' | 'wall';

/** A sit/lay anchor, resolved against the figure skeleton's posture actions
 *  ('sit' / 'lay' on body/torso — game/figure/skeleton.ts already poses them). */
export type PropSeat = {
  pose: 'sit' | 'lay';
  /** where the pelvis lands, meters above the prop's ground anchor */
  seatHeightMeters: number;
  /** how many figures fit (chair 1, couch/bench 3, double bed 2) */
  capacity: number;
  /** SEAT PIN (req_1930) — where on the prop (in prop-local meters, ground
   *  anchor = origin) the figure's `seat` contact anchor lands, and which way it
   *  faces. Y comes from `seatHeightMeters`, so the pin only carries the X/Z
   *  offset off-center and the facing. ABSENT ⇒ centered, facing +Z (the prop's
   *  forward), so every existing seat seats with zero authoring; Studio pin-drop
   *  authoring overrides it later. `faceDeg` is added to the placed prop's yaw. */
  pin?: { x: number; z: number; faceDeg: number };
  /** MULTI-SEAT PINS (req_2028-2030) — the cooked output of a face-rig: one pin
   *  per occupant, derived from the seat face's LENGTH (a booth bench seats
   *  several). When present, `capacity === pins.length` and each pin carries its
   *  own facing (from the rigged back/head/leg faces). Absent ⇒ the single `pin`
   *  (or its centered default) is the only seat. */
  pins?: { x: number; z: number; faceDeg: number }[];
};

/** The default seat pin (req_1930): centered on the prop, facing its forward.
 *  Resolves the optional `seat.pin` so a v1 seat needs no authoring. */
export const DEFAULT_SEAT_PIN: { x: number; z: number; faceDeg: number } = { x: 0, z: 0, faceDeg: 0 };

/** The loot slot a container fills when the item system lands (next in line). */
export type PropLootCategory = 'junk' | 'kitchen' | 'bathroom' | 'clothing' | 'office' | 'valuables' | 'tools';

/** Can it be opened at all? 'locked' = pickable/forceable; 'keyed' = needs its key (safes, mailboxes). */
export type PropContainerAccess = 'open' | 'locked' | 'keyed';

/** A searchable container. Searching is a simple loading bar (searchSeconds). */
export type PropContainer = {
  lootCategory: PropLootCategory;
  /** item slots */
  capacity: number;
  /** 0..1 chance per slot to spawn filled */
  spawnFillChance: number;
  /** the search loading bar, in seconds */
  searchSeconds: number;
  access: PropContainerAccess;
};

/** How a prop reads to combat/stealth: soft = conceals you (shoot-through),
 *  hard = blocks bullets and line of sight. Feeds the coverFraction/exposure
 *  contracts (game/chance.ts, game/perception.ts). */
export type PropCoverClass = 'none' | 'soft' | 'hard';

export function propMount(kind: PropKind): PropMount {
  return propKindDefinition(kind).mount ?? 'floor';
}

export function propSeat(kind: PropKind): PropSeat | null {
  return propKindDefinition(kind).seat ?? null;
}

/** The resolved seat pin for a seatable kind (req_1930) — the authored
 *  `seat.pin` or the centered/forward default. Null if the kind has no seat. */
export function propSeatPin(kind: PropKind): { x: number; z: number; faceDeg: number } | null {
  const seat = propSeat(kind);
  return seat ? seat.pin ?? DEFAULT_SEAT_PIN : null;
}

/** ALL seat slots for a kind (req_2028-2030): the cooked multi-seat `pins` (a
 *  booth bench), else the single pin/default as a one-element list. Null if the
 *  kind has no seat. The length is the real capacity. */
export function propSeatPins(kind: PropKind): { x: number; z: number; faceDeg: number }[] | null {
  const seat = propSeat(kind);
  if (!seat) return null;
  return seat.pins && seat.pins.length ? seat.pins : [seat.pin ?? DEFAULT_SEAT_PIN];
}

export function propContainer(kind: PropKind): PropContainer | null {
  return propKindDefinition(kind).container ?? null;
}

/** Authored class wins; otherwise derive: foliage conceals (soft), a solid
 *  prop at least chest height blocks (hard), everything else is open air. */
export function propCoverClass(kind: PropKind): PropCoverClass {
  const def = propKindDefinition(kind);
  if (def.coverClass) return def.coverClass;
  if (def.tileKind === 'bush') return 'soft';
  if (def.solid && def.heightMeters >= 0.9) return 'hard';
  return 'none';
}

export const PROP_KIND_DEFINITIONS: Record<PropKind, PropKindDefinition> = {
  rock: rockDef,
  rockLarge: rockLargeDef,
  rockSmall: rockSmallDef,
  fireHydrant: fireHydrantDef,
  streetSign: streetSignDef,
  streetLight: streetLightDef,
  bush: bushDef,
  bushLarge: bushLargeDef,
  bushLow: bushLowDef,
  bushSparse: bushSparseDef,
  stopSign: stopSignDef,
  trafficLight: trafficLightDef,
  payphone: payphoneDef,
  dumpster: dumpsterDef,
  mailbox: mailboxDef,
  fence: fenceDef,

  // ── street furniture ──────────────────────────────────────────────────────
  trafficCone: trafficConeDef,
  barrier: barrierDef,
  trashCan: trashCanDef,
  bench: benchDef,
  planter: planterDef,

  // ── trees ──────────────────────────────────────────────────────────────────
  // footprintRadius is the TRUNK, not the canopy — you bump the trunk and walk
  // under the foliage edge, like every GTA tree. PROPSCALE-0611: heights are
  // real urban-mature averages × 1.15 (were ~half real size); trunks
  // thickened ~×1.4 to match.
  treeOak: treeOakDef,
  treePine: treePineDef,
  treeBirch: treeBirchDef,
  treeCypress: treeCypressDef,
  treePalm: treePalmDef,
  treeDead: treeDeadDef,

  // ── rock forms ─────────────────────────────────────────────────────────────
  boulder: boulderDef,
  rockFlat: rockFlatDef,
  rockSpire: rockSpireDef,
  rockMossy: rockMossyDef,
  rockPile: rockPileDef,

  // ── balls ──────────────────────────────────────────────────────────────────
  // Solid: they get a host-physics blocking rect like every obstacle, so the
  // player collides with them. (Rolling/kick dynamics is a separate system —
  // props are static world geometry today.)
  ballBeach: ballBeachDef,
  ballSoccer: ballSoccerDef,
  ballBasketball: ballBasketballDef,

  // ── wall decor ─────────────────────────────────────────────────────────────
  // Anchored at the wall base; the decor hangs at height in the model. The
  // thin solid footprint sits flush against the wall it mounts on.
  wallPainting: wallPaintingDef,
  ledLight: ledLightDef,

  // ── furniture ──────────────────────────────────────────────────────────────
  // Chairs own their data in their own files (the file with the most data owns
  // it) — see compile/propRecipes/<chair>.ts. This registry just collects them.
  diningChair: diningChairDef,
  couch: couchDef,
  table: tableDef,
  floorLamp: floorLampDef,
  // Chair TYPES (color is a skin, not a kind id) — each owns its data in its file.
  armchair: armchairDef,
  officeChair: officeChairDef,
  foldingChair: foldingChairDef,

  // ── household (bedroom / kitchen / bathroom) ───────────────────────────────
  bedSingle: bedSingleDef,
  bedDouble: bedDoubleDef,
  cupboard: cupboardDef,
  mirror: mirrorDef,
  sink: sinkDef,
  oven: ovenDef,
  fridge: fridgeDef,
  computer: computerDef,

  // ── utility + sport ────────────────────────────────────────────────────────
  telephonePole: telephonePoleDef,
  basketballHoop: basketballHoopDef,

  // ── PROPBATCH-0611 (req_0633 image set + named list, req_0634 grass,
  //    req_0635 image-flats). Real scale × 1.15 — the PROPSCALE presence law.
  //    Models are DATA (game/kinds/propModels.ts), rendered identically by
  //    /test's DataProp and the compile bake. ────────────────────────────────
  grassPatch: grassPatchDef,
  grassTall: grassTallDef,
  rockJagged: rockJaggedDef,
  rockShard: rockShardDef,
  treeOakYoung: treeOakYoungDef,
  treeOakGiant: treeOakGiantDef,
  treePineYoung: treePineYoungDef,
  treePineGiant: treePineGiantDef,
  radioTower: radioTowerDef,
  gasPump: gasPumpDef,
  vendingMachine: vendingMachineDef,
  storeShelf: storeShelfDef,
  businessSign: businessSignDef,
  shopSign: shopSignDef,
  poster: posterDef,
  hospitalSign: hospitalSignDef,
  policeSign: policeSignDef,
  bookStack: bookStackDef,
  recordPlayer: recordPlayerDef,
  vinylRecord: vinylRecordDef,
  albumCover: albumCoverDef,
  speaker: speakerDef,
  speakerStack: speakerStackDef,
  cassette: cassetteDef,
  shippingContainer: shippingContainerDef,
  concretePipe: concretePipeDef,
  pipeStack: pipeStackDef,
  corrugatedSheet: corrugatedSheetDef,
  cableSpool: cableSpoolDef,
  lockerSet: lockerSetDef,
  oilTank: oilTankDef,
  tire: tireDef,
  tireStack: tireStackDef,
  barrel: barrelDef,
  steelDrum: steelDrumDef,
  propaneTank: propaneTankDef,
  jerryCan: jerryCanDef,
  cinderBlock: cinderBlockDef,
  brick: brickDef,
  rubblePile: rubblePileDef,
  crate: crateDef,
  pallet: palletDef,
  palletStack: palletStackDef,
  toiletPaper: toiletPaperDef,

  // ── PROPVENUE-0611 (req_0640): parks + shop interiors. Real scale × 1.15. ──
  fountain: fountainDef,
  drinkingFountain: drinkingFountainDef,
  loungeChair: loungeChairDef,
  swingset: swingsetDef,
  sandCastle: sandCastleDef,
  picketFence: picketFenceDef,
  appleTree: appleTreeDef,
  apple: appleDef,
  arcadeCabinet: arcadeCabinetDef,
  slotMachine: slotMachineDef,
  clothingRack: clothingRackDef,
  displayCase: displayCaseDef,
  liquorShelf: liquorShelfDef,
  beerCase: beerCaseDef,
  dinerBooth: dinerBoothDef,
  orderCounter: orderCounterDef,
  menuBoard: menuBoardDef,
  sodaMachine: sodaMachineDef,
  openSign: openSignDef,
  greenCrossSign: greenCrossSignDef,

  // ── PROPEXTRA-0613: user-requested variety props ─────────────────────────
  fishWall: fishWallDef,
  makeupPalette: makeupPaletteDef,
  mug: mugDef,
  sodaCan: sodaCanDef,
  soupCan: soupCanDef,
  spoon: spoonDef,
  towelRack: towelRackDef,
  tvCRT: tvCRTDef,
  tvFlat: tvFlatDef,
  waterBottle: waterBottleDef,
  wineBottle: wineBottleDef,
  barStool: barStoolDef,
  bathtub: bathtubDef,
  blender: blenderDef,
  bong: bongDef,
  bookcase: bookcaseDef,
  bottle: bottleDef,
  bowl: bowlDef,
  broom: broomDef,
  bucket: bucketDef,
  bunkBed: bunkBedDef,
  can: canDef,
  cardboardBox: cardboardBoxDef,
  chaiseLounge: chaiseLoungeDef,
  clock: clockDef,
  coatRack: coatRackDef,
  coffeeTable: coffeeTableDef,
  computerDesk: computerDeskDef,
  conferenceTable: conferenceTableDef,
  cup: cupDef,
  curtain: curtainDef,
  deskLamp: deskLampDef,
  dice: diceDef,
  diningTable: diningTableDef,
  directorsChair: directorsChairDef,
  displayShelf: displayShelfDef,
  draftingTable: draftingTableDef,
  dresser: dresserDef,
  dryer: dryerDef,
  endTable: endTableDef,
  exitSign: exitSignDef,
  filingCabinet: filingCabinetDef,
  fireExtinguisher: fireExtinguisherDef,
  fishOnWall: fishOnWallDef,
  fishtank: fishtankDef,
  fork: forkDef,
  gameConsole: gameConsoleDef,
  highChair: highChairDef,
  hospitalBed: hospitalBedDef,
  jar: jarDef,
  katana: katanaDef,
  keyboard: keyboardDef,
  knife: knifeDef,
  laptop: laptopDef,
  loveseat: loveseatDef,
  magazineRack: magazineRackDef,
  makeup: makeupDef,
  mattress: mattressDef,
  microwave: microwaveDef,
  monitor: monitorDef,
  monument: monumentDef,
  neonSign: neonSignDef,
  blockLetters: blockLettersDef,
  neonLogo: neonLogoDef,
  neonLogoDouble: neonLogoDoubleDef,
  ledTicker: ledTickerDef,
  officeDesk: officeDeskDef,
  phone: phoneDef,
  plate: plateDef,
  pokerTable: pokerTableDef,
  pottedPlant: pottedPlantDef,
  printer: printerDef,
  radiator: radiatorDef,
  receptionDesk: receptionDeskDef,
  recliner: reclinerDef,
  rockingChair: rockingChairDef,
  router: routerDef,
  rug: rugDef,
  safe: safeDef,
  serverRack: serverRackDef,
  shower: showerDef,
  sofa: sofaDef,
  stage: stageDef,
  standingDesk: standingDeskDef,
  stool: stoolDef,
  storageBin: storageBinDef,
  storageShelf: storageShelfDef,
  tablet: tabletDef,
  toaster: toasterDef,
  toilet: toiletDef,
  towel: towelDef,
  tv: tvDef,
  tvStand: tvStandDef,
  vase: vaseDef,
  wallSconce: wallSconceDef,
  wallShelf: wallShelfDef,
  wardrobe: wardrobeDef,
  washingMachine: washingMachineDef,
  waterCooler: waterCoolerDef,

  // ── PROPFURNITURE-0613 extensions: additional interior recipe files ────────
  beanBag: beanBagDef,
  ceilingLamp: ceilingLampDef,
  chalkboard: chalkboardDef,
  classroomDesk: classroomDeskDef,
  consoleTable: consoleTableDef,
  corkboard: corkboardDef,
  cornerDesk: cornerDeskDef,
  daybed: daybedDef,
  dvdShelf: dvdShelfDef,
  floatingShelf: floatingShelfDef,
  futon: futonDef,
  nightstand: nightstandDef,
  noticeBoard: noticeBoardDef,
  ottoman: ottomanDef,
  patioChair: patioChairDef,
  picnicTable: picnicTableDef,
  posterLarge: posterLargeDef,
  posterSmall: posterSmallDef,
  posterTall: posterTallDef,
  posterWide: posterWideDef,
  sectional: sectionalDef,
  sideTable: sideTableDef,
  toolCabinet: toolCabinetDef,
  toolShelf: toolShelfDef,
  whiteboard: whiteboardDef,
  wineRack: wineRackDef,
  wireShelf: wireShelfDef,
  workbench: workbenchDef,
  writingDesk: writingDeskDef,

  // ── PROPBATCH-0613 extras: unwired recipe files now registered ───────
  arcadeAirHockey: arcadeAirHockeyDef,
  arcadeChangeMachine: arcadeChangeMachineDef,
  arcadeClaw: arcadeClawDef,
  arcadeDance: arcadeDanceDef,
  arcadeFighting: arcadeFightingDef,
  arcadePinball: arcadePinballDef,
  arcadePrize: arcadePrizeDef,
  arcadeRacing: arcadeRacingDef,
  arcadeShooting: arcadeShootingDef,
  arcadeSkeeball: arcadeSkeeballDef,
  baccaratTable: baccaratTableDef,
  bakingSheet: bakingSheetDef,
  barbedWire: barbedWireDef,
  barrierJersey: barrierJerseyDef,
  barrierPlastic: barrierPlasticDef,
  benchBus: benchBusDef,
  bicycle: bicycleDef,
  bikeRack: bikeRackDef,
  blackjackTable: blackjackTableDef,
  bookcart: bookcartDef,
  bookcaseFull: bookcaseFullDef,
  breadBox: breadBoxDef,
  brokenFurniture: brokenFurnitureDef,
  bushBamboo: bushBambooDef,
  bushBerry: bushBerryDef,
  bushBoxwood: bushBoxwoodDef,
  bushFern: bushFernDef,
  bushHedge: bushHedgeDef,
  bushRose: bushRoseDef,
  campfire: campfireDef,
  carDoor: carDoorDef,
  cashRegister: cashRegisterDef,
  chainLinkFenceSection: chainLinkFenceSectionDef,
  coffeeMaker: coffeeMakerDef,
  colander: colanderDef,
  condimentStation: condimentStationDef,
  coolerDrink: coolerDrinkDef,
  coolerProduce: coolerProduceDef,
  crapsTable: crapsTableDef,
  crushedCar: crushedCarDef,
  crystal: crystalDef,
  cuttingBoard: cuttingBoardDef,
  dishRack: dishRackDef,
  dressForm: dressFormDef,
  drumKit: drumKitDef,
  dumpsterCardboard: dumpsterCardboardDef,
  dumpsterIndustrial: dumpsterIndustrialDef,
  dumpsterRecycling: dumpsterRecyclingDef,
  dumpsterSmall: dumpsterSmallDef,
  dumpsterTrash: dumpsterTrashDef,
  easel: easelDef,
  electricBox: electricBoxDef,
  engineBlock: engineBlockDef,
  fastFoodMenu: fastFoodMenuDef,
  fireHydrantYellow: fireHydrantYellowDef,
  freezerChest: freezerChestDef,
  freezerUpright: freezerUprightDef,
  fridgeSupermarket: fridgeSupermarketDef,
  fruitBowl: fruitBowlDef,
  fryBasket: fryBasketDef,
  geode: geodeDef,
  globe: globeDef,
  grassDead: grassDeadDef,
  grassFlowers: grassFlowersDef,
  grassMoss: grassMossDef,
  grassReeds: grassReedsDef,
  grassShort: grassShortDef,
  grillCharcoal: grillCharcoalDef,
  grillGas: grillGasDef,
  grillPit: grillPitDef,
  grillPropane: grillPropaneDef,
  grillSmoker: grillSmokerDef,
  guitar: guitarDef,
  gurney: gurneyDef,
  hayBale: hayBaleDef,
  hazardBarrel: hazardBarrelDef,
  hose: hoseDef,
  hvacUnit: hvacUnitDef,
  kenoMachine: kenoMachineDef,
  kettle: kettleDef,
  knifeBlock: knifeBlockDef,
  ladder: ladderDef,
  lavaRock: lavaRockDef,
  libraryShelf: libraryShelfDef,
  lifeguardTower: lifeguardTowerDef,
  luggageCart: luggageCartDef,
  mailboxApartment: mailboxApartmentDef,
  mailboxNewspaper: mailboxNewspaperDef,
  mailboxResidential: mailboxResidentialDef,
  mailboxWall: mailboxWallDef,
  mannequin: mannequinDef,
  merryGoRound: merryGoRoundDef,
  microscope: microscopeDef,
  mixer: mixerDef,
  newspaperBox: newspaperBoxDef,
  oxygenTank: oxygenTankDef,
  pachinkoMachine: pachinkoMachineDef,
  packageDropBox: packageDropBoxDef,
  pan: panDef,
  parkingMeter: parkingMeterDef,
  parkingMeterDouble: parkingMeterDoubleDef,
  pebble: pebbleDef,
  pepperShaker: pepperShakerDef,
  picnicBlanket: picnicBlanketDef,
  plantCactus: plantCactusDef,
  plantCactusLarge: plantCactusLargeDef,
  plantFicus: plantFicusDef,
  plantHanging: plantHangingDef,
  plantMonstera: plantMonsteraDef,
  plantPalm: plantPalmDef,
  plantRose: plantRoseDef,
  plantSucculent: plantSucculentDef,
  plantSunflower: plantSunflowerDef,
  plantVine: plantVineDef,
  planterBox: planterBoxDef,
  portaPotty: portaPottyDef,
  pot: potDef,
  roadSignBike: roadSignBikeDef,
  roadSignConstruction: roadSignConstructionDef,
  roadSignDoNotEnter: roadSignDoNotEnterDef,
  roadSignNoParking: roadSignNoParkingDef,
  roadSignOneWay: roadSignOneWayDef,
  roadSignParking: roadSignParkingDef,
  roadSignPedestrian: roadSignPedestrianDef,
  roadSignSchool: roadSignSchoolDef,
  roadSignSpeedLimit: roadSignSpeedLimitDef,
  roadSignYield: roadSignYieldDef,
  rockCoral: rockCoralDef,
  rockGranite: rockGraniteDef,
  rockLimestone: rockLimestoneDef,
  rockObsidian: rockObsidianDef,
  rockQuartz: rockQuartzDef,
  rockSandstone: rockSandstoneDef,
  rockSlate: rockSlateDef,
  rollingPin: rollingPinDef,
  rouletteTable: rouletteTableDef,
  rugOriental: rugOrientalDef,
  rugRound: rugRoundDef,
  rugRunner: rugRunnerDef,
  rustedBarrel: rustedBarrelDef,
  saltShaker: saltShakerDef,
  sandbag: sandbagDef,
  satelliteDish: satelliteDishDef,
  scaffold: scaffoldDef,
  scarecrow: scarecrowDef,
  scrapMetal: scrapMetalDef,
  scrapPile: scrapPileDef,
  sculpture: sculptureDef,
  securityCamera: securityCameraDef,
  shoppingBasket: shoppingBasketDef,
  shoppingCart: shoppingCartDef,
  slide: slideDef,
  slotMachineDigital: slotMachineDigitalDef,
  slotMachinePoker: slotMachinePokerDef,
  slotMachineVintage: slotMachineVintageDef,
  soccerGoal: soccerGoalDef,
  sodaCup: sodaCupDef,
  spiceRack: spiceRackDef,
  streetLightVintage: streetLightVintageDef,
  tent: tentDef,
  toiletBidet: toiletBidetDef,
  toiletPortable: toiletPortableDef,
  toiletStall: toiletStallDef,
  tombstone: tombstoneDef,
  toolbox: toolboxDef,
  trafficConeLarge: trafficConeLargeDef,
  trampoline: trampolineDef,
  trashCanRecycling: trashCanRecyclingDef,
  treadmill: treadmillDef,
  treeAcacia: treeAcaciaDef,
  treeCherry: treeCherryDef,
  treeDeadTwisted: treeDeadTwistedDef,
  treeLog: treeLogDef,
  treeMaple: treeMapleDef,
  treeSpruce: treeSpruceDef,
  treeStump: treeStumpDef,
  treeWillow: treeWillowDef,
  urinal: urinalDef,
  urinalTrough: urinalTroughDef,
  vendingDrink: vendingDrinkDef,
  vendingSnack: vendingSnackDef,
  warningLight: warningLightDef,
  weatherVane: weatherVaneDef,
  wheelbarrow: wheelbarrowDef,
  wheelchair: wheelchairDef,

  ...IMPORTED_PROP_DEFINITIONS,
};

export const PROP_KINDS = Object.keys(PROP_KIND_DEFINITIONS) as PropKind[];

// ── categories: how pickers SHELVE the kinds (PROPSHELF-0611, req_0636) ──────
// One registered table, category → kinds. With ~100 kinds a flat button wall
// is unusable ("the millions of buttons is insane"); every palette renders a
// category row first, then only that shelf's kinds. A kind lives on EXACTLY
// one shelf (props.test.ts asserts the partition is total and disjoint).
export type PropCategory =
  | 'nature' | 'trees' | 'rocks' | 'street' | 'signs' | 'furniture'
  | 'household' | 'media' | 'commerce' | 'junkyard' | 'sport'
  | 'park' | 'shops' | 'imported' | 'studio';

export const PROP_CATEGORIES: Record<PropCategory, PropKind[]> = {
  // 'bush' (the solid-sphere bush prop) retired — bushes are now the painted bush
  // TILE populated as foliage cards (render3d/grassPopulation BushField). The other
  // bush variants stay until they get the same treatment.
  nature: ['bushLarge', 'bushLow', 'bushSparse', 'grassPatch', 'grassTall', 'bushBamboo', 'bushBerry', 'bushBoxwood', 'bushFern', 'bushHedge', 'bushRose', 'grassDead', 'grassFlowers', 'grassMoss', 'grassReeds', 'grassShort', 'plantSunflower'],
  trees: ['treeOak', 'treeOakYoung', 'treeOakGiant', 'treePine', 'treePineYoung', 'treePineGiant', 'treeBirch', 'treeCypress', 'treePalm', 'treeDead', 'treeAcacia', 'treeCherry', 'treeDeadTwisted', 'treeLog', 'treeMaple', 'treeSpruce', 'treeStump', 'treeWillow'],
  rocks: ['rock', 'rockLarge', 'rockSmall', 'boulder', 'rockFlat', 'rockSpire', 'rockMossy', 'rockPile', 'rockJagged', 'rockShard', 'crystal', 'geode', 'lavaRock', 'pebble', 'rockCoral', 'rockGranite', 'rockLimestone', 'rockObsidian', 'rockQuartz', 'rockSandstone', 'rockSlate', 'tombstone'],
  street: ['fireHydrant', 'streetLight', 'payphone', 'mailbox', 'dumpster', 'fence', 'trafficCone', 'barrier', 'trashCan', 'bench', 'planter', 'telephonePole', 'fireExtinguisher', 'barrierJersey', 'barrierPlastic', 'benchBus', 'bikeRack', 'electricBox', 'fireHydrantYellow', 'hvacUnit', 'mailboxApartment', 'mailboxNewspaper', 'mailboxResidential', 'mailboxWall', 'newspaperBox', 'packageDropBox', 'parkingMeter', 'parkingMeterDouble', 'planterBox', 'portaPotty', 'roadSignBike', 'roadSignConstruction', 'roadSignDoNotEnter', 'roadSignNoParking', 'roadSignOneWay', 'roadSignParking', 'roadSignPedestrian', 'roadSignSchool', 'roadSignSpeedLimit', 'roadSignYield', 'streetLightVintage', 'trafficConeLarge', 'trashCanRecycling'],
  signs: ['streetSign', 'stopSign', 'trafficLight', 'businessSign', 'shopSign', 'poster', 'posterSmall', 'posterLarge', 'posterWide', 'posterTall', 'hospitalSign', 'policeSign', 'exitSign', 'neonSign', 'blockLetters', 'neonLogo', 'neonLogoDouble', 'ledTicker', 'noticeBoard', 'corkboard', 'whiteboard', 'chalkboard'],
  furniture: ['diningChair', 'armchair', 'officeChair', 'foldingChair', 'couch', 'table', 'floorLamp', 'wallPainting', 'ledLight', 'mirror', 'barStool', 'beanBag', 'bookcase', 'chaiseLounge', 'coffeeTable', 'computerDesk', 'conferenceTable', 'consoleTable', 'cornerDesk', 'diningTable', 'directorsChair', 'displayShelf', 'draftingTable', 'dvdShelf', 'endTable', 'floatingShelf', 'futon', 'highChair', 'loveseat', 'magazineRack', 'nightstand', 'officeDesk', 'ottoman', 'patioChair', 'picnicTable', 'pokerTable', 'receptionDesk', 'recliner', 'rockingChair', 'sectional', 'sideTable', 'sofa', 'standingDesk', 'stool', 'storageShelf', 'toolShelf', 'tvStand', 'wallShelf', 'wineRack', 'wireShelf', 'workbench', 'writingDesk', 'classroomDesk', 'daybed', 'bookcart', 'bookcaseFull', 'dishRack', 'libraryShelf', 'spiceRack', 'toiletPortable', 'wheelchair'],
  household: ['bedSingle', 'bedDouble', 'cupboard', 'sink', 'oven', 'fridge', 'computer', 'toiletPaper', 'bathtub', 'blender', 'bottle', 'bowl', 'broom', 'bucket', 'bunkBed', 'can', 'cardboardBox', 'ceilingLamp', 'clock', 'coatRack', 'cup', 'curtain', 'deskLamp', 'dresser', 'dryer', 'filingCabinet', 'fishOnWall', 'fishWall', 'fishtank', 'fork', 'hospitalBed', 'jar', 'knife', 'mattress', 'microwave', 'mug', 'plate', 'pottedPlant', 'radiator', 'rug', 'safe', 'shower', 'sodaCan', 'soupCan', 'spoon', 'storageBin', 'toaster', 'toilet', 'toolCabinet', 'towel', 'towelRack', 'vase', 'wallSconce', 'wardrobe', 'washingMachine', 'waterBottle', 'waterCooler', 'wineBottle', 'bakingSheet', 'bicycle', 'breadBox', 'coffeeMaker', 'colander', 'cuttingBoard', 'dumpsterCardboard', 'dumpsterIndustrial', 'dumpsterRecycling', 'dumpsterSmall', 'dumpsterTrash', 'easel', 'fruitBowl', 'fryBasket', 'globe', 'gurney', 'hose', 'kettle', 'knifeBlock', 'microscope', 'mixer', 'oxygenTank', 'pan', 'pepperShaker', 'plantCactus', 'plantCactusLarge', 'plantFicus', 'plantHanging', 'plantMonstera', 'plantPalm', 'plantRose', 'plantSucculent', 'pot', 'rollingPin', 'rugOriental', 'rugRound', 'rugRunner', 'saltShaker', 'securityCamera', 'sodaCup', 'toiletBidet', 'toiletStall', 'treadmill', 'urinal', 'urinalTrough', 'weatherVane'],
  media: ['bookStack', 'recordPlayer', 'vinylRecord', 'albumCover', 'cassette', 'speaker', 'speakerStack', 'gameConsole', 'keyboard', 'laptop', 'monitor', 'phone', 'printer', 'router', 'serverRack', 'tablet', 'tv', 'tvCRT', 'tvFlat', 'drumKit', 'guitar', 'plantVine'],
  commerce: ['vendingMachine', 'gasPump', 'storeShelf', 'crate', 'pallet', 'palletStack', 'cashRegister', 'condimentStation', 'coolerDrink', 'coolerProduce', 'fastFoodMenu', 'freezerChest', 'freezerUpright', 'fridgeSupermarket', 'shoppingBasket', 'shoppingCart', 'vendingDrink', 'vendingSnack'],
  junkyard: ['shippingContainer', 'concretePipe', 'pipeStack', 'corrugatedSheet', 'cableSpool', 'lockerSet', 'oilTank', 'tire', 'tireStack', 'barrel', 'steelDrum', 'propaneTank', 'jerryCan', 'cinderBlock', 'brick', 'rubblePile', 'radioTower', 'barbedWire', 'brokenFurniture', 'carDoor', 'chainLinkFenceSection', 'crushedCar', 'engineBlock', 'hazardBarrel', 'ladder', 'rustedBarrel', 'sandbag', 'satelliteDish', 'scaffold', 'scrapMetal', 'scrapPile', 'toolbox', 'warningLight', 'wheelbarrow'],
  sport: ['ballBeach', 'ballSoccer', 'ballBasketball', 'basketballHoop', 'arcadePinball', 'arcadeSkeeball', 'soccerGoal', 'trampoline'],
  park: ['fountain', 'drinkingFountain', 'loungeChair', 'swingset', 'sandCastle', 'picketFence', 'appleTree', 'apple', 'monument', 'campfire', 'grillCharcoal', 'grillGas', 'grillPit', 'grillPropane', 'grillSmoker', 'hayBale', 'lifeguardTower', 'merryGoRound', 'picnicBlanket', 'scarecrow', 'sculpture', 'slide', 'tent'],
  shops: ['arcadeCabinet', 'slotMachine', 'clothingRack', 'displayCase', 'liquorShelf', 'beerCase', 'dinerBooth', 'orderCounter', 'menuBoard', 'sodaMachine', 'openSign', 'greenCrossSign', 'bong', 'dice', 'katana', 'makeup', 'makeupPalette', 'stage', 'arcadeAirHockey', 'arcadeChangeMachine', 'arcadeClaw', 'arcadeDance', 'arcadeFighting', 'arcadePrize', 'arcadeRacing', 'arcadeShooting', 'baccaratTable', 'blackjackTable', 'crapsTable', 'dressForm', 'kenoMachine', 'luggageCart', 'mannequin', 'pachinkoMachine', 'rouletteTable', 'slotMachineDigital', 'slotMachinePoker', 'slotMachineVintage'],
  imported: [...IMPORTED_PROP_KINDS],
  // Studio-cooked props (req_1134) are RUNTIME-registered (the cooked-asset
  // overlay), so this static shelf is empty; the palette lists them live via
  // catalogEntriesByKind('prop') + propCategory → 'studio'.
  studio: [],
};

export const PROP_CATEGORY_NAMES = Object.keys(PROP_CATEGORIES) as PropCategory[];

const CATEGORY_BY_KIND: Record<string, PropCategory> = {};
for (const cat of PROP_CATEGORY_NAMES) for (const k of PROP_CATEGORIES[cat]) CATEGORY_BY_KIND[k] = cat;

/** The shelf a kind lives on (every BUILT-IN kind has one — the suite enforces
 *  it). A runtime cooked kind has no static shelf, so it lands on 'studio'. */
export function propCategory(kind: PropKind): PropCategory {
  return CATEGORY_BY_KIND[kind] ?? (isCookedPropKind(kind) ? 'studio' : (undefined as unknown as PropCategory));
}

// ── Cooked (Studio-compiled) prop descriptors: a RUNTIME overlay (req_1134) ──
// Built-in kinds live in PROP_KIND_DEFINITIONS (static). STUDIO-COOKED props are
// installed at RUNTIME (the cooked-asset content store, editors/model/cookedAssetStream),
// so their descriptors are registered HERE and merged into every resolver. Same
// shape as the imported-prop merge above, but populated live instead of build-time
// generated. Empty by default (the game/headless paths never register); the editor
// populates it from the cooked-asset stream on load. Keyed by the asset id, which
// IS a placed prop's `kind`.
const COOKED_PROP_DEFS: Record<string, PropKindDefinition> = {};

/** Register (or replace) cooked prop descriptors into the runtime overlay — the
 *  editor calls this from the cooked-asset store so physics/palette/render/bake all
 *  resolve a cooked kind through the SAME lookup as a built-in. */
export function registerCookedProps(defs: readonly PropKindDefinition[]): void {
  for (const d of defs) COOKED_PROP_DEFS[d.kind] = d;
}

/** Is this a Studio-cooked prop kind (in the runtime overlay, not built-in)? */
export function isCookedPropKind(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(COOKED_PROP_DEFS, value);
}

export function cookedPropKinds(): PropKind[] {
  return Object.keys(COOKED_PROP_DEFS) as PropKind[];
}

export function isPropKind(value: string): value is PropKind {
  return Object.prototype.hasOwnProperty.call(PROP_KIND_DEFINITIONS, value) || isCookedPropKind(value);
}

// ── PARAMETRIC props (req_0893): kinds whose recipe/material is a function of
// the placement's `text` (WorldProp.text). The ONE list both the editor (to show
// a text field) and any text-aware consumer read — no per-kind branching twice.
export const TEXT_PROP_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['blockLetters', 'ledTicker']);

/** Does this kind read a per-instance `text`? (block-letter name, neon caption,
 *  ticker message.) The editor shows a text input for these; others ignore it. */
export function propTakesText(kind: PropKind): boolean {
  return TEXT_PROP_KINDS.has(kind);
}

export function propKindDefinition(kind: PropKind): PropKindDefinition {
  return PROP_KIND_DEFINITIONS[kind] ?? COOKED_PROP_DEFS[kind] ?? COOKED_PROP_FALLBACK(kind);
}

// A defensive placeholder for a cooked kind referenced before its descriptor has
// been registered (a load race) — a 1 m solid box, so a stale reference renders a
// cube instead of crashing on `undefined.footprint…`. Should be rare; the editor
// registers cooked descriptors on store load, before any placement resolves.
function COOKED_PROP_FALLBACK(kind: PropKind): PropKindDefinition {
  return {
    kind, label: String(kind), solid: true,
    footprintRadiusMeters: 0.5, footprintWidthMeters: 1, footprintDepthMeters: 1,
    heightMeters: 1, tileKind: 'wall', trafficControl: 'none',
  };
}

export function propKindNamesForConsole(): string {
  return PROP_KINDS.join(', ');
}

// ── the dumpster body box, the ONE place it is defined (req_0623) ────────────
// The model is authored at DUMPSTER_AUTHORED_HEIGHT (the parts' AABB top) and
// derives its body width/depth from the footprint radius. Both renderers
// (render3d/props/Dumpster.tsx, compile/worldGeometry.ts) AND host physics
// (world/props.ts propFootprint) consume THIS, so the box you see is the box
// you bump — the player was clipping into the widened body because physics
// still used the old footprint square.

export const DUMPSTER_AUTHORED_HEIGHT = 1.09;

export function dumpsterBodyMeters(): { scale: number; widthMeters: number; depthMeters: number } {
  const def = PROP_KIND_DEFINITIONS.dumpster;
  const scale = def.heightMeters / DUMPSTER_AUTHORED_HEIGHT;
  return {
    scale,
    widthMeters: def.footprintRadiusMeters * 1.6 * scale,
    depthMeters: def.footprintRadiusMeters * 1.2 * scale,
  };
}
