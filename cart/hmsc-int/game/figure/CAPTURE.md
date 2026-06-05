# game/figure — capture note (V2/V2-AMENDED/V1, captured 2026-06-05)

Sources (BEHAVIOR REFERENCES — read, never imported, never modified):

| Old file | Lines | Disposition |
|---|---|---|
| `cart/head_lab/parts.ts` | 1425 | rewritten across `shapes.ts` (data) + `skeleton.ts` (FK) + `assembly.ts` + `clothing.ts` + `rig.ts` + `body.ts` |
| `cart/head_lab/hed.ts` | 488 | rewritten as `hed.ts` (codec + depth law + animations + generator) |
| `cart/head_lab/ragdoll.ts` | 355 | V1 treatment: seam + tuning survive in `ragdoll.ts`; the Verlet SOLVER is NOT kept |
| `cart/head_lab/figureRender.tsx` | 211 | rewritten as `render.tsx` (preview path; params via the bake's `partGlobeParams` — one recipe) |
| `cart/head_lab/index.tsx` | 1733 | **NOT CAPTURED — the editor UI.** Becomes `editors/characters/` in its own wave (V17-TRIAGE) |
| `cart/head_lab/animDsl.ts` | 1 | re-export shim of `cart/animationDsl.ts` — the ANIMATION lane's source, not figure's |

New here (no old twin): `math.ts` (the one euler/vec home — Ry·Rx·Rz host
order), `bake.ts` (THE BAKE ENTRY V2-AMENDED demands: documents/seeds →
host-shaped `BakedFigure`; previously nothing implemented the ruling),
`rig.ts`'s `DAMAGE_ZONE_BY_BONE` (V2 rules the lArm/rArm/lLeg/rLeg spelling;
the 25-bone → 6-zone map existed nowhere in head_lab — combat_lab's
`boneZone()` renamed INTO hmsc's vocabulary, which V2 overrules).

## Deliberately dropped

- **The Verlet solver runtime** (`createRagdoll`/`stepRagdoll`/`ragdollImpulse`/
  `ragdollMaxMotion`/`ragdollCenter`) — V1: "its implementation is not kept."
  What survives: the bones-in/bones-out SEAM (`seedJointsFromBones`/
  `jointsToBones`/`restLengths` + `buildRigFrameFromBones`) and EVERY solver
  behavior number as `RAGDOLL_TUNING` (P2). The archived JS solver is the
  acceptance baseline the future Zig feature validates against.
- **`ASSEMBLY` eager const** (a stand assembly built at module load) — dead
  convenience; callers build what they need.
- **`exposureSamples`-era leftovers**: none found in the kit files (they live
  in combat_lab — the chance lane captured the cover-sample contract).

## Ambiguities (surfaced, not guessed)

1. **P2 grain in the FK.** The designer-tunable TABLES are lifted and exported
   (`shapes.ts`, `RAGDOLL_TUNING`, `FACE_GEN_PALETTES`, `PART_LOD`). The FK's
   inline pose-geometry coefficients (`0.4 * armLen` segment fractions, posture
   drops, punch target tables, etc.) remain inside `buildSkeleton` — they are
   the pose function itself, and flattening hundreds of them into one table
   would shred the readable anatomy. If P2 is ruled to demand the full lift,
   that's a follow-up pass (the kinds capture's LANDFORM_TUNING precedent
   applied at the same grain).
2. **Visual height.** The reference's own comments disagree ("~1.9 units" vs
   "~2.2"); R4 canon says ~2.04m visual head-top. Measured here: ≈2.0 at
   neutral stand (tested as a 1.7–2.3 band). Exact canon belongs to the scale
   audit, not this capture.
3. **`clothingSkinTextureKey` keeps the `headlab.clothing.*` prefix** —
   texture keys are shared global state; renaming would orphan whatever
   registered the existing textures. The texture/materials lane owns renames.
4. **`ragdollHostReady()` is a `false` constant** — no host binding exists and
   inventing a name is how gates break silently. The physics lane re-points it
   when `framework/game/` grows the ragdoll feature (V1).
5. **`.body.heldItem`** is an opaque string into the ITEMS registry — passed
   through untouched; resolution is the V11 lane's.
6. **Bake textures are DESCRIPTIONS, not pixels** (`BakedTexture` = skin +
   layers + dims). Rasterization is the capture/compile concern (StaticSurface
   today, the Zig lowering tomorrow); baking pixels in JS here would duplicate
   the renderer.

## Cross-system needs SURFACED (scope fence — not implemented here)

- **animation lane (V6):** `RigTimelineAction` is consumed here; the timeline/
  RLE format that PRODUCES action arrays is animation's. The action vocabulary
  the FK answers to (crouch/sit/lay/punch/…) is enumerable from `skeleton.ts`.
- **physics lane (V1/V18):** the host ragdoll feature + its honest binding;
  `RAGDOLL_TUNING` + `restLengths()` are its input contract, the archived JS
  solver its acceptance behavior.
- **items lane (V11):** held-item resolution for `.body.heldItem`.
- **materials lane:** clothing-skin texture registration + unwrap rasterization
  at compile time.
- **editors wave:** `editors/characters/` re-creates head_lab's authoring UI on
  this kit (sculpt grids, outline drags, layer painting, photo path).

## Tests (P4, tools/v8cli)

`skeleton.test.ts` 8 · `rig.test.ts` 5 · `documents.test.ts` 5 ·
`bake.test.ts` 6 — 24 meaning-level cases; `render.tsx` is bundle-verified
through the real cart pipeline (JSX can't run under v8cli).

## Editors-wave addition (2026-06-04): the V20 `characters` stream + `bakeBodyDocument`

`stream.ts` defines the `characters` concern (the ROSTER: authored
`BodyDocument` per id + first-authored rail order), following the
`world`/`missions`/`vehicles` precedent of the stream def living beside its
system. Events carry the RESULTING document (`authored` upsert / `removed`),
never the edit verb — sculpt strokes, outline drags, region stamps and
wardrobe picks are editor-side in `editors/characters/`, so the materializer
is a dumb upsert and the round-trip author → stream → snapshot → bake is
exact by construction.

`bake.ts` grows `bakeBodyDocument(doc)` — the ONE BodyDocument → BakedFigure
adapter (reconstructs the head's face document from the doc's own head part;
what compile, verify, and the editor's bake trigger all call). Note:
`.body.heldItem` rides the document but not `BakedFigure` — item resolution
stays the V11 lane's (ambiguity 5 above, unchanged).

`GAME_FIGURE.stream` + `GAME_FIGURE.bakeBody` carry both; `game/index.ts`
re-exports `charactersStream`/`bakeBodyDocument` + the doc types as NAMED
exports (not a 20th GAME_* door). `stream.test.ts` (6 P4 cases) pins roster
semantics, schema-evolution tolerance, the deletion-contract round-trip
through a real on-disk store, undo-as-log-position, and the door.
