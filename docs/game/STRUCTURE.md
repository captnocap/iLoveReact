# STRUCTURE — the hmsc-int directory shape (PROPOSED, not yet ruled)

Greenfield proposal per the constitution (DECISIONS.md). Existing files are NOT
the input — the isolated systems get EXTRACTED INTO this one system. When ruled,
this becomes the blueprint; the extraction map at the bottom says what lands where.
The "(ruled)" tags in this document are citations of DECISIONS verdicts — only
the directory shape itself is the proposal.

## The shape

```
cart/hmsc-int/
  index.tsx            mounts shell/ and nothing else — thin, boring, never
                       grows logic; shell/ owns the routes
  AGENTS.md            the cart contract (oracle-first, this file's rules)

  game/                ★ THE GAME — the one system, the GAME_* ground floor (V14/V17)
    index.ts           the ONLY door: exports GAME_PHYSICS, GAME_PATHING, GAME_INPUT,
                       GAME_CAMERA, GAME_FIGURE, GAME_VEHICLE, GAME_ITEMS,
                       GAME_ANIMATION, GAME_KINDS, GAME_LOOP, GAME_CHANCE,
                       GAME_PERCEPTION, GAME_CUTSCENE, GAME_STORY, GAME_MISSIONS,
                       GAME_ACTIVITIES, GAME_COMMANDS, GAME_CHROME, GAME_TELEMETRY,
                       GAME_WORLD (the V4 substrate door — added during the
                       /test collision integration, commit 2e2fb2643),
                       GAME_BUILD (the V24 piece-grammar door — pieces/edits/
                       catalog/prefabs/markers, added with the build capture)
    loop.ts            frame loop + the ~45/min state tick + event channel (V8)
                       — API stays MINIMAL until the loop-shapes lab rules R3
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
    build/             the V24 piece grammar: kind taxonomy + bake contracts,
                       WallEdit vocabulary, the catalog (P2), prefabs
                       (decompose to pieces), WorldMarker semantic overlays —
                       data + validation; bake emission lands with compile/
    chance.ts          ONE odds engine: breakdown surface + cover input (V9)
    perception.ts      the awareness ladder + consequence hooks (V12)
    cutscene/          the live scene format: one clock, tracks, scrubbing (V16)
    story/             narrative arcs, dialog, flags — feeds/consumes perception
                       consequences (V12) and cutscenes (V16)
    missions/          scripted objectives — built on the cutscene clock, pathing,
                       and the state tick's forced events
    activities/        repeatable side loops (the non-mission gameplay verbs)
    commands/          the console-command registry (MOVED IN from hmsc) — also
                       THE test scripting surface: verify scripts are command
                       sequences (V19); anything testable is scriptable here
    chrome/            lab chrome kit (Chip/Knob/Meter/panel) + lab environment
    telemetry.ts       perf panel + copy-diagnostics

  editors/             the tool surfaces — every authoring UI is an editor route
    world/             paint tiles, place things, preview — the map editor
    build/             Creative Build mode (/build, V24): embodied third-person
                       piece placement — crosshair→snap, ghost, click places,
                       WallEdit cycling, prefab clone/stamp; placements ride
                       the V20 world stream (LANDED 2026-06-05)
    characters/        the head_lab EDITOR surface (authors what game/figure runs)
    vehicles/          vehicle authoring
    cutout/            the cutout painter — skins/textures painting (the cutout
                       app remade on the shared editors/paint engine; saved
                       documents + extracted cutouts on the V20 'cutout' stream)
    items/             item authoring (+ the scale-audit workbench, V11)
    materials/         shader/texture/material studio (the locked art vocab)
    cutscenes/         timeline editor + scrubber over game/cutscene
    story/             story / missions / activities authoring (may split into
                       three routes as the systems grow; starts as one)
    settings/          the grand settings page (/settings): the session event
                       bus viewer (read-only fold over the sessions stream) +
                       the P2 tunables surface over editors/tunables.ts — every
                       exposed value, edit → compile and go (LANDED 2026-06-05;
                       this is the planned tuning/ slot, named by the ruling)
    console/           the command console (game/commands surface) — run, record,
                       and SAVE command sequences as replayable test scripts (V19)

  labs/                short scaffolded files — the experiment slots (V13/V17/P5)
    _scaffold.tsx      the template `rjit lab new <name>` copies
    <name>.tsx         a lab: GAME_* imports + an exported scene. Nothing else.
    <name>.notes.md    per-lab notes — read by humans, AI, and the oracle (P6)

  compile/             V15: data/ + game/ → the emitted hmsc game (the bake)
    verify/            V19: LLM-callable — compile → boot headless → run the
                       P4 behavior tests → exit with a verdict. Run constantly.

  data/                what P2 edits, what compile/ consumes. Never logic. (V20)
    streams/           per-concern APPEND-ONLY logs: world/, characters/,
                       vehicles/, items/, tuning/, cutscenes/, story/, missions/,
                       activities/ — a state update writes to ITS stream; new
                       feature = NEW stream, old streams stay valid forever. One
                       total cross-session undo chain; an undo point is a log
                       position. Disk is cheap. NOT git-tracked (gitignored;
                       git is the code time machine, streams are the content
                       time machine) — with an explicit backup/export story.
    snapshots/         materialized views of the streams — THIS is what the
                       game/compile loads, never the history itself. RULE: the
                       snapshot system GROWS with every added stream — adding
                       tracking without snapshot support is an incomplete change.

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
game/     → framework bindings + runtime/ + data/.   (never imports editors, labs, shell)
compile/  → game/ + data/.
shell/    → nothing game-specific.
data/     → imports nothing (it's data). Imported by game/, editors/, compile/ —
            labs never touch data/ directly; it reaches them through game/'s door.
```

