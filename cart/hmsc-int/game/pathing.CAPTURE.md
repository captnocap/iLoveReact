# Capture note — game/pathing (V5, 2026-06-05)

PATHING captured host-leaning per V5: the host A* graduated from
`framework/v8_bindings_pathing.zig` (now deleted) into
`framework/game/pathing.zig` behind the thin registrar
`framework/v8_bindings_game_pathing.zig` (`-Dhas-game-pathing`, registry
feature `game-pathing`); the LANE DISCIPLINE moved host-side out of
`cart/pathing_lab`; deterministic motion plans are host-COMPILED with the
JS mirror kept for headless. The door is `game/pathing.ts` (`GAME_PATHING`),
re-pointed to the honest `__game_pathing_*` wire.

## Sources (read, never moved/edited)

| piece | old home | disposition |
|---|---|---|
| grid A* + profiles + flows + lane offset | `framework/v8_bindings_pathing.zig` | REWRITTEN to module conventions in `framework/game/pathing.zig`; emission bit-identical for callers that never publish kind classes; old file deleted (fully graduated — no toy remained, unlike physics_lab) |
| `snapToLaneCenters` + `straightenJunctions` | `cart/pathing_lab/index.tsx` | promoted HOST-side as discipline passes on the RAW cell path: trio-center snap derived from contiguous same-flow runs (structural, not band constants), corridor-gap (crosswalk) inheritance, junction apexes at lane-line intersections (early right / deep left). Opt-in via `setKindClasses` |
| trapezoidal motion plans | `runtime/motion.ts` | plan COMPILATION ported to f64 Zig (`plan`/`samplePlan`/`slicePlanPoints`, packed-plan wire `__game_pathing_plan`); the JS mirror stays the headless fallback and the per-frame SAMPLER (closed form, zero bridge, V16) |
| JS face + disruption ring | `runtime/pathing.ts` | REWRITTEN into the door on honest names; the change-rect ring stays door-side (bookkeeping, no bridge); `runtime/pathing.ts` keeps serving old carts via the preserved `__path_*` names |

## Verification

- `zig build test-game-pathing` — 14 P4 behavior tests: routes
  found/blocked/reopened, generation semantics, query determinism, flow
  discipline, trio snap (z=9.5 exact), crosswalk crossed straight, straight
  junction pass, right apex (13.5, 9.5) vs left apex (16.5, 9.5),
  discipline opt-in (legacy emission without classes), plan determinism /
  ends-at-rest / monotone arc / hairpin slowdown / slice-replan continuity /
  degenerate safety.
- `game/pathing.test.ts` — 8 TS cases (headless fakes on honest names);
  `rjit game verify` GREEN.
- `tools/rjit ship pathing_lab` — old cart ships through the new gate,
  carries both name sets, boots clean (legacy wire served by the rewrite,
  discipline off → bit-identical emission).

## Behavior improved over the reference (deliberate, V5-ruled)

The lab ran discipline cart-side on MERGED waypoints and therefore had to
distrust coordinates ("a collinear-merged leg whose both corners sit inside
boxes has no snappable waypoint in between"). The host runs discipline on
the RAW cell path before merging, so the flanking cells are always
lane-true and the apex is exactly the intersection of the entry and exit
lane lines — the lab's box-geometry workaround became unnecessary
structurally. The lab's band constants (`ROAD_BANDS`, `ROAD_W`, trio
offsets 1.5/4.5) are NOT carried: trio centers derive from contiguous
same-flow runs in the published grid (P2 — the grid is the data).

## Deliberately NOT carried

- `PROFILE_TUNING` (pathing_lab) — the flow-hint multiplier layer is cart
  DATA shaped per-cart (P2); profiles arrive whole through `setProfile`.
- `pickGoalAhead`, traffic-signal phases, vehicle rigs — lab scene logic,
  not pathing; signals belong to the traffic system (V21 territory).
- Per-slot host-side plan STORAGE and batch sampling — plans are compiled
  stateless and sampled JS-side; slot pools + batch sampling belong to the
  V21 ambient/traffic system when it exists (surfaced, not built).

## Surfaced cross-system needs (NOT implemented here)

- **kinds → pathing flow data**: `GAME_KINDS.tiles` already carries `flow`
  per kind; the world boot needs one adapter that feeds kind indices,
  costs, flows, and classes into `GAME_PATHING.publishGrid/setProfile/
  setFlows/setKindClasses`. Owner: world/compile.
- **physics step integration**: NPC motion samples (x, z, heading) need a
  consumer in the physics/entity step for collision-aware following.
  Owner: the traffic/NPC system (V21).
- **V21 token-dictionary ambient pathing** distills FROM these A* routes at
  bake time; nothing ambient calls `find()` at runtime.
