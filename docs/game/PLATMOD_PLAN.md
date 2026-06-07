# PLATMOD_PLAN.md — platform/mod work breakdown (PLATMOD-PLAN-0607)

**Status: PLAN — open questions RULED by the user 2026-06-07 (§6,
req_0254/req_0255); awaiting the supervisor's go for slice 1.** Drafted
2026-06-07 from supervisor dispatch req_0245/req_0246. The ruling set is V28
(platform/mod split), V29 (map format), V30 (changelevel + frozen world) in
`docs/game/DECISIONS.md` — nothing in this plan adds to or contradicts them.
Plan only — no implementation has happened.

The user's word this plan executes, verbatim:

> "first establishing the game engine binary that can load our map format we
> look then compile out from here. since we have it all inside of this app,
> and we are also using this app to build the same engine, that gives us the
> proper seperation of conerns where we can immediately test engine changes
> in the test route and then finalize them into the built game engine"

Reading: build order is (1) the standalone player binary — the user's "game
engine binary" — that can LOAD a map package, then (2) Compile grows the
"compile out from here" side that EMITS those packages from hmsc-int. The
separation of concerns is structural, not aspirational: hmsc-int is itself an
app on the same platform tier the player binary is built from, so a platform
change is exercised live in hmsc-int's `/test` route first and only then
finalized into a freshly built player binary. One source tree, two binaries —
promotion is a build, never a port.

---

## 1. SLICE 1 — the player binary that loads a game package

### 1a. What already exists — BONES, not the goal (V28: "the dev host already IS that client")

**To be unmistakable (user asked, 2026-06-07): nothing can load a map file or
game package today. None of the V29 machinery exists** — no lump container,
no binary RLE, no package shape, no content store, no player boot path. The
only world "loading" that exists is the localstore boot-key handoff, which is
exactly the testing-environment channel, not the goal. This table is the
PARTS BIN — raw host capabilities the new system is built into so we don't
write a second host — not a claim that any of the goal works:

| Capability | Where it lives today |
|---|---|
| Persistent V8 host binary (ReleaseFast, tabs, hot-swap) | `cli/commands/dev.ts` → framework host |
| Runtime cart loading into a RUNNING host | `cli/commands/push-bundle.ts` over `/tmp/reactjit.sock` |
| Cart bundling (TSX → bundle.js, source-driven deps) | `cli/cart/bundle.ts` |
| Cart manifest (name/surface/icon/chrome) | `cli/cart/manifest.ts` (`cart.json`) |
| Fused standalone binary (bundle via `@embedFile`) | `cli/commands/ship.ts` (`rjit ship`) |
| Headless game boot + verify verdict | `cli/commands/game.ts` + `cart/hmsc-int/compile/main.ts` |
| Editor→game world channel ("compile = persist") | `cart/hmsc-int/editorWorld.ts:50` → localstore `'hmsc'/'game-state'` → `cart/hmsc/state/gameState.ts` `readStoredGameState()` |
| Grid source codec (JSON row-RLE, the ".vmf") | `runtime/workspace/rle.ts` |
| Thin-reference map snapshots (tileLegend remap) | `cart/hmsc-int/mapStore.ts` |
| Self-capture verification | `tools/rjit shot` (SELFSHOT-0606) |

The host can already be HANDED a bundle at runtime. What it cannot do is be
handed a **game**: there is no on-disk package shape, no installer for a
package's assets, no boot path that says "run this package" instead of "watch
this cart" — and the world the game boots from is a localstore key, not a
mapfile. That is the whole gap, per V28: "only the packaging shape is missing."

### 1b. The game package (the V28 definition, given a file shape)

V28 rules a game is `bundle.js + mapfiles + assets + manifest`. Slice 1 gives
that a directory/archive layout (proposal — exact naming needs the user's
taste, content is ruled):

```
<game>.rjpkg/                  (directory first; single-file archive later)
  manifest.json                game id, version, entry map, min platform version
  bundle.js                    the mod's compiled script (the cart bundle as-is)
  maps/<name>.map              V29 lump-container mapfiles (city + interiors)
  assets/<hash>                content-addressed installable assets (V29)
```

- `manifest.json` extends the existing `cart.json` reader
  (`cli/cart/manifest.ts`) — same loader, new fields. No second manifest
  system.