- `@game` becomes a bundler alias for `cart/hmsc-int/game` — labs and editors
  write `import { GAME_CAMERA } from '@game'` (V17), and that import is ALSO the
  metafile-gate signal that compiles the game's host bindings in (V18).
- `game/index.ts` is the only public door (P3 deep interfaces). Editors may
  reach into `game/figure/` internals because they author it; labs may not.
- Every behavior-affecting number in `game/` resolves from `data/tuning/` (P2).
  A literal constant in `game/` logic is a bug.

## The lab lifecycle: capture → rewrite → archive. No second meaning of "lab".

To be abundantly clear (and why this document references no existing files):
ALL existing labs will be REWRITTEN as the new lab approach. The sequence:

1. **Capture** — each system is extracted from the current approach into
   `game/` (the extraction map below). The old cart is a SOURCE to capture
   from, never a thing to migrate in place.
2. **Rewrite** — after the ENTIRE declared corpus is captured, the labs are
   rewritten as new drop-ins (`labs/<name>.tsx` on `@game`, with notes).
3. **Archive** — the old cart is locked up and away (the `archive/` treatment:
   read-only, frozen, reference-only — same as `tsz/`/`love2d/`).

After this, "make a lab" is ONE COHERENT IDEA. There is never an old approach
and a new approach — there is the lab shape, and there is the archive. An
agent that finds itself extending an old lab cart instead of capturing it has
gone wrong.

**The capture is a TRIAGE, not a 1:1 lab→lab mapping.** Some "labs" were never
labs — they are dev tooling wearing a lab name. head_lab is both an idea AND
the place characters get built: the kit captures into `game/figure/`, the
authoring interface is REMADE as `editors/characters/` (a tooling route inside
the tool, not ad-hoc external tooling beside it), and only the test-scene idea
becomes a `labs/` drop-in. Every old cart resolves into some combination of:

  - a SYSTEM        → `game/`           (logic everything consumes)
  - an EDITOR       → `editors/`        (an authoring route IN the tool)
  - a LAB           → `labs/<name>.tsx` (the experiment, reborn on @game)
  - nothing kept    → archive only

vehicle_lab and game_item_gallery triage the same way (system + editor + lab).
combat_lab/pathing_lab are mostly system + lab. There is no category of
"external tool that points at the tool" — if it authors game content, it is an
editors/ route.

**And triage still means REWRITING the files — never moving them.** The
existing files are sparse, spread-out logic; they do not get copied or
relocated into this structure. Capture = write the system fresh in its new
home to the constitution's bar (P2 no buried constants, P3 deep interfaces,
P4 tests), using the old file only as the behavior reference — the same
relationship V1 gives the Verlet solver. A `git mv` into `game/` or `editors/`
is the capture done wrong.

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
| hmsc world/grid + surfaceHeights + landform instances + spawn/trigger drive-steps + hostPhysics' world-derivation half (V4: the tile system IS the system) | game/world/ (the substrate; collider data feeds game/physics.ts) |
| hmsc-int existing paint/preview            | editors/world/                            |
| hmsc-int ShaderLab/TextureStudio/materials | editors/materials/                        |
| combat_lab / pathing_lab / ragdoll_lab / planet_run scenes | labs/<name>.tsx (rebuilt on @game, with notes) |
| lab Chip/Knob/panel + skybox/lights re-rolls | game/chrome/                            |
| hmsc commands/registry.ts (console commands)| game/commands/ + editors/console/ — and doubles as the V19 test scripting surface |

What does NOT move: `runtime/` and `framework/` stay platform (the registry,
primitives, workspace, geometries — game/ consumes them). The Effect/StaticSurface
texture system (V14) stays platform-side in `runtime/`; game/ consumes it with
the bake-once discipline — it gets no `game/` home.

**`cart/hmsc` is an EXTRACTION SURFACE (ruled).** Everything goes into one
thing: hmsc-int. The playable hmsc is a capture source exactly like the labs —
feature development on it stops; new game work happens in hmsc-int's structure;
hmsc ends as compile/'s OUTPUT (V15), not a hand-written cart.

## Build order (Milestone 0, restated against this shape)

1. `game/index.ts` + the thin GAME_* wrappers (no host rebuild — they call the
   existing `__hmsc_*`/`__path_*` names until the honest bindings land)
2. **`compile/` + `compile/verify/` skeleton FIRST-CLASS and EARLY (V19)** —
   even while the compiled game is nearly empty. The green light exists from
   day one and never goes dark; every later step lands under it. LLM-callable:
   `rjit game compile && rjit game verify`.
3. `labs/_scaffold.tsx` + `rjit lab new <name>` + the labs route in shell
4. `data/streams/` + `data/snapshots/` persistence layer (V20) — the workspace
   pattern extended to per-concern append-only streams; editors write to it
   from their first version, never retrofitted.
5. `framework/game/` + gated `v8_bindings_game_*` (parallel worker; wrappers
   re-point when it lands)
6. First lab rebuilt on the shape (proves the contract end to end — the
   explicit contract-proof exception to V17-LIFECYCLE's after-the-ENTIRE-corpus
   rule; the rest of the corpus still waits for full capture)
