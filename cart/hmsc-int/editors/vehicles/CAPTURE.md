# editors/vehicles - editor capture note (V10/V17-TRIAGE, 2026-06-04)

Source (BEHAVIOR REFERENCE - read, never imported, never modified):

| Old file | Lines | Disposition |
|---|---:|---|
| `cart/vehicle_lab/index.tsx` | 839 | the SYSTEM half was already captured to `game/vehicle/` (V10, 2026-06-05); THIS wave remakes the AUTHORING half as the `/vehicles` route. The user deletes `cart/vehicle_lab` when this checklist is done. |

Ruling chain: V10 (vehicle_lab is the source; the reusable unit is
VehicleDoc + buildVehicle + VehiclePartId), V17-TRIAGE (authoring UI = an
editors/ route INSIDE the tool, written fresh), V20 (editors write to the
data layer from their first version), dispatch rule (vehicles gets NO
internal-reach exception - everything through the `@game` door).

## The deletion contract - completeness inventory

Every authoring capability the old interface had, each checked off in its
new home:

| # | Capability (reference line) | New home | Status |
|---|---|---|---|
| 1 | Style picker; switch re-fits gasZ (`setStyle` :668) | `edits.ts editStyle` + chips | DONE |
| 2 | Role picker; pool coercion, service livery, civilian keeps paint (`setRole` :678) | `edits.ts editRole` + chips | DONE |
| 3 | Pose picker + run toggle, 33ms playback (:756, :640) | route state + `GAME_ANIMATION.parse/sample` | DONE |
| 4 | Generate fresh seeded doc (`generate` :660) | `edits.ts generateVehicle` + garage `+ new` / `reroll` chips | DONE |
| 5 | Random paint from tables (`randomColor` :699) | `edits.ts repaint(doc, seed)` (deterministic per seed) | DONE |
| 6 | Gas side chips + gasZ knob, clamped (:771, `moveGas` :693) | `edits.ts editGasSide/setGasZ/gasZKnobSpec` + `GAME_CHROME.Knob` | DONE |
| 7 | Hitbox-group selection chips + none (:780) | route selection state | DONE |
| 8 | Damage: repair / +1 nudge / wreck spread / level chips (:790) | `edits.ts setPartDamage/nudgeDamage/wreck/repairAll` | DONE |
| 9 | Overlays: hitboxes (damage/critical tint), anchors, selected 1.04x highlight (:577) | `VehiclesRoute VehicleMeshes` (memo'd - the camera-drag lesson) | DONE |
| 10 | 3D viewport: orbit drag (0.38/0.3 per px, pitch 5..82), zoom 4..14, lights/ground (:819) | route viewport - `GAME_CAMERA.rigs.Orbit` solve + `GAME_CHROME.LabEnvironment('arena')` + `knobPresets['orbit.zoom']` | DONE |
| 11 | Contract readout (style/role/scale/size/wheel/dsl/seed/gas/selected/damage) (:804) | route panel (+ id and saved-seq lines) | DONE |
| 12 | Mesh kind -> geometry mapping (`geometryFor` :194) | route-local `geometryFor` (the V10 renderer-boundary rule) | DONE |
| 13 | NEW - V20 persistence from the first version | `game/vehicle/stream.ts` (the garage) + store wiring in the route | DONE |

P4 coverage: `vehicles.test.ts` (8 cases - every edit step headless) +
`game/vehicle/stream.test.ts` (5 cases - garage semantics + THE round-trip:
author -> stream -> snapshot -> buildVehicle identical). `rjit game verify`
now owns `cart/hmsc-int/editors` as a suite root.

## Deliberate changes from the reference

- **Multi-vehicle garage.** The lab edited ONE transient doc; the editor
  authors a persisted set (`car-1`, `car-2`, ...) because the game world needs
  many authored vehicles and V20 demands persistence from v1. Not a drop - an
  addition.
- **Events carry the resulting doc.** The stream's `authored` event records
  the doc an edit step produced, never the edit verb - the materializer stays
  a dumb upsert, the round-trip is exact by construction, and each edit is
  still its own undo position.
- **Knob rounding.** `GAME_CHROME.Knob` rounds gas-Z to 2dp on nudge (the lab
  stored raw floats and only displayed 2dp). 1cm precision on a fuel port is
  an accepted editor refinement; `setGasZ` still owns the clamp law and is
  pinned by test.
- **moveGasZ became setGasZ + gasZKnobSpec** so the chrome knob's
  step/clamp/round and the pure step share one contract instead of two
  parallel math paths.
- **Scene environment.** The lab's hand-rolled BG/lights/ground became
  `GAME_CHROME.LabEnvironment preset="arena"` (the V14 every-lab-gets-chrome
  rule). The vehicle reads slightly differently lit than the old cart; the
  meshes are bit-identical.

## Deliberately dropped

- The lab's module-scope export surface (`VEHICLE_STYLES`, `makeVehicle`,
  `buildVehicle`, types re-exported for pathing_lab). Consumers now use the
  `@game` door; old carts keep importing from `cart/vehicle_lab` until their
  own capture waves land (pathing_lab is listed for labs/ rebuild).
- The non-deterministic seed MIXING into derived rolls (`doc.seed ^
  Date.now()` for paint/wreck). The editor passes one fresh seed per action;
  the steps themselves are deterministic per seed (P4-pinned). UI seed
  freshness stays intentionally non-deterministic (the recorded LOW hazard).

## Ambiguities surfaced, not guessed

1. **Two gasZ clamp ranges.** The reference clamps tighter on style/role
   refit (-0.16L..0.42L) than on knob nudge (-0.22L..0.45L). Both preserved
   verbatim in `VEHICLE_EDITOR_TUNING.gasZ`; whether the asymmetry is design
   or accident is a vehicle-lane question.
2. **Pose strings still speak the old animation DSL** (the game capture's
   ambiguity 4 stands; GAME_ANIMATION owns the eventual relational rewrite -
   the editor consumes `parse`/`sample` only and follows automatically).
3. **The compile/ consumer is not wired yet.** The garage snapshot
   (`data/snapshots/vehicles.snapshot.json`) is written and round-trip-proven,
   but nothing in compile/main.ts places authored vehicles into the world.
   That is the compile lane's seam: load `vehicles` snapshot -> `GAME_VEHICLE
   .build` per doc at authored world positions (placement schema TBD - the
   doc deliberately has no world position; placement belongs to the world
   stream, not the vehicle document).
4. **Scale audit still open** (V10: "many cars need work" against 1-tile=1m).
   The editor displays the same contract line the lab did; auditing the
   dimension tables is a separate ruled work item.