- `assets/` entries are keyed by payload hash (V29 content addressing);
  install into the player's content store is idempotent, shared across maps
  and across games.
- `maps/*.map` is the V29 BSP-style lump container (§2). In slice 1 the lump
  roster is minimal (§5); the container's unknown-lumps-skipped law is what
  lets the roster grow without re-cutting slice 1.

### 1c. The player binary

Not a new host. The player binary is the SAME framework host the dev host is,
with a package boot path instead of the dev affordances:

- **Boot:** `<player-binary> <path-to-package>` (and a `rjit play <pkg>`
  convenience) — read manifest, validate platform version, install/validate
  assets into the content store, load the entry map's lumps, eval
  `bundle.js`, hand the mod its entity keyvalues (opaque to the platform, per
  V28). No file watcher, no `/tmp/reactjit.sock` push listener, no tab strip
  — those are dev-host trims, build-gated the same way `has-X` flags already
  gate native deps (no unconditional imports).
- **Distribution option preserved (V15-as-amended):** `rjit ship` keeps
  working by baking a package INTO the fused binary via `@embedFile` — ship
  becomes "player binary + embedded package," not a separate code path.
- **Second-mod test applied:** nothing in the player binary may import from
  `cart/hmsc*`. The binary knows packages, lumps, the content store, and
  "eval the bundle"; what a 'paramedic' is stays inside the package's
  bundle.js. The day this line is crossed, slice 1 has failed V28.

### 1d. Deliberately NOT in slice 1

- VIS lump computation (V30) — the loader SKIPS unknown lumps; VIS slots in
  when the activation predicate work needs it.
- Apriori pattern mining — ruled IN from format v1 (V29), but it is a Compile
  (writer-side) concern; see build order §2. The slice-1 loader must already
  understand PATTERN-DICT stamps + residual, OR the format is not yet called
  v1 — the honest line: slice 1 reads format v0 (no mining), v1 (with mining)
  lands inside slice 2 before the format is declared stable.
- changelevel / interior maps (V30) — slice 1 loads ONE map. The manifest's
  `maps/` plural and the entry-map field are the only forward provisions.
- Multi-game library UI, updates, distribution — not asked, not planned.

---

## 2. Build order — lump container, Compile transcode, loader

Ordered so every step has a green light before the next starts (V19/P6).
Tier ownership marked per V28: [P] platform (`framework/` + `runtime/`),
[E] editor (hmsc-int), [M] mod (hmsc).

