# World Authoring Plan — shared read-model, zones, layer-aware painter

Status: PLAN (approved to start; build order set). Supersedes the old
"chunk painter" framing — that's now Phase 3.

## The reframe (why this isn't just a tile painter)
The world is **layers**, not tiles: `surfaceRegions`, `placedCells`, `roads`,
`junctions`, `props`, `buildings`, `mountains`, `interiors` (and soon `zones`).
The three things asked for — map sync, zones, a chunk painter — are ONE problem:
a multi-layer world model with **one authoring language** (the `wv_*` command
DSL), **one read-model** (resolver + markers + tree), and **one set of
consumers** (minimap + internal map + the game). Build that, and the maps stop
lying and zones come nearly free.

Build order (user-set rationale: see it → name it → author it):
1. **Map sync + landmarks** — so we actually know what's there.
2. **Zones** — GTA name-on-enter + private property, so areas are meaningful.
3. **Layer-aware painter** — paint tiles AND zones, export as commands; now at
   its best because it paints into a world it can fully see.

## Core abstractions (shared by all phases)

### Placeable registry — `world/placeables.ts` (new)
The single list the palette, the world tree, and the maps all iterate. Adding a
world thing = adding one entry, never editing a switch. (Same lesson as the
scape3d *thingymajigger* "one category" registry and `@reactjit/geometries`.)
```ts
type WorldLayer = 'tile' | 'zone' | 'building' | 'road' | 'prop' | 'mountain';
type Placeable = {
  id: string;            // 'tile:sand', 'zone', 'building:house'
  layer: WorldLayer;
  label: string;
  swatchColor: string;   // ONE source for palette + map color (kills the 3 dup tables)
  emit(sel): string[];   // command line(s) to create this over a rect/cell
};
export const PLACEABLES: Placeable[];
```

### Shared read-model — `world/worldView.ts` (new)
The single authority for "what is where," so the maps can't drift from the game.
- `tileKindAtCell(state, cell)` — add to `grid.ts`; the existing
  `tileKindAtWorldPosition` delegates to it (placed > junction > road > mountain
  trail > surface). Maps call this instead of rolling their own resolver.
- `worldMarkers(state): WorldMarker[]` — landmarks the maps draw OVER the raster:
  buildings (footprint + icon + label), zone outlines + names, mountain, key
  props. `WorldMarker = { layer, x, z, width, depth, label, swatchColor, icon? }`.

### World tree — `world/worldTree.ts` (new)
`buildWorldTree(state, painted?)` iterating **per-layer summarizers** (one per
layer), so the master list covers the whole world, not just tiles. Honest model:
a chunk = ONE base kind (its `surfaceRegion`) + sparse overrides stacked on top —
NOT a flat per-cell array. Rolls up to per-kind world totals.
```ts
type WorldTree = {
  layoutKey: string; widthCells: number; depthCells: number;
  worldTotals: Partial<Record<string, number>>;   // every layer:kind summed
  chunks: ChunkSummary[];
};
type ChunkSummary = {
  id: string; label: string;
  bounds: { x: number; z: number; width: number; depth: number };
  baseKind: TileKind; baseCount: number;
  overrides: Partial<Record<TileKind, { count: number; cells: {x:number;z:number}[] }>>;
  zones: { id: string; name: string }[];          // zones intersecting this chunk
  buildings: { id: string; kind: string }[];      // landmarks in this chunk
};
```
Collapsible tree in the inspector (world → chunk → layer → cells), with live
preview of staged paint edits when the painter is armed.

---

## Phase 1 — Map sync + landmarks
**Problem (verified):** three parallel resolvers, none consult buildings, none
use the game's canonical layering:
- MiniMap (`render/Hud.tsx`): `placedCell ?? surfaceRegion` only; hardcoded
  `minimapTileCode` switch. Blind to roads/junctions/buildings/mountain.
- Internal map (`hmsc-int`): draws `surfaceRegions` only. Blind to everything else.
- 3D world: draws all layers (the truth).

**Fix:**
- Build `worldView.ts` (`tileKindAtCell` + `worldMarkers`).
- MiniMap: its CPU-side `cells.map(...)` calls `tileKindAtCell` (now layer-correct);
  add a TSX overlay drawing `worldMarkers` (building footprints/icons, labels).
