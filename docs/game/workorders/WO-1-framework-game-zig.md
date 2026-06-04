# WO-1 — framework/game/: the honest, gated Zig home

For a parallel worker. Read FIRST: `tools/oracle` exists — call it before any
decision (`tools/oracle "physics"`, `tools/oracle "movement"`). The constitution
is docs/game/DECISIONS.md; the shape is docs/game/STRUCTURE.md. Verdicts: V1,
V7, V18, R1, P1–P4.

## Mission
Create `framework/game/` and the gated `v8_bindings_game_*` registrars, ending
the physics_lab/input_bench naming lies as STRUCTURE, not renames.

## Deliverables
1. `framework/game/physics.zig` — the `__hmsc_*` sim implementation moved out
   of `v8_bindings_physics_lab.zig` (REWRITE to the framework's module
   conventions, not a paste; behavior identical — the existing sim is the
   behavior reference and must keep passing what it does today).
2. `framework/game/movement.zig` — the WASD integrator out of
   `v8_bindings_input_bench.zig`, unified INTO the physics step (V7: one
   host-side movement integrator; JS keysRef is transport only).
3. `framework/v8_bindings_game_physics.zig` — thin registrar; registers the
   same host fn NAMES as today (`__hmsc_physics_step` etc.) so JS callers keep
   working; new honest names may alias.
4. Ingredient gating (V18, strict): entry in `sdk/dependency-registry.json`
   triggered by `cart/hmsc-int/game/` imports; `has-game-physics` gate in
   build.zig; NEVER an unconditional addImport. 2D carts must show zero game
   host fns after this lands (verify with a sweatshop metafile check).
5. `v8_bindings_physics_lab.zig` keeps ONLY the `__physics_lab_*` toy + a
   header noting the graduation. `phys/physics3d.zig` gets the DORMANT-kept-
   for-clients banner (R1) and its fictional header deleted.
6. Zig behavior tests (P4) for physics + movement: jump arc, gravity, ground
   collide, heightfield sample — asserting BEHAVIOR, not signatures.

## Forbidden
- `git mv` as "the work" (rewrite to convention), breaking existing cart JS
  callers, touching QJS, branches, `git add -A`, subagents.

## Done =
ship builds green; hmsc + physics_lab + animation_lab behave identically
(P6: re-run them); sweatshop binary carries zero game bindings; zig tests pass.
Commit in logical units; update docs/game/_index records for physics3d/
physics_lab if their facts change (maintenance contract in CLAUDE.md).
