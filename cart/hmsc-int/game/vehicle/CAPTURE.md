# game/vehicle - capture note (V10, captured 2026-06-05)

Sources (BEHAVIOR REFERENCES - read, never imported, never modified):

| Old file | Lines | Disposition |
|---|---:|---|
| `cart/vehicle_lab/index.tsx` | 839 | rewritten into `index.ts` as the React-free game system: `VehicleDoc`, `makeVehicle`, `buildVehicle`, semantic `VehiclePartId`, style/role/pose/damage/material/tuning tables |

Oracle ruling: V10 says `vehicle_lab` is the source for the vehicle module, and
the reusable unit is `VehicleDoc + buildVehicle + semantic VehiclePartId`. The
lab component is not the unit. `cart/ragdoll_lab/car.tsx` CarMeshes and
`cart/hmsc/render3d/structures/Car.tsx` are retired by ruling and were not read
as implementation sources for this capture.

## What the old file contained

- 8 vehicle styles: sedan, coupe, wagon, van, pickup, sports, ambulance,
  fire_truck.
- 4 roles: civilian, police, medical, fire.
- 5 pose presets as animation DSL strings: parked, roll, turn, bounce, brake.
- 18 semantic part ids used by rendered meshes, hitboxes, selection, and sparse
  damage state: body, cabin, trunk, bumper, windshield, driver_side,
  passenger_side, rear, front_lights, rear_lights, driver_door, passenger_door,
  hood, front_left_wheel, front_right_wheel, rear_left_wheel, rear_right_wheel,
  gas_tank.
- `makeVehicle(seed)`: deterministic role/style/paint/trim/gas-side/gas-Z doc
  generation.
- `buildVehicle(doc, actions)`: primitive mesh build, explicit gameplay
  hitboxes, named anchors, service liveries, action-driven wheel/steer/bounce/
  brake transforms, and damage cascade/material weakening.
- The VehicleLab authoring/debug UI: chips, knobs, random generate/paint/damage,
  orbit camera controls, hitbox/anchor overlays, and Scene3D rendering.

## New shape

`game/vehicle/index.ts` is the only game-facing door. It exports the same
document/builder/vocabulary types and `GAME_VEHICLE` with:

- `make` / `build` for generated docs and runtime builds.
- `tables.parts`, `tables.styles`, `tables.roles`, `tables.poses`,
  `tables.damageLabels`, `tables.random`, `tables.materials`,
  `tables.meshParams`, `tables.tuning`.
- Pure helpers (`damageOf`, `maxDamage`, `shade`, `panelMaterial`,
  `glassMaterial`) because tests and future editors need the table meanings.

The module is React-free and has no dependency on `vehicle_lab`, `Scene3D`,
`Geometry`, `react`, or `cart/hmsc`.

## Deliberately dropped

- The authoring/debug UI (`VehicleLab`, `VehicleMeshes`, `Chip`, `Knob`, drag
  orbit state, zoom control, hitbox/anchor overlay toggles). V10 asks for the
  system only; the vehicle authoring UI moves to `editors/vehicles/` in a later
  wave.
- Non-deterministic UI seed sources (`Date.now() ^ Math.random()`), random
  paint, and random damage buttons. The game system keeps deterministic
  `makeVehicle(seed)` and sparse damage documents; UI affordances are editor
  scope.
- `geometryFor()`'s dependency on `@reactjit/geometries`. The game build emits
  `VehicleMesh.kind` and params. Renderers can map those kinds to geometry
  objects at their own boundary without pulling renderer packages into the
  headless game door.

## Ambiguities surfaced, not guessed

1. Scale is not verified. The lab says "1 unit = 1m, player ref 1.65m" and V10
   explicitly says many cars still need work against the fixed 1-tile=1m
   contract. This capture preserves the dimensions; scale audit is a separate
   ruling/work item.
2. Breakable/health material metadata is authored but inert. No damage
   simulation, physics response, shatter system, or health decrement consumes it
   yet. The metadata is preserved as table data for the future damage lane.
