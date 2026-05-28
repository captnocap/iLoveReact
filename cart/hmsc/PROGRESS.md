# HMSC Progress

Last updated: 2026-05-28

## Current Shape

HMSC is split into two carts:

- `hmsc`: the game cart.
- `hmsc-int`: internal map tooling.

The game state is a single JSON `GameState` object defined in `design.ts`.
World authoring is grid-locked, while player movement is continuous over that
grid. The shared map data lives in `GameState.world.placedCells`; both the 3D
game view and the internal map read from that source.

## Implemented

- Created the HMSC cart scaffold with a command-first surface.
- Split the game cart from the internal map cart.
- Normalized the cart names around `hmsc` and `hmsc-int`.
- Added a shared demo map in `world/demoMap.ts`.
- Added grid helpers in `world/grid.ts` for cell keys, chunk keys, world/cell
  conversion, placement, removal, and occupancy checks.
- Added typed tile kinds in `world/tileKinds.ts`.
- Added pathing metadata per tile kind:
  - `walkable`
  - `movementCost`
  - `blocksLineOfSight`
- Added render metadata per tile kind:
  - color
  - height in meters
  - texture key
- Added `world/pathing.ts`, a basic grid pathfinder that uses tile pathing
  metadata.
- Added command support for map/path work:
  - `place <kind> <x> <z> [y]`
  - `remove <x> <z> [y]`
  - `path <fromX> <fromZ> <toX> <toZ> [y]`
- Added the third-person drive-mode player model from `animation_lab`.
- Added continuous WASD/arrow movement in `state/usePlayerDrive.ts`.
- Fixed movement basis to match `animation_lab` drive mode:
  - `W` moves away from the camera into the scene.
  - `A`/`D` strafe in the same direction as the lab.
- Added smoothed camera drag and matched the lab's third-person camera position.
- Added live player sync from `hmsc` to `hmsc-int` through a compact
  localstore snapshot.
- Added continuous player marker rendering in `hmsc-int`.
- Added click-to-inspect tile diagnostics in `hmsc-int`.
- Ported the player-facing Scape3D HUD shape into `hmsc`:
  - GTA-style clock, cash, health, armor, item box, and wanted stars
  - circular bottom-right minimap rendered from `GameState.world.placedCells`
  - player marker and facing pip driven by continuous player position/yaw
  - item menu and debug panels intentionally left out for now

## Internal Map Diagnostics

Clicking a cell in `hmsc-int` selects it and shows:

- cell coordinates
- chunk key
- world center position
- tile kind and label
- texture key
- render color and height
- pathing walkability, cost, and line-of-sight blocking
- original placement command

Empty cells are shown as non-walkable with no texture.

## State And Sync

Persistent game saves use the `hmsc/game-state` localstore entry.

Live player sync uses the `hmsc/live-player` localstore entry. This is a compact
snapshot of the player only, not the full world, so movement does not become an
autosave and does not hit localstore value-size limits as the map grows.

`hmsc-int` reads the saved world and overlays the live player snapshot.

## Verification

The current HMSC work has been verified with:

```sh
./scripts/ship hmsc
./scripts/ship hmsc-int
timeout 6s ./zig-out/bin/hmsc
timeout 6s ./zig-out/bin/hmsc-int
```

The timeout checks are expected to exit with code `124`; success means the carts
reached the render loop before timeout.

## Known Next Work

- Replace placeholder `textureKey` values with actual texture/material assets.
- Add authored map editing commands or map-tool controls for creating cells from
  `hmsc-int`.
- Expand tile metadata for NPC pathing, cover, doors, visibility, and traversal
  constraints.
- Add NPC state and path-following using `world/pathing.ts`.
- Add collision and movement diagnostics to the internal map.
- Decide whether camera pitch should affect third-person target height or remain
  lab-matched and mostly cosmetic until first-person mode exists.

## Recent HMSC Commits

- `1458cb243 feat: add hmsc map tile diagnostics`
- `10a977d45 feat: sync hmsc player to internal map`
- `51e7c8506 feat: add hmsc tile pathing and drive movement`
- `cf8c4ef6f feat: share hmsc map across game and tooling`
- `5a4ab5eec fix: normalize hmsc cart names`
- `37b1257b0 refactor: split hsmc game and internal map carts`
- `fb04cc3f0 feat: scaffold hmsc command cart`