- Internal map: shader raster stays, but resolve via the shared model; add a TSX
  marker/label overlay over the `<Effect>` for buildings + (later) zones.
- Converge kind→color on `Placeable.swatchColor` / `tileKinds.render.color` —
  delete `minimapTileCode`'s duplicate table.
- **NPC pathing is a THIRD consumer of the same resolver** (not just the two
  maps). `pathing.ts:movementCostForCell` currently resolves kind via
  `placedCellAt(state, cell)` ONLY (line ~24: `if (!placedCell) return Infinity`),
  so A* ignores `surfaceRegions`/roads — NPCs literally can't path across the
  sidewalk/road chunks today. Repoint it at `tileKindAtCell` so the cost field
  covers the whole world. The tile-cost layer (`TileNpcProfile`
  walk/run/vehicle costs) already encodes "prefer sidewalk, avoid road-center" —
  no painting needed for baseline preference; painting is reserved for what costs
  can't express (see Forward slice → NPC flow).

  **SLICE-IN (do at this phase):** `world/pathing.ts` → `movementCostForCell`,
  swap `placedCellAt(state, cell)` for `tileKindAtCell(state, cell)`; keep the
  `walkable`/`traversable`/`allowedModes`/cost logic unchanged. Leave a
  `// resolves through worldView.tileKindAtCell — see WORLD_AUTHORING_PLAN Phase 1`
  comment at the call site.

**Files:** `world/grid.ts` (+`tileKindAtCell`), `world/worldView.ts` (new),
`world/placeables.ts` (new, tiles + buildings first), `render/Hud.tsx`,
`hmsc-int/index.tsx`, `world/pathing.ts` (repoint `movementCostForCell`).

**Accept:** a building placed in the world appears on BOTH maps at the same spot
as the 3D world; one color table; an NPC paths across a surfaceRegion sidewalk
chunk with no placedCells under it.

---

## Phase 2 — Zones (GTA name-on-enter + private property)
**What exists:** per-CELL triggers (`placedCell.triggerCommand` → fired in
`usePlayerDrive.ts:runEnteredCellTrigger` → `runCommandLine`, debounced). The
mechanism is right; the unit (per-cell) is wrong. `zoneKey` exists but nothing
consumes it.

**Add a first-class Zone layer (peer of surfaceRegions):**
- `design.ts`: `WorldState.zones: Zone[]`;
  `Zone = { id, name, x, z, width, depth, y?, flags: ZoneFlag[], onEnterCommand?, onExitCommand? }`;
  `ZoneFlag = 'private' | 'safe' | 'hostile' | 'interior' | ...`.
- `world/zones.ts` (new): `addZone`, `zoneAtCell`, `zonesAtWorldPosition`,
  `currentZone` (innermost wins).
- `commands/registry.ts`: `wv_zone <name> <x> <z> <w> <d> [flags...]`,
  `wv_zone remove <id>`, bare-list.
- `usePlayerDrive.ts`: track current zone by ref (like `lastTriggerKeyRef`); on
  boundary cross emit `zone.entered`/`zone.exited`, run `onEnter/onExitCommand`.
  Default `onEnter` = name-flash.
- HUD `ZoneNameFlash` (new): `busOn('hmsc:event:zone.entered', cb)` in a
  useEffect → GTA-style name appears + fades. Channel format is
  `hmsc:event:<type>` (see `events/gameEvents.ts` — every event also fans out to
  `hmsc:event`, `hmsc:tag:<tag>`, actor/subject channels). Same pattern the
  `__keydown` subscribers already use.
- **Private property** = the `'private'` flag; emitted on the event for
  perception/wanted/NPC systems to read later (flag + event land now; full
  consumption is downstream).
- Maps + tree: zones flow through `worldMarkers` (outline + name) and a tree
  branch automatically — they're just another layer.

**Accept:** walk into a `wv_zone`'d area → its name flashes once; `zone.entered`
carries the `private` flag; the zone shows on both maps.

---

## Phase 3 — Layer-aware chunk painter
Now the original idea #2, but paints any Placeable layer and sees the synced
world + zones.

**Painter in `hmsc-int/index.tsx`** (paint loop ported from
`cart/pixel_icon_demo.tsx`, keyed by `cellKey`):
- Palette = the `PLACEABLES` registry (pick tile kind, or `zone`, …), not a
  hardcoded TileKind list.