1. **[P] The lump container codec, TS writer side.**
   `runtime/workspace/lumps.ts` (sibling of `rle.ts`): magic, format version,
   lump directory (type, encoding `raw|rle8|rle16|text`, offset, length),
   8/16-byte alignment, unknown-types-skipped reader. Writes via `DataView`
   (V29). P4 suite: write → read → byte-identical round-trip, plus a
   future-lump tolerance test (reader v0 skips a lump type it doesn't know).
2. **[P] The binary row-RLE transcode.**
   Same module family: `rle.ts` JSON rows (the source format — stays) ⇄
   binary `(count,value)` pairs for `rle8/rle16` lumps; heightfields
   u16-quantize + scale/offset then RLE (V29). P4: transcode round-trips
   against `encodeGrid`/`decodeGrid` on real editor chunks.
3. **[E] Compile emits a mapfile.**
   The editor's Compile action (`editorWorld.ts compileEditorWorld`) KEEPS
   writing the boot key (nothing breaks) and ADDITIONALLY emits
   `maps/<map>.map` with the slice-1 lump roster: STRINGS, TILES, HEIGHTS,
   ZONES, PLACEMENTS, ENTITIES (text keyvalues — the GameState's
   buildings/props/markers flattened to opaque keyvalues the mod re-binds).
   Bake-by-EXECUTION per V29: the compile runs the authoring code in V8 and
   snapshots output — `cli/commands/bake-geometry-auto.ts`'s literal-scanner
   direction stays retired.
4. **[P] The loader, Zig packed reader.**
   `framework/world/` gains the lump reader (no parser — pointer-cast the
   directory, decode RLE lumps straight into grids; MESHES later are raw
   aligned f32). JS-side binding hands the mod its ENTITIES text and the
   platform its grids. P4 both sides: Zig test on a fixture mapfile, TS test
   that writer output loads.
5. **[P+E] Round-trip proof.** A verify script (`compile/verify/*.cmds`
   lane) boots the headless game FROM THE MAPFILE instead of the boot key
   and asserts the same world status line — this is the first-artifact
   done-bar (§5).
6. **[P] The content store + content addressing.** Asset payloads hashed,
   installed idempotently; the mapfile's reference list doubles as the
   dependency manifest, validated before load (V29). MESHES/MATERIALS lumps
   land here, fed by executing the shape-authoring code.
7. **[E] Apriori pattern mining in Compile.** Frequent k×k window mining →
   PATTERN-DICT (itself a content-addressed installable asset) → grid as
   stamps + RLE residual (V29, ruled in from v1). Loader grows stamp
   expansion. After this lands the format is declared **v1**.
8. **[P+E] VIS lump** (V30) — Compile precomputes chunk-to-chunk potential
   visibility; one oracle for culling, perception, audio. Scheduled with the
   frozen-world/activation work, not before.
9. **[E] PAK lump** — map-local embedded assets (the exception; referencing
   is the default). Lands when a map first actually needs map-local content.

Steps 1–5 are slice 1's spine. 6–7 complete V29; 8–9 ride later slices.

---

## 3. The dev loop and the promotion mechanic

The user's separation of concerns, made mechanical:

- **Bleeding edge = this app.** A platform change (runtime/ TS) hot-reloads
  into the RUNNING hmsc-int in ~300ms and is exercised immediately in the
  `/test` route (`editors/play/PlayRoute.tsx` — the embodied TEST/BUILD
  surface) and the lab corpus. A framework/ Zig change needs the dev-host
  rebuild (hot reload does not cover Zig — known boundary), but still lands
  in THIS app first.
- **Proof before promotion.** The existing green light is the gate:
  `rjit game verify` (compile headless → replay every verify script → run
  every behavior suite in `cli/commands/game.ts SUITE_ROOTS`) plus the P6
  graduation protocol — promote → re-run the whole lab corpus → every
  behavior change becomes an explicit decision.
- **Promotion = cutting a player binary.** Because the player binary and the
  dev host are one source tree (§1c), "finalize into the built game engine"
  is exactly: commit the proven change → build the player binary → re-run
  the package round-trip verify against it. No port step exists for drift
  to hide in. The package manifest's min-platform-version plus the mapfile's
  format version (unknown lumps skipped) are what let already-cut packages
  keep loading on a newer player.

**RULED (user, 2026-06-07, req_0254/req_0255): the discipline did not exist —
establish it on the Smith BLESS principle, implemented in the TS CLI (`cli/`),
never as shell scripts.** The principle, lifted from the frozen reference
(`tsz/scripts/bless-compiler` — principle only, the bash stays dead):

- **Two states: bleeding and blessed.** Bleeding = the live dev host +
  `/test` route, always. Blessed = the last player binary PROMOTED on the
  user's word. (No "nightly" tier — nothing earned it; add only if pain
  demands.)
- **`rjit player bless` — a `cli/commands/` TS command** (rebundled into
  `tools/rjit.js` like every CLI change): builds the player binary fresh
  from current source (refuses if the build fails), runs the promotion gate
  — `rjit game verify` green + the P6 lab-corpus re-run — then copies the
  binary to the blessed path and writes a stamp: commit sha, date, binary
  sha256, source hash. `--status` shows what's blessed; `--diff` shows
  platform-source changes since the bless stamp's commit.
- **Blessing is HUMAN-ONLY — Smith's rule, kept verbatim.** Claude never
  blesses; the command runs on the user's word (relayed by the supervisor),
  matching P5's "the ground floor only ever grows by verdict" and the
  floor's supervisor-ordered-commit law.
- **Packages pin against the blessed channel:** a package's
  min-platform-version means "the blessed player at or after this stamp";
  the bleeding host may always load it (that is the dev loop).

---

## 4. Sequencing against the in-flight workbench fold

