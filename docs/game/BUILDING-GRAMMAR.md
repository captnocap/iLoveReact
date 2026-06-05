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
