import type { DocIndex } from '../types';

export const game_world: DocIndex = {
  name: 'game_world',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/world/index.ts',
  purpose: ['world_gen', 'physics', 'persistence'],
  summary:
    'V4 capture of the world grid state — "the tile system IS the system" made a door (gap W-1, the last structural gap from the TestRoute inventory). The substrate the authored map lowers to: surface regions + placed cells + landform instances (1 tile = 1 m, R4), pure mutators/resolvers, ground-height + footing semantics (analytic tops with the 0.01 m mesh-sink, walkable gating, slope-gated landform surfaces vs raw tops), gameplay markers (spawn/save with the save↔spawn pairing), trigger cells as pure once-per-entry steps, respawn ground-snapping, the world→collider adapter feeding GAME_PHYSICS (CollisionRect[]/Heightfield[] — the world half of old hostPhysics.ts; the wire half is game/physics.ts), the authored-map loader over the editor compile channel, and the V20 world stream. Fidelity: 251,550-comparison sweep vs the reference math, 0 mismatches. NOT in the ruled 19-door game/index.ts list — the 20th-door question is surfaced, not taken; in-game/ consumers import ../world.',
  interfaces: [
    {
      name: 'GAME_WORLD',
      purpose: ['world_gen', 'physics'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/world/index.ts',
      description:
        'The P3 door: createState + cell math (cellKey/worldToCell/cellCenterToWorld), pure mutators (placeCell/removeCell/addSurfaceRegion/setCellTrigger/placeLandform/removeLandform/placeMarker), resolvers (placedCellAt/surfaceRegionAtCell/tileKindAtCell/canPathThroughCell/triggerCellAtWorldPosition), heights (groundTopAtWorldPosition walkable-gated vs landformGroundTopAt raw, footingKindAtWorldPosition with water>cell>landform>region order), the physics adapter (collisionRects/heightfields/bakeLandformHeightfield/registerHeightfields, dropped counts never silent), spawn semantics (defaultSpawnCell/respawnPoint/enteredSaveStep/enteredTriggerStep), the authored-map loader (loadAuthoredWorld over \'hmsc\'/\'game-state\'), and the V20 stream. Kind MEANING stays in GAME_KINDS; this door iterates instances.',
      dependsOn: ['GAME_KINDS', 'GAME_PHYSICS'],
      status: 'live',
    },
    {
      name: 'worldCollisionRects / worldHeightfields',
      purpose: ['physics'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/world/colliders.ts',
      description:
        'The world→physics derivation: regions/cells → solid bands (blocksPlayer = ¬water ∧ ¬walkable; friction/restitution from the tile table), landforms → baked height grids (kind rise sampled cols×rows across the footprint; a painted field bakes its own grid 1:1 — see-it == walk-it). Slots assign in array order; clear-then-register replaces, never accretes. Truncation at the host caps (512 rects, 64 heightfield slots) is returned as `dropped`. Roads/junctions/props/buildings rects join via their own lanes at documented seams.',
      status: 'live',
    },
    {
      name: 'groundTopAtWorldPosition / footingKindAtWorldPosition',
      purpose: ['world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/world/heights.ts',
      description:
        'The two height questions kept distinct: walkable ground under a point (tile walkability + landform slope gate + step-height reach — what the player stands on) vs landformGroundTopAt raw surface (what a placed object rests on). Footing order: landform water (wading) > placed cell > [junction] > [road] > landform footing (the carved trail/road) > surface region. Proven against the reference math over 251,550 sweep comparisons.',
      status: 'live',
    },
    {
      name: 'enteredSaveStep / enteredTriggerStep / respawnPoint',
      purpose: ['world_gen', 'game_loop'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/world/spawn.ts',
      description:
        'The drive-loop world steps as PURE steps with inert returns: debounce keys ride in/out as data; a save arms its PAIRED spawn (spawnKey, never self; dangling pairs fall back to the save cell) and tells the caller to persist; a trigger fires its command line once per entry. respawnPoint = cell centre, y ground-snapped within step reach, groundedOnWorld honesty flag. Scene gating is deliberately caller-side.',
      status: 'live',
    },
    {
      name: 'loadAuthoredWorld',
      purpose: ['persistence', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/world/authored.ts',
      description:
        'The user\'s authored map through the door: reads the editor compile channel (localstore \'hmsc\'/\'game-state\', both host shims), extracts the grid slice + player start/respawnCell tolerantly (absent layers → empty, malformed → null, never a faked world), and hands the parsed record on as `raw` for the other world lanes. Consumes the channel as DATA — no mapStore/editorWorld fork.',
      status: 'live',
    },
    {
      name: 'worldStream',
      purpose: ['persistence'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/world/stream.ts',
      description:
        'The V20 world concern in ONE registration: grid edits as events (cellPlaced/cellRemoved/regionFilled/triggerSet/landformPlaced/landformRemoved/respawnArmed) folding into the WorldGridState snapshot the game loads; unknown future kinds pass through untouched (schema evolution by addition).',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Instances here, meaning in the registry',
      purpose: ['world_gen'],
      description:
        'The world door stores WHAT is placed (cells, regions, landform instances); game/kinds owns what a kind MEANS (walkability, surface profiles, rise formulas). Every height/footing/collider query iterates one array and asks the registry — a new tile or landform kind changes zero world code.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'Layer seams documented where uncaptured lanes slot back in',
      purpose: ['world_gen', 'physics'],
      description:
        'The resolvers preserve the reference layer ORDER with the road/junction/building layers absent and marked ([junction band] > [road band] in footing; road/junction tops in groundTop; their rects in the collider derivation). A landing lane inserts at its seam instead of re-deriving the order.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'GAME_WORLD is not yet on the ruled door list',
      purpose: ['world_gen'],
      description:
        'STRUCTURE\'s game/index.ts door list (V17, RULED) has 19 doors and no GAME_WORLD; the capture deliberately did not edit game/index.ts. Until the supervisor/user rules the 20th door (or folds it elsewhere), labs cannot reach the world through \'@game\' — only game-internal consumers (vocabulary, future doors) import ../world.',
      evidence: ['cart/hmsc-int/game/world/index.ts (STRUCTURE note)', 'docs/game/STRUCTURE.md (door list)'],
      severity: 'medium',
    },
    {
      name: 'canOccupyWorldPosition deliberately not carried',
      purpose: ['world_gen'],
      description:
        'The reference\'s occupancy test is walkability AND no-building-blocks; buildings are an uncaptured lane, so only canPathThroughCell (the honest half) shipped. Porting code that relied on canOccupyWorldPosition must add the building check when that lane lands or it will walk through walls.',
      evidence: ['cart/hmsc/world/grid.ts:219', 'cart/hmsc-int/game/world/CAPTURE.md'],
      severity: 'low',
    },
  ],
};