3. Fire-truck tandem rear wheels remain extra meshes sharing the two rear wheel
   semantic ids. No new part ids or hitboxes were invented.
4. Vehicle pose strings still use the old animation DSL shape because
   `GAME_ANIMATION` owns the parser/relational rewrite. `buildVehicle` consumes
   sampled action records only.
5. P2 grain: style dimensions, role pools, pose strings, material meanings,
   mesh params, generation weights, and top-level action scales are lifted into
   exported tables. The builder still contains formula coefficients for panel
   placement and livery geometry; they are part of the reference rig recipe.
   If P2 is later ruled to require every panel coefficient as named table data,
   that is a follow-up mechanical lift, not a behavior change.

## Verification

- Reference vs rewrite entry-count comparison:
  - part ids: reference 18 / rewrite 18
  - styles: reference 8 / rewrite 8
  - roles: reference 4 / rewrite 4
  - poses: reference 5 / rewrite 5
- P4 suite `vehicle.test.ts` runs under `tools/v8cli`: vocabulary counts,
  deterministic generation, 64-case style x role x gas-side sweep, hitbox
  coverage, critical-part vocabulary, damage material meaning, action effects,
  service silhouette counts, tandem wheel semantic ids, and `GAME_VEHICLE`
  door shape.
- Targeted runs completed during capture:
  - `tools/v8cli zig-out/game/tests/game_vehicle_vehicle.test.js`: 7/7
  - `tools/v8cli zig-out/game/tests/game_index.test.js`: 3/3

No divergences from V10 rulings were introduced. The only intentional boundary
changes are the UI drop and renderer dependency drop above.

## Editors-wave addition (2026-06-04): the V20 `vehicles` stream

`stream.ts` defines the `vehicles` concern (the GARAGE: authored `VehicleDoc`
per id + first-authored rail order), following the `world`/`missions`
precedent of the stream def living beside its system. Events carry the
RESULTING doc (`authored` upsert / `removed`), never the edit verb — the edit
logic (style clamps, role coercion, damage nudges) is editor-side in
`editors/vehicles/edits.ts`, so the materializer is a dumb upsert and the
round-trip author → stream → snapshot → buildVehicle is exact by
construction. `GAME_VEHICLE.stream` carries the def; `game/index.ts`
re-exports `vehiclesStream` + the doc types as NAMED exports (not a 20th
GAME_* door — the same shape as `createKeyState`/`CAMERA_RIGS`).
`stream.test.ts` (5 P4 cases) pins garage semantics, schema-evolution
tolerance, the deletion-contract round-trip through a real on-disk store, and
undo-as-log-position.

## Per-part painted textures (MODELPAINT-0605, 2026-06-05)

GREENLIT as new capability (vehicles had NO texture system — color/trim
hexes only): `VehicleDoc.paint?` — per-`VehiclePartId` `PaintedOverlay`
slots (game/painted.ts), authored in /cutout. `applyVehiclePaint` is the
pure save step (null removes; last removal drops the channel).
`buildVehicle` threads a content-addressed `textureKey` onto a painted
part's SURFACE meshes; damage scars/cracks and role livery stripes/marks
are DECALS (the `asDecal` guard) and never take the paint. Pinned: a
paintless doc builds meshes with no textureKey field at all (byte-identical
to pre-capability builds); paint→unpaint rebuilds byte-identical.

REPRESENTATIONAL PICKS (named, per the ruling's no-stall order):
- granularity = the existing `VehiclePartId` vocabulary — one painting per
  part id; every mesh of the part's surface set shares it (the hood's
  grille detail is hood surface, so it takes the hood's paint — per-part
  uniformity beats special-casing details).
- unwrap convention = one square canvas per part, box-mapped to all six
  faces of each part mesh (the billboard_demo texture law). No per-face
  unwrap; a part with several boxes repeats the texture per box.
- glass/light parts are paintable like everything else (uniform
  capability); a painted windshield reads opaque — the user's choice.