State of the fold (`cart/hmsc-int/WORKBENCH.md §6`): steps 1–9b done/built
(step 4 `/characters` flip and step 9 `/settings`+`/log` flip await the
user's word); **step 10 = chrome collapse to 6 icons + delete
`cart/hmsc-wire/`** is the remaining move.

- **Does NOT block on step 10 (i.e., can start now):** the entire slice-1
  spine. Build-order steps 1–6 touch `runtime/workspace/`, `framework/world/`,
  `cli/`, `compile/`, `editorWorld.ts`, `mapStore.ts` — none of which are
  workbench route surfaces. The Compile action the transcode extends already
  exists outside the workbench fold.
- **DOES wait for step 10:** any new chrome verb or nav surface (e.g. a
  "package/export" button or a package-status strip). Adding chrome while
  the collapse is in flight churns the exact files step 10 deletes. Slice 1
  doesn't need new chrome — Compile's existing door is enough — so this
  costs nothing.
- **Watch the seam, not the steps:** WORKBENCH.md §7's open question 3
  (map-editor ⇄ workbench convergence) is the only place the fold and this
  plan share ground. Slice 1 changes what Compile EMITS, not the editing
  UI, so it stays clear; whoever lands the convergence later inherits a
  Compile that emits mapfiles, which is fine.
- **Pending flips (4, 9) are fully orthogonal** — character/settings/log
  sources share no files with the map format work.

---

## 5. The FIRST testable artifact and its done-bar

**The artifact:** one map, authored in hmsc-int, leaves the app as a binary
mapfile inside a game package, and a separately built player binary boots it.

Concretely: paint/place a small world in hmsc-int → Compile emits
`hmsc.rjpkg/` (manifest + bundle.js + one `.map` with STRINGS / TILES /
HEIGHTS / ZONES / PLACEMENTS / ENTITIES) → `<player-binary> hmsc.rjpkg`
boots into that world.

**Done-bar (all four, none waived):**

1. **Round-trip equality.** A verify script boots the headless game from the
   mapfile and from the boot key and asserts the same world facts (status
   counts, building/prop/zone ids, heightfield samples). `rjit game verify`
   GREEN with the new script in the corpus.
2. **P4 codec suites.** Lump container round-trip + binary-RLE transcode +
   future-lump skip tolerance, TS and Zig sides both.
3. **Self-shot proof.** `tools/rjit shot` of the player binary booted on the
   package, PNG path cited in the report (SELFSHOT-0606 — no desktop
   capture).
4. **Second-mod test holds.** `grep` proof: no `cart/hmsc` import anywhere
   in the player boot path; ENTITIES decode lands in the mod's bundle, not
   the platform.

Not in the bar (explicitly): mining (v1, §2.7), VIS, changelevel, asset
content store beyond what the one map needs. A first artifact that tries to
prove V29 entire will not exist this week; one that proves the
container/transcode/loader spine plus the package boot proves the user's
"engine binary that can load our map format" verbatim.

---

## 6. Open questions — RULED (user, 2026-06-07)

All four were RULED by the user on 2026-06-07 (req_0254, req_0255):

1. **Channel discipline — RULED:** "none of it exists so establish it, you
   can take the same principle from the smith compiler and its bless
   system" — and (req_0255) implemented in the TS CLI we have, not shell
   scripts like tsz did. Established in §3: bleeding/blessed, `rjit player
   bless` as a `cli/commands/` TS command, human-only promotion.
2. **Package naming/shape — RULED:** "looks fine, doesnt really matter to
   me much, just something coherent." `.rjpkg` + `rjit pack` / `rjit play`
   stand as drafted; coherence is the only bar.
3. **Content store location — RULED:** "do whatever is the most performant
   and doesnt corrupt." So: NOT the shared localstore — its own
   content-addressed directory in the player's data dir, written
   atomically (write to temp, fsync, rename — never a partial file under
   its final hash name), where the hash IS the corruption check: verify on
   install, re-fetch/re-install on mismatch. Reads are plain mmap'd files,
   the most performant shape there is.
4. **Boot-key retirement — clarified** (the user asked whether this was a
   question or a statement: it was a real question — "when does Compile
   stop ALSO writing the old localstore testing channel?"). Answer now
   pinned so it needs no further ruling: Compile dual-writes until the §5
   done-bar passes (mapfile boot proven equal to boot-key boot); after
   that the supervisor schedules the retirement commit like any other flip
   — on the user's word, same as every route flip in WORKBENCH.md §6.
