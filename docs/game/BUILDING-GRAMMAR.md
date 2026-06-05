# BUILDING-GRAMMAR — the piece-grammar ruling (user conversation capture, 2026-06-04)

Evidence doc for verdict **V24** (DECISIONS.md). This is the captured design
conversation behind the map-authoring direction: "minecraft but without the
voxel" — Fortnite Creative semantics. The user's quoted words are load-bearing
and unaltered.

---

User's framing, verbatim: "you know i said the minecraft style builder was the approach but i just realized with the amount of fortnite i played and how simple it is for how expansive of the set you can create from it is minecraft but without the voxel"

Key rulings distilled from the conversation:

1. **The piece grammar, not voxel density.** Minecraft authoring feel, Fortnite structural primitives: wall, floor, ramp/stairs, roof, pillar/corner, arch, fence, railing, trim, sign, prop. Edits are meaningful: a WallEdit is solid/door/window/doubleWindow/brokenWindow/garageDoor/arch/halfHeight. "You are not modeling the Taj Mahal; you are composing readable architectural signals."

2. **Semantic kind + catalog split.** "A wall is always a wall. A floor is always a floor." Game meaning lives on the KIND; variety lives in the CATALOG: style, material, theme ('downtown' | 'motel' | 'trap_lot' | 'suburb' | 'industrial'), size, snap mode ('grid' | 'edge' | 'surface' | 'free'), and gameplay tags: collision, blocksSight, blocksSound, cover, durability, climbable, vaultable, portal.

3. **The bake contract.** Authored pieces compile into: render geometry, collision boxes, cover faces, sound occlusion, room volumes, nav portals/blockers, destructible sections. "The authored object already knows what it means... A doorway knows it connects rooms. A ramp knows it connects floors."

4. **The architectural rule (user-endorsed):** "Author by semantic piece. Bake by gameplay contract. Skin by catalog." The 1m grid stays as alignment/snap substrate for collision/pathing/cover — it is not the authored object model.

5. **Build Mode UX (Fortnite Creative as the capture target):** third-person camera (exists — V23 native), crosshair/cursor targets a snap surface, category select (wall/floor/ramp/roof/prop), ghost preview snapped to grid/edge/surface, click places, edit key cycles variants/cutouts, props drop (trees, bushes, hydrants, signs, furniture), bake emits runtime data.

6. **Three coexisting authoring modes** (user: "maybe we end up using all three but i have a feeling this [pieces] will be the most used shape because it fits too well"):
   - Map Paint — terrain, roads, zones (top-down; exists)
   - Build Mode — semantic pieces (this ruling; likely primary)
   - Voxel — the existing voxel approach (VoxelHybridRoute) stays as an alternative

   Plus: Prop Mode, Drop In (playtest — /test exists), Bake/Compile (V15/V19 — exists).

7. **Tool-shape convergence:** "Fortnite Creative as the authoring UX, HMSC semantic bake as the runtime output."

---

## Addendum (same session) — prefabs/compositions are first-class

User's words, verbatim: "i can just place basic walls, cut them out, make a building, then clone it into a tool, and go place it around. new building is just the same authoring as the last building, i physically make it in the game. then that just leaves props to prompting."

Requirements distilled:

1. A **Prefab** = a NAMED composition of placed pieces (with their edits), saved from the world into the palette/catalog as a placeable unit.
2. Prefabs **DECOMPOSE** to their semantic pieces underneath — the bake contract sees through them (a cloned motel is still walls/doors/rooms to collision/nav/rooms emission; no opaque blobs).
3. Placing a prefab is ONE authoring action (one session-history commit), but edits to a placed instance work at PIECE granularity.
4. Prefab definitions are P2 data (catalog tables / V20-streamable), same registry family as pieces.

And the prop split: props remain PROMPT-GENERATED assets ("that just leaves props to prompting") — the catalog's prop entries get filled by the existing items/model pipelines, not by the builder.

---

## Addendum 2 (same session) — the Sims-style "Plan Build" mode; one model, two views

A Sims-style Plan Build mode joins the layered game-as-authoring model. The framing: Fortnite mode = EMBODIED authoring at player scale ("does this feel good to stand in, does the storefront read from the sidewalk"); Sims mode = ARCHITECTURAL authoring from above the world (floorplans, rooms, doors, furnishing, duplicate/mirror/rotate sections, "lay out ten buildings fast"). Both wanted; they answer different questions.

**The invariant, user's words (load-bearing): "The key is they must edit the same semantic data, not separate representations."** Sims and Fortnite modes are two VIEWS over the same piece model (kind + gridPos + rotation + style + gameplayTags). Nothing in the piece tables may assume a single camera/interaction mode; placement provenance, if recorded, is metadata, not schema.

**The mode taxonomy (the tool's authoring modes):**
- Map Paint — terrain/heightfield/roads/zones
- Creative Build — third-person embodied
- Plan Build — Sims-style topdown/iso
- Prefab Edit — isolate a building/stamp
- Drop In — playtest
- Compile — bake

**Mode-switch UX ruled:** alt-tab-style instant swap / an action-bar mode strip (F1 Map, F2 Build, F3 Plan, F4 Props, F5 Play, F6 Bake) — "authoring itself becomes multiple playable camera modes over the same world. Not a separate editor app."
