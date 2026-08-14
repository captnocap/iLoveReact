# Round 1 verification

## Map diff after Passes 1-3

Only Section D changed:

| State | Baseline | Re-derived after pass |
|---|---|---|
| Material / Lab, Library, legacy material | world Build + snap/floor/walls | empty fixed-height action bar |
| Playtest document | world Build + snap/floor/walls | empty fixed-height action bar |
| Animation capture | world Build + snap/floor/walls | empty fixed-height action bar |
| World states | world controls | unchanged |
| Model states | mesh controls | unchanged |
| Facade / Knowledge | empty | unchanged |

The Model row also changed:

| State | Baseline | Re-derived after pass |
|---|---|---|
| Model, any ordinary mode | complete 23-tool vocabulary rendered permanently | 11 foundational/state-critical commands rendered permanently |
| Model context menu | complete grouped/direct tool reachability | unchanged |
| Model selection context | topology commands appear when applicable | unchanged |
| Model Face mode | bespoke Band/tint/erase/ghost/clear cluster appended after commands | cluster absent |

The string inventory has no diff: Pass 1 was presentation routing only and
changed no user-facing copy. The registry map changes one row: Section D now
consumes the explicit `actionBarSurface` boundary.

## Automated checks

- `commands.test.ts`: 31 passed, 0 failed, including the exact 11-command
  permanent projection and full context-menu parity.
- `surfaces.test.ts`: 3 passed, 0 failed, including all seven document kinds.
- `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`: passed in ReleaseFast;
  packaging intentionally skipped.

## Visual check delegated to the user

Open Material Lab, Globals → Physics (Playtest), and Globals → Animation. In
each, Section D should remain the same height but contain no Build/snap/floor/
walls controls. Then open a Model: its permanent strip should contain View,
Vertex, Edge, Face; Move, Scale, Rotate; Mirror X/Y/Z; and Paint—no Additive,
Pen/Curve, viewport diagnostic, or camera-bookmark buttons. Right-click the
model to confirm those occasional commands remain reachable in their grouped or
direct context rows.

## Round 3 verification — Material Library performance

The co-visibility map and string inventory are unchanged: this pass changes
the render lifecycle inside the existing Material / Library center-stage cell
and the sampling geometry inside the existing Material / Lab stage.

Source diff confirms:

- no pixel scroll position is stored in React state;
- `defaultShaderData` runs inside the memoized catalog constructor, not the
  scroll render path;
- one six-row batch window replaces three-row overscan churn;
- shader-window changes wait for wheel input to settle;
- every hydrated standard batch is enclosed by a stable-key `StaticSurface`;
- no Effect mounts until ScrollView reports real dimensions;
- 1× stage data bypasses the square-grid envelope.

Automated checks: Material Lab presentation 6/6, ShaderGridBatch 6/6,
`git diff --check`, and ReleaseFast editor ship all pass. The user's running
editor remains authoritative for FPS, cold-open latency, and visual fidelity.

## Round 8 verification — Animation workspace

The re-derived co-visibility map has three intentional owners: Capture in the
left gutter, target preview plus timeline in center, and Generate in the right
gutter. Assets remains reachable as a secondary left rail pane. All generation,
capture, document, save, recording, key editing and provenance capabilities
remain reachable.

Automated checks:

- panel system: 13 passed, 0 failed, including contextual animation gutters and hot-state normalization;
- prompt motion: 3 passed, 0 failed, including complete re-roll provenance;
- `git diff --check`: passed;
- ReleaseFast editor ship: passed with packaging intentionally skipped.

Visual and frame-time checks are delegated to the user per repository policy:
open Globals → Animation, generate a motion, exercise Play/Pause/Resume/Stop
and timeline scrubbing, then keep spikewatch armed through 60 seconds of
representative playback.

## Round 9 verification — boot is clean

State zero is now decided rather than inherited. A cold start opens the Home
document: Continue (the durable session record), the real map documents with
their names and last-modified stamps, and New. Nothing else on the boot frame
names an entity, because nothing has been selected yet — `armedPieceId`,
`activeAssetId` and `selectedObjectId` all boot null, `selectedObject()` and
`assetByIdOrNull()` return null rather than substituting, and every focus
surface renders the one shared `FocusEmpty` component.

No capability was removed. The world tab still loads its map behind Home and is
one click away; the Asset Explorer still opens on `materials-core`; Paint Faces,
slot binding and Color Studio all still work the moment a material is picked,
and they now say what is missing when one is not.

Automated checks:

- boot is clean: 25 passed, 0 failed (`cart/editor/bootIsClean.test.ts`);
- panel system: 13 passed, 0 failed;
- commands: 31 passed, 0 failed; application commands: 24 passed, 0 failed;
- library search: 5 passed; map documents: 9 passed; persistence lifecycle: 3 passed;
- `zig ast-check` on `framework/primitive/text.zig` and `framework/engine.zig`;
- editor cart bundle: clean.

Pre-existing and untouched: `editorEvents` `piece.place` slot-key expectation
fails identically with this round's changes stashed.

Self-captured frames (the app reads back its OWN swapchain; nothing touches the
desktop):

- `SHIP_RUN_PACKAGE=0 ./tools/rjit shot editor --out <path> --frames 200` —
  the Home boot frame: Continue with the real session, RECENT MAPS with real
  names and stamps, New, the rotating quote and joke, the launch number.
- `RJIT_BOOT_DOC=world ZIGOS_WINDOW_W=1536 ZIGOS_WINDOW_H=940 ZIGOS_HEADLESS=1
  ZIGOS_SCREENSHOT=1 ZIGOS_SCREENSHOT_OUTPUT=<path> ZIGOS_SCREENSHOT_FRAMES=260
  ./zig-out/bin/editor` — the world surface's own cold state at the cart's
  default window size. `RJIT_BOOT_DOC` is a repro door in the same family as
  `RJIT_MODELDOC`/`RJIT_EDKEYS`: it changes which tab is in front, never what
  exists, so a headless run can verify surfaces past Home.

Those frames confirmed, at 1536x940 with zero input: the focus panel reads
"Piece focus — Nothing selected"; the asset drawer card reads "Material —
Nothing selected"; the VIEWS row reads "none yet — pin one above" complete; the
action bar fits; the status bar's POS shows dashes rather than zeros. The first
cold start also found and fixed a crash this pass introduced — `home` was the
first document kind with an empty left rail, and `resolvedPanelId`'s
`buttons[0]!` had no element to take.

Overflow behaviour is now two cooperating halves. Paint elides a no-wrap label
at its box; hovering the row it lives in reveals the full text, and ONLY when
the label actually did not fit — a value that fits produces no tooltip, so this
adds no chrome to panels that were already readable.

The rest is delegated to the user per repository policy: cold-start the editor
and walk the BOOT IS CLEAN watchlist in LEDGER.md Round 9.
