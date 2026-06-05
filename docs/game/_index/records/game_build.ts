import type { DocIndex } from '../types';

export const game_build: DocIndex = {
  name: 'game_build',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/build/index.ts',
  purpose: ['world_gen', 'ui'],
  summary:
    'V24 capture: the building piece grammar\'s data layer ("Author by semantic piece. Bake by gameplay contract. Skin by catalog"). Five families behind one door: the BuildPieceKind taxonomy (wall/floor/ramp/stairs/roof/pillar/corner/arch/fence/railing/trim/sign/prop) with per-kind BakePromise contracts (DECLARED, not implemented — emission lands with compile/); the WallEdit vocabulary (solid/door/window/doubleWindow/brokenWindow/garageDoor/arch/halfHeight) with per-edit meaning (tag overrides + portal kind + sightline + traversal); the P2 BuildPieceDef catalog (theme/material/size/snap/gameplay tags, validated against kind contracts); first-class prefabs that DECOMPOSE to semantic pieces (no opaque blobs); and the WorldMarker semantic-overlay union (path_node/trigger/room/portal/interest_point/camera_marker — addendum 3). ONE MODEL, TWO VIEWS: nothing in the tables assumes a camera/interaction mode. 18 P4 meaning-tests green. GAME_BUILD is the 21st game/index.ts door (STRUCTURE door list updated same commit).',
  interfaces: [
    {
      name: 'GAME_BUILD',
      purpose: ['world_gen', 'ui'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/build/index.ts',
      description:
        'The P3 door: kinds (contracts/is/get over BUILD_KIND_CONTRACTS), edits (WALL_EDIT_DEFINITIONS + applyWallEdit — the one composition point), catalog (entries/effectiveTags/byKind/byTheme/validate), prefabs (definitions/decompose/validate), markers (types/roomRoles/interestPointRoles/validate/validateSet/ofType). Data + boundary validation only; Build/Plan mode editors and the bake emission are later consumers of this same door.',
      dependsOn: ['GAME_KINDS'],
      status: 'live',
    },
    {
      name: 'BUILD_KIND_CONTRACTS / BakePromise',
      purpose: ['world_gen'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/build/pieces.ts',
      description:
        'Per-kind gameplay contract: what a placed piece PROMISES the bake (render geometry, collision boxes, cover faces, sound occlusion, room boundary, nav portal/blocker, vertical link, destructible sections) plus which edit family it accepts (only wall takes WallEdit) and its default snap (grid/edge/surface/free). validateCatalog rejects any catalog row claiming a capability its kind never promised — it caught its first real table bug during the capture itself.',
      status: 'live',
    },
    {
      name: 'applyWallEdit / effectiveTags',
      purpose: ['world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/build/edits.ts',
      description:
        'Edit semantics as data: each WallEdit declares tag overrides + portalKind (none/walk/vehicle) + sightline + traversable. A doorway IS a portal (walk); a window is sightline-but-not-traversal; brokenWindow adds the vault entry; garageDoor admits vehicles; halfHeight drops to vaultable low cover. effectiveTags(entry, edit) is what the bake and every authoring view read — authored meaning and baked meaning cannot drift.',
      status: 'live',
    },
    {
      name: 'BUILD_CATALOG',
      purpose: ['world_gen'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/build/catalog.ts',
      description:
        'The P2 variety tables: ~24 seed rows across themes (common + downtown/motel/trap_lot/suburb/industrial) and materials (concrete/brick/stucco/wood/metal/glass/chainlink). Sizes in meters on the 3m-storey module (R4: 1 tile = 1m). Glass durability carries materials.ts health exactly (Storefront 60). Prop rows reference propKind into game/kinds (assets are prompt-generated via the items/model pipelines — the builder never models props). Cover speaks TileCoverHeight — cover values carry into the chance engine vocabulary.',
      dependsOn: ['GAME_KINDS'],
      status: 'live',
    },
    {
      name: 'decomposePrefab',
      purpose: ['world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/build/prefabs.ts',
      description:
        'The see-through law: a prefab placed at an origin IS its semantic pieces with effective tags resolved (a cloned motel is still walls/doors/rooms to collision/nav/rooms emission). Placing a prefab is ONE authoring action; instance edits stay piece-granular. Static seeds prove the shape; real prefabs are world-saved on the V20 streams.',
      status: 'live',
    },
    {
      name: 'WorldMarker / validateMarkers',
      purpose: ['world_gen', 'pathing'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/build/markers.ts',
      description:
        'The semantic-overlay union ("pathing and triggers are not geometry"): path_node {pos,tags} · trigger {bounds,event} · room {polygon,role: public/private/staff/home} · portal {fromRoom,toRoom,doorId?} · interest_point {pos,role: sit/work/shop/guard/smoke} · camera_marker {pos,target,shot}. Cross-reference validation: portals resolve to two DIFFERENT room markers in the set. Reconciliation law honored in the types: trigger.event is a V19 command line (bakes to world cell triggerCommand); camera_marker.shot names an existing camera-registry rig; mission objective markers stay game/missions\' own.',
      dependsOn: ['GAME_WORLD', 'GAME_CAMERA'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Contract-validated P2 tables',
      purpose: ['world_gen'],
      description:
        'Game meaning on the KIND (contract), variety in the CATALOG (rows), composition by EDIT (overrides) — extending the grammar is adding table rows, never logic branches; validateCatalog holds the boundary so a row cannot promise what its kind cannot bake.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'Annotate, never duplicate (overlay reconciliation)',
      purpose: ['world_gen', 'pathing'],
      description:
        'Markers ANNOTATE the physical world by id and reference other systems\' vocabularies (command lines, camera rigs, room ids) — the authoring representation bakes into captured systems\' data, never a second source of truth.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'BakePromise is a declaration — nothing emits yet',
      purpose: ['world_gen'],
      description:
        'game/build declares what pieces promise the bake; no render/collision/nav/rooms emission exists. The compile/world integration must consume BakePromise/effectiveTags/decomposePrefab — an emission needing an undeclared shape changes the declaration FIRST, in game/build. Do not implement a parallel bake vocabulary.',
      evidence: ['cart/hmsc-int/game/build/pieces.ts (BakePromise)', 'cart/hmsc-int/game/build/CAPTURE.md'],
      severity: 'medium',
    },
    {
      name: 'doorId / piece existence is the bake\'s check, not static',
      purpose: ['world_gen'],
      description:
        'portal.doorId references a placed piece in the V20 placement streams; validateMarkers can only check shape and room cross-references statically. A dangling doorId surfaces at bake time, not at authoring-table validation.',
      evidence: ['cart/hmsc-int/game/build/markers.ts (validateMarkers)'],
      severity: 'low',
    },
  ],
};