- `painted: Map<cellKey, placeableId>`; brush (radius) + wand (flood-fill same
  id — port `floodFillColor`, comparing ids); shader overlay via extra regions.
- **Export** (`emitChunkCommands`) RLE-collapses per layer:
  - tiles: base `wv_fill <kind> x z w d` + run/singleton `wv_fill`/`wv_place`.
  - zones: each painted zone rect → `wv_zone <name> x z w d [flags]`.
  - Read-only `TextArea` + Copy button (`globalThis.__clipboard_set`, confirmed
    available).

**`wv_fill` command** (the one missing tile verb) + `addSurfaceRegion(state,region)`
in `grid.ts` (immutable push, id/zoneKey auto-derived). Maps 1:1 to a chunk's
`surfaceRegion`. Independently useful for hand-authoring districts.

### Mode safety (intentional toggle, no accidental commit)
- Opens in **Inspect**. Painting needs an explicit `PAINT: OFF → ON` switch
  (`paintArmed`, default false); armed = a colored border frames the map + the
  swatch row appears. When off, the paint branch in drag handlers is fully
  bypassed.
- Paint is a **staging buffer** — `painted` never mutates live world layers; the
  only output is copied command text.

### Draft persistence + versioned backups (restore to any point)
Storage: `localStoreGet`/`localStoreSet` in `gameState.ts` are PRIVATE
(module-local) — they wrap `globalThis.__localstoreGet('hmsc', key)` /
`__localstoreSet`. So FIRST export a tiny namespaced helper used by both the
existing private fns and the painter (one wrapper, two consumers — no dup):
`hmscStoreGet(key)` / `hmscStoreSet(key, value)` in `state/gameState.ts` (or a
new `state/hmscStore.ts`). Namespace `'hmsc'` is the wrapper's arg, so keys are
just `chunkPainter.draft` (working buffer) + `chunkPainter.history` (ring).
- **Backup on every update:** each committed stroke (same boundary as the undo
  push) appends a timestamped snapshot to the ring, persisted immediately —
  reload never loses the trail, restore isn't limited to sequential undo.
