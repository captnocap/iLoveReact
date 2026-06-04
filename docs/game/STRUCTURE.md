# STRUCTURE — the hmsc-int directory shape (PROPOSED, not yet ruled)

Greenfield proposal per the constitution (DECISIONS.md). Existing files are NOT
the input — the isolated systems get EXTRACTED INTO this one system. When ruled,
this becomes the blueprint; the extraction map at the bottom says what lands where.

## The shape

```
cart/hmsc-int/
  index.tsx            the shell: router only — thin, boring, never grows logic
  AGENTS.md            the cart contract (oracle-first, this file's rules)

  game/                ★ THE GAME — the one system, the GAME_* ground floor (V14/V17)
    index.ts           the ONLY door: exports GAME_PHYSICS, GAME_PATHING, GAME_INPUT,
                       GAME_CAMERA, GAME_FIGURE, GAME_VEHICLE, GAME_ITEMS,
                       GAME_ANIMATION, GAME_KINDS, GAME_LOOP, GAME_CHANCE,
                       GAME_PERCEPTION, GAME_CUTSCENE, GAME_CHROME, GAME_TELEMETRY
    loop.ts            frame loop + the ~45/min state tick + event channel (V8)
    camera.ts          registry + aim rig + screenRay picking (V3)
    input.ts           key/pointer transport only — integration is host-side (V7)
    physics.ts         the host physics interface (V1; speaks the game bindings)
    pathing.ts         host A* + deterministic motion plans (V5)
    figure/            the character kit (V2): skeleton, parts, .hed/.body, render,
                       captures, ragdoll behavior-reference, the BAKE entry
    vehicle/           VehicleDoc + buildVehicle + part vocabulary (V10)
    items/             the items registry + models (V11)
    animation/         DSL semantics today; the RLE/relational format grows here (V6)
    kinds/             tile/prop/NPC/role/landform registries (V4)
    chance.ts          ONE odds engine: breakdown surface + cover input (V9)
    perception.ts      the awareness ladder + consequence hooks (V12)
    cutscene/          the live scene format: one clock, tracks, scrubbing (V16)
    chrome/            lab chrome kit (Chip/Knob/Meter/panel) + lab environment
    telemetry.ts       perf panel + copy-diagnostics

  editors/             the tool surfaces — every authoring UI is an editor route
    world/             paint tiles, place things, preview — the map editor
    characters/        the head_lab EDITOR surface (authors what game/figure runs)
    vehicles/          vehicle authoring
    items/             item authoring (+ the scale-audit workbench, V11)
    materials/         shader/texture/material studio (the locked art vocab)
    cutscenes/         timeline editor + scrubber over game/cutscene
    tuning/            P2 made real: every exposed value, edit → compile and go

  labs/                short scaffolded files — the experiment slots (V13/V17/P5)
    _scaffold.tsx      the template `rjit lab new <name>` copies
    <name>.tsx         a lab: GAME_* imports + an exported scene. Nothing else.
    <name>.notes.md    per-lab notes — read by humans, AI, and the oracle (P6)

  compile/             V15: data/ + game/ → the emitted hmsc game (the bake)

  data/                authored documents + tuning tables — what P2 edits,
                       what compile/ consumes (characters/, vehicles/, world/,
                       tuning/). JSON/documents, never logic.

  shell/               the tool's own chrome: nav, routes, workspace/session
                       state, the assistant — tool concerns, never game concerns
```

Zig side (unchanged from V18, restated for completeness):

```
framework/game/            physics.zig, movement.zig, pathing.zig — the implementations
framework/v8_bindings_game_*.zig   thin registrars, gated ingredient (has-game*),
                                   flipped by importing cart/hmsc-int/game/
```

## The import rules (this is the actual structure)

Dependencies point one way; violating an arrow is a bug:

```
labs/     → game/ only.                      (a lab that imports an editor is wrong)
editors/  → game/ + shell/ + data/.
game/     → framework bindings + runtime/.   (never imports editors, labs, shell)
compile/  → game/ + data/.
shell/    → nothing game-specific.
data/     → imported by everyone, imports nothing (it's data).
```

- `@game` becomes a bundler alias for `cart/hmsc-int/game` — labs and editors
  write `import { GAME_CAMERA } from '@game'` (V17), and that import is ALSO the
  metafile-gate signal that compiles the game's host bindings in (V18).
- `game/index.ts` is the only public door (P3 deep interfaces). Editors may
  reach into `game/figure/` internals because they author it; labs may not.
- Every behavior-affecting number in `game/` resolves from `data/tuning/` (P2).
  A literal constant in `game/` logic is a bug.

## The extraction map (isolated systems → their one home)

| Today (isolated)                          | Lands in                                  |
|-------------------------------------------|-------------------------------------------|
| cart/head_lab (kit: parts/hed/figureRender/ragdoll) | game/figure/                     |
| cart/head_lab (the editor UI)              | editors/characters/                       |
| cart/vehicle_lab                           | game/vehicle/ + editors/vehicles/         |
| cart/game_item_gallery                     | game/items/ + editors/items/              |
| cart/animationDsl.ts                       | game/animation/                           |
| runtime/cameras + combat_lab aim rig       | game/camera.ts (registry stays runtime/; aim rig + screenRay graduate INTO runtime/cameras, game/camera.ts is the game-facing door) |
| runtime/pathing.ts + runtime/motion.ts + pathing_lab lane discipline | game/pathing.ts (lane discipline moves host-side per V5) |
| hmsc/state/hostPhysics.ts                  | game/physics.ts                           |
| scape chance + hmsc chance + coverFractionOf | game/chance.ts (V9 hybrid)             |
| combat_lab perception + scape consequences | game/perception.ts (V12)                  |
| hmsc world/tileKinds + prop/NPC registries | game/kinds/                               |
| hmsc-int existing paint/preview            | editors/world/                            |
| hmsc-int ShaderLab/TextureStudio/materials | editors/materials/                        |
| combat_lab / pathing_lab / ragdoll_lab / planet_run scenes | labs/<name>.tsx (rebuilt on @game, with notes) |
| lab Chip/Knob/panel + skybox/lights re-rolls | game/chrome/                            |

What does NOT move: `runtime/` and `framework/` stay platform (the registry,
primitives, workspace, geometries — game/ consumes them). `cart/hmsc/` shrinks
toward being compile/'s OUTPUT (V15) rather than a hand-written cart.

## Build order (Milestone 0, restated against this shape)

1. `game/index.ts` + the thin GAME_* wrappers (no host rebuild — they call the
   existing `__hmsc_*`/`__path_*` names until the honest bindings land)
2. `labs/_scaffold.tsx` + `rjit lab new <name>` + the labs route in shell
3. `framework/game/` + gated `v8_bindings_game_*` (parallel worker; wrappers
   re-point when it lands)
4. First lab rebuilt on the shape (proves the contract end to end)
