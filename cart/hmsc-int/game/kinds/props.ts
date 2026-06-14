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

import type { TileKind } from './tiles';
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
  | 'wineBottle';

export type PropKind = BuiltinPropKind | ImportedPropKind;

// How a prop governs vehicle traffic. 'none' props are scenery; 'stopSign' is
// always a hard stop; 'signal' free-runs a green→caution→stop cycle (the
// traffic light). The traffic system turns this into a live phase that NPC
// vehicle pathing reads to decide whether to yield at a junction — part of the
// locked road grammar's right-of-way layer (signals gate the junction box at
// runtime, never in the path graph).
export type PropTrafficControl = 'none' | 'stopSign' | 'signal';

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
  // PROPUSE-0610: the interaction bundle (all optional — plain scenery omits
  // everything). See the types below; helpers propMount/propSeat/propContainer/
  // propCoverClass resolve defaults.
  mount?: PropMount;
  seat?: PropSeat;
  container?: PropContainer;
  coverClass?: PropCoverClass;
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
  return PROP_KIND_DEFINITIONS[kind].dynamics ?? null;
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
};

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
  return PROP_KIND_DEFINITIONS[kind].mount ?? 'floor';
}

export function propSeat(kind: PropKind): PropSeat | null {
  return PROP_KIND_DEFINITIONS[kind].seat ?? null;
}

export function propContainer(kind: PropKind): PropContainer | null {
  return PROP_KIND_DEFINITIONS[kind].container ?? null;
}

/** Authored class wins; otherwise derive: foliage conceals (soft), a solid
 *  prop at least chest height blocks (hard), everything else is open air. */
export function propCoverClass(kind: PropKind): PropCoverClass {
  const def = PROP_KIND_DEFINITIONS[kind];
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
  | 'park' | 'shops' | 'imported';

export const PROP_CATEGORIES: Record<PropCategory, PropKind[]> = {
  nature: ['bush', 'bushLarge', 'bushLow', 'bushSparse', 'grassPatch', 'grassTall'],
  trees: ['treeOak', 'treeOakYoung', 'treeOakGiant', 'treePine', 'treePineYoung', 'treePineGiant', 'treeBirch', 'treeCypress', 'treePalm', 'treeDead'],
  rocks: ['rock', 'rockLarge', 'rockSmall', 'boulder', 'rockFlat', 'rockSpire', 'rockMossy', 'rockPile', 'rockJagged', 'rockShard'],
  street: ['fireHydrant', 'streetLight', 'payphone', 'mailbox', 'dumpster', 'fence', 'trafficCone', 'barrier', 'trashCan', 'bench', 'planter', 'telephonePole', 'fireExtinguisher'],
  signs: ['streetSign', 'stopSign', 'trafficLight', 'businessSign', 'shopSign', 'poster', 'posterSmall', 'posterLarge', 'posterWide', 'posterTall', 'hospitalSign', 'policeSign', 'exitSign', 'neonSign', 'blockLetters', 'neonLogo', 'neonLogoDouble', 'ledTicker', 'noticeBoard', 'corkboard', 'whiteboard', 'chalkboard'],
  furniture: ['diningChair', 'armchair', 'officeChair', 'foldingChair', 'couch', 'table', 'floorLamp', 'wallPainting', 'ledLight', 'mirror', 'barStool', 'beanBag', 'bookcase', 'chaiseLounge', 'coffeeTable', 'computerDesk', 'conferenceTable', 'consoleTable', 'cornerDesk', 'diningTable', 'directorsChair', 'displayShelf', 'draftingTable', 'dvdShelf', 'endTable', 'floatingShelf', 'futon', 'highChair', 'loveseat', 'magazineRack', 'nightstand', 'officeDesk', 'ottoman', 'patioChair', 'picnicTable', 'pokerTable', 'receptionDesk', 'recliner', 'rockingChair', 'sectional', 'sideTable', 'sofa', 'standingDesk', 'stool', 'storageShelf', 'toolShelf', 'tvStand', 'wallShelf', 'wineRack', 'wireShelf', 'workbench', 'writingDesk', 'classroomDesk', 'daybed'],
  household: ['bedSingle', 'bedDouble', 'cupboard', 'sink', 'oven', 'fridge', 'computer', 'toiletPaper', 'bathtub', 'blender', 'bottle', 'bowl', 'broom', 'bucket', 'bunkBed', 'can', 'cardboardBox', 'ceilingLamp', 'clock', 'coatRack', 'cup', 'curtain', 'deskLamp', 'dresser', 'dryer', 'filingCabinet', 'fishOnWall', 'fishWall', 'fishtank', 'fork', 'hospitalBed', 'jar', 'knife', 'mattress', 'microwave', 'mug', 'plate', 'pottedPlant', 'radiator', 'rug', 'safe', 'shower', 'sodaCan', 'soupCan', 'spoon', 'storageBin', 'toaster', 'toilet', 'toolCabinet', 'towel', 'towelRack', 'vase', 'wallSconce', 'wardrobe', 'washingMachine', 'waterBottle', 'waterCooler', 'wineBottle'],
  media: ['bookStack', 'recordPlayer', 'vinylRecord', 'albumCover', 'cassette', 'speaker', 'speakerStack', 'gameConsole', 'keyboard', 'laptop', 'monitor', 'phone', 'printer', 'router', 'serverRack', 'tablet', 'tv', 'tvCRT', 'tvFlat'],
  commerce: ['vendingMachine', 'gasPump', 'storeShelf', 'crate', 'pallet', 'palletStack'],
  junkyard: ['shippingContainer', 'concretePipe', 'pipeStack', 'corrugatedSheet', 'cableSpool', 'lockerSet', 'oilTank', 'tire', 'tireStack', 'barrel', 'steelDrum', 'propaneTank', 'jerryCan', 'cinderBlock', 'brick', 'rubblePile', 'radioTower'],
  sport: ['ballBeach', 'ballSoccer', 'ballBasketball', 'basketballHoop'],
  park: ['fountain', 'drinkingFountain', 'loungeChair', 'swingset', 'sandCastle', 'picketFence', 'appleTree', 'apple', 'monument'],
  shops: ['arcadeCabinet', 'slotMachine', 'clothingRack', 'displayCase', 'liquorShelf', 'beerCase', 'dinerBooth', 'orderCounter', 'menuBoard', 'sodaMachine', 'openSign', 'greenCrossSign', 'bong', 'dice', 'katana', 'makeup', 'makeupPalette', 'stage'],
  imported: [...IMPORTED_PROP_KINDS],
};

export const PROP_CATEGORY_NAMES = Object.keys(PROP_CATEGORIES) as PropCategory[];

const CATEGORY_BY_KIND: Record<string, PropCategory> = {};
for (const cat of PROP_CATEGORY_NAMES) for (const k of PROP_CATEGORIES[cat]) CATEGORY_BY_KIND[k] = cat;

/** The shelf a kind lives on (every kind has one — the suite enforces it). */
export function propCategory(kind: PropKind): PropCategory {
  return CATEGORY_BY_KIND[kind];
}

export function isPropKind(value: string): value is PropKind {
  return Object.prototype.hasOwnProperty.call(PROP_KIND_DEFINITIONS, value);
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
  return PROP_KIND_DEFINITIONS[kind];
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