- Snapshot = `{ at: new Date().toISOString(), painted: [[cellKey, placeableId], ...] }`
  (matches `gameState.ts`'s private `nowIso`); ring capped (~100), oldest dropped.
- **Restore panel** lists snapshots newest-first; click to jump to any. Restoring
  is itself an update (appends a backup) — non-destructive.
- **Save/Load Draft** explicit buttons (never silent autosave).
- **Clear** is two-step (`clearArmed`, second click confirms); does NOT wipe
  history — the trail stays restorable.
- In-memory undo/redo stays for fast reversal; persisted history is the durable
  restore layer. One snapshot shape feeds both — no duplicate snapshot logic.

**Accept:** paint tiles + a zone → Copy → `gv_reset` → paste → identical world;
restore-panel jumps to any past point after a reload.

---

## Names (readable-code)
`WorldLayer`, `Placeable`, `PLACEABLES`, `placeableById`; `tileKindAtCell`,
`worldMarkers`, `WorldMarker`; `Zone`, `ZoneFlag`, `addZone`, `zoneAtCell`,
`currentZone`, `wv_zone`, `ZoneNameFlash`; `wv_fill`, `addSurfaceRegion`;
`buildWorldTree`, `WorldTree`, `ChunkSummary`; `hmscStoreGet`, `hmscStoreSet`;
`painted`, `paintArmed`, `clearArmed`, `floodFillId`, `emitChunkCommands`.

## Verify (every phase)
- `tools/esbuild` bundles clean (do NOT ship — user runs builds).
- Round-trip: author via maps/painter → copy commands → `gv_reset` → paste →
  identical world.

## Deferred (idea #1, the vision)
"Shape-in-code → item/tile" — parametric shapes (`@reactjit/geometries`,
procedural `roads`/`mountain`) become Placeable emitters that stamp footprints.
Drops onto this layer model once the three phases land.

## Forward slice (NOT now — design so we don't foreclose it)
A large future slice: **questlines + dialog + quest locations on the map + an
availability chain gated on player state.** We will not build it now, but the
three phases above must leave its seams open, because it rides the SAME spine —
no parallel system:

- **Quest locations = markers/zones.** A quest objective/giver is a `WorldMarker`
  (Phase 1) or a `Zone` (Phase 2) with a quest binding. So:
  - **SEAM (Phase 1):** make `worldMarkers(state)` aggregate from a LIST of
    marker providers, not a hardcoded `buildings + zones` union. A quest system
    registers a provider; markers appear on both maps for free.
  - **SEAM (Phase 2):** give `Zone`/`Placeable` an optional `ownerId?: string`
    and `visibleWhen?` / `availableWhen?` predicate seam (just the field + a
    no-op evaluator now). Quest gating attaches later with no schema migration.
- **Availability chain = the existing event/rules/counters spine.** Quest state
  rides `recordAndPublishGameEvent` → `hmsc:event:*` → `useHmscEventRules`
  (IFTTT rules already mutate state on events) → `WorldState.counters` / flags.
  A step is: precondition predicate over counters/flags → available (its marker
  shows + zone arms) → trigger (`onEnterCommand` / dialog choice runs a command)
  → effect (sets a counter, emits an event) → unlocks the next step. Do NOT add a
  second event bus or a bespoke quest-flag store; extend `counters` + rules.
- **Dialog = command/event-driven too.** A dialog opens via a command (future
  `dlg_*` verb), choices `runCommandLine` / emit events, so conversations plug
  into the same chain and can gate/advance quests. NPC faces can reuse
  `<PixelIcon>` (see scape art tooling).
- **Authoring stays one tool.** Quest givers, objective pins, and dialog anchors
  become Placeable emitters (`wv_quest`, `wv_npc`, `dlg_*`) placed via the same
  painter, exported as the same command copy-pasta.

Net: nothing here gets built in the three phases, but the layer registry,
`worldMarkers` provider list, the `ownerId`/`*When` seams on Zone/Placeable, and
the commit to the existing event/rules/counters chain are what keep the quest
slice a drop-in rather than a rewrite.

### Future layer: NPC flow hints (NOT now)
Tile costs (`TileNpcProfile`) already give NPCs preference (sidewalk over road)
and traffic signals already yield at runtime (`traffic.ts:vehicleApproachSignal`,
decoupled from the path graph on purpose). A painted **flow layer** is only for
what scalar costs CANNOT express: **direction** (one-way streets, which lane
side), **spawn/despawn density**, and **designer intent** (patrol routes, "use
this alley"). Build it ONLY when you hit one of those — premature flow-painting
is the naive move; tile-costs-first is correct.

When it arrives it is JUST ANOTHER Placeable layer (peer of zones):
`WorldState.flowHints: FlowHint[]`, kind = `flow` in `WorldLayer`, authored via
`wv_flow`, shown as arrows on both maps through `worldMarkers`, summarized in the
tree. Reactive threat-response (the "flee when a car drives at me on the
sidewalk" case) is a SEPARATE behavior/steering layer — not pathing, not painted.

## Slice-in points (code anchors for future runs)
Where to cut in when each deferred piece is built. Re-grep before editing — line
numbers drift across sessions; anchor on the symbol, not the line.
- **Pathing → shared resolver** (Phase 1, do now): `world/pathing.ts` →
  `movementCostForCell`, replace `placedCellAt(state, cell)` with
  `tileKindAtCell(state, cell)`. Leave a back-reference comment at the call site.
- **NPC flow layer** (future): add `flowHints` to `WorldState` in `design.ts`;
  `world/flow.ts` (new, peer of `zones.ts`); `wv_flow` in `commands/registry.ts`;
  contribute a provider to `worldView.ts:worldMarkers`; consume in
  `pathing.ts:movementCostForCell` (directional cost) — leave a
  `// FLOW HINT slice-in — see WORLD_AUTHORING_PLAN` marker there in Phase 1 so
  the future run finds the spot.
- **Quest markers** (future): provider added to `worldView.ts:worldMarkers`
  (relies on the Phase-1 provider-LIST seam).
- **Quest/zone availability gating** (future): evaluate `availableWhen?` in
  `world/zones.ts:currentZone` + the `worldMarkers` provider; predicates read
  `WorldState.counters`. Rules live in `events/useHmscEventRules.ts`
  (`useIFTTT('hmsc:event:*')`), the existing spine — do not add a new bus.
- **Dialog** (future): new `dlg_*` verbs in `commands/registry.ts`; choices call
  `runCommandLine`; opens reuse `<PixelIcon>` for NPC faces.
