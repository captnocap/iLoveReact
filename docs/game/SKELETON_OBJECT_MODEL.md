# The Skeleton Object Model — one substrate for every kind of thing

Status: design of record (2026-06-30). Reshapes the editor foundation's
model-authoring workstream (H) from "generalize modelview's input loop" into this.

## Thesis

A **skeleton is the universal object model**. It is not "a rig for animated
bodies" — it is the one shape every authored thing conforms to. A skeleton is a
*formation of bones* plus *carried data*, and that pair can describe anything:

- a **static prop** — one bone, one mesh, a `static` flag, a collider;
- an **item** — a small skeleton with a grip contact;
- **clothing** — a skeleton that contacts a player skeleton's bones;
- a **player** — bones + an animation spec carried in it;
- a **vehicle** — wheel-mounts (spin), door-mounts (hinge), seat-anchors (contacts);
- a **building** — door/window-mounts, room-anchors, NPC-path contacts;
- a **weapon** — grip-mount (hand-contact), barrel-mount, magazine-mount (a door
  that ejects), sight-mount;
- a **turret / drawbridge / crane / vending machine** — pivots + behaviors + a
  dispense/seat contact.

The framework (zig) does not know what a "vehicle" or a "player" is. It knows
**bones + carried data**: it validates the formation, accepts it, and runs it
through capabilities it already owns. "Make a new kind of thing" is "declare a new
skeleton," which is **data, not code** — a forker of the framework adds thing-types
without touching the zig. That is why the endlessness is real: the substrate is
data-not-code *at the level of object-kinds*, and the kinds are content.

This is the **fold** (nothing lost) of several things already true or ruled:
`mesh_import.zig`'s GLB skeletal path, the player rig (`game/figure` / GAME_FIGURE),
the prop pins/gates design ("pose = contact pins off bones"), the Studio's Lego
typed-mounts, and V24's "the authored object already knows what it means."

## The meta-structure

A skeleton is two parts: the **bones** (the formation) and the **carried data**
(what the bones mean). Every carried section is optional — absence is a valid,
meaningful default (no `animation` ⇒ static pose; no `mounts` ⇒ nothing attaches).

### Bones (the formation)

```
Bone {
  id            // stable within the skeleton
  parent        // bone id or root
  transform     // local rest transform (pos/rot/scale)
  joint?        // articulation at this bone: fixed | hinge | slide | pivot | spin
                //   (+ its axis/limits) — a wheel spins, a door hinges, a
                //   magazine slides+ejects, a turret pivots. Absent ⇒ fixed.
}
```

A single-bone skeleton is valid (the common static prop). "Any valid formation"
means: every bone resolves to a parent (or root), no cycles, ids unique.

### Carried data (what the bones mean)

All references-to-capability, never scripts (V28: capability parameterized by data):

- **meshes** — geometry placed at bones. Either per-bone `{ boneId, geometryKey }`
  (meshes at positions) **or** one mesh skinned across the formation. `geometryKey`
  references the geometry registry / an imported mesh; the skeleton never embeds
  geometry.
- **static** — is the formation frozen or articulated. A static skeleton skips the
  animation/joint machinery entirely (the prop fast path).
- **collision** — colliders per bone (or a hull). Bakes into the V29 COLLIDERS lump.
- **physics** — names a framework physics capability + params (mass, friction,
  buoyancy…). No physics code lives on the skeleton.
- **animation** — *how it animates this way or that*: clips/specs the framework's
  animation capability plays. Carried as data; the player rig's anims are just this.
- **mounts** — named attachment sockets where parts or other skeletons attach
  (wheel, door, windshield, grip, barrel, magazine, sight, room-anchor, seat).
  An articulated mount carries (or sits on) a `joint`.
- **contacts** — where *another* skeleton interfaces with this one: a hand grips the
  grip-mount, a player's pelvis sits at a seat-anchor, an NPC paths to a
  room-anchor. Contacts are pins off bones (the prop pins/gates ruling, generalized)
  — the attach semantics between two skeletons.
- **behaviors** — named framework capabilities the thing *does* (open, eject, roll,
  rotate, dispense), parameterized by carried params and bound to mounts/joints. A
  "magazine that ejects" = the framework's eject/slide behavior referencing the
  magazine-mount, not a script.

## bones_loader

A generic zig loader: **it accepts any valid formation of bones + carried data**,
validates it (formation well-formed; referenced geometry/capabilities resolvable),
and produces a resident, runnable skeleton. It has **no per-type branches** — a
vehicle and a player take the identical path.

It **folds with the existing import path**: a GLB already *is* a bone formation
(rig + skin), so `bones_loader` ingests skeletons from `mesh_import.zig`'s GLB path
**and** from authored skeleton data; import gives the bones + meshes, authoring
layers on the mounts/contacts/behaviors/physics. It does not rebuild skeletal
loading from scratch — it generalizes it.

## How it folds with existing systems (nothing lost)

- **mesh_import.zig / modelview** — the GLB → bones path becomes one source the
  `bones_loader` ingests; modelview's host-native authoring is *how you rig*.
- **geometry registry** — `meshes[].geometryKey` references it; the skeleton stays
  geometry-blind.
- **GAME_FIGURE (`game/figure`)** — the player rig stops being special; it is one
  skeleton whose carried `animation` drives it.
- **prop pins/gates** — `contacts` ARE the pins; this is that design generalized to
  every thing-type.
- **V24 building piece grammar** — a piece's semantic meaning lives as `mounts` +
  `behaviors` on its skeleton (the authored object already knows what it means).
- **V29 mapfile lumps** — a skeleton is the unifying *authored source* the bake
  emits from: meshes → MESH_PROPS/INSTANCES, collision → COLLIDERS, physics →
  PHYSICS_CONFIG, player/NPC rigs → PLAYER_MODEL/NPC_MODELS. The skeleton is the
  source; the lumps are its baked, content-addressed output (V31 chunk cache).
- **editorbus / commands / hot index** — authoring a skeleton (add bone, set joint,
  place mesh, drop a mount, pin a contact) is a stream of editorbus events; the hot
  index (E) folds them; targets carry the skeleton id.

## The data-not-code law (the whole point)

- Behaviors, physics, and animation are **framework capabilities referenced by the
  carried data**, never scripts on a template (V28). A missing capability *extends
  the framework*, never the skeleton file.
- A new thing-type is **new skeleton data**, authored the same way as the last one —
  no new zig. A forker declares thing-types without touching the framework.
- The framework validates "is this a valid formation of bones + resolvable carried
  data" and accepts it. It never enumerates thing-types.

## The rig vocabulary (req_2712/2713, 2026-07-05)

`runtime/skeleton/rigs.ts` is the canonical VOCABULARY layer on the schema — the
shared names the editor's rig panel, the export writer, and the game's ingest
agree on. Contacts: `pocket_<n>` (searchable slot), `placement_<n>` (tabletop),
`seat_<n>`, `grip_left`/`grip_right`, `physical`. Mounts: `ammo`, `projectile`.
Behaviors: `container` (lootCategory, open/locked/keyed access + keyId,
searchSeconds, spawnFillChance), `seat`, `cover`, `door`; `dynamics` rides as
the physics capability. These mirror the load-bearing gameplay fields of the
retired hmsc-int prop table, so everything the old TS prop files could express,
an editor-exported rig can carry. Formation templates (`bodyRigBones`,
`carRigBones`) encode the user's body/car bone drafts as starting content.

**The export path**: cart/editor's Export → Prop compiles the Inspector's
PropRig draft into a `Skeleton` (`propRigToSkeleton`, contact positions measured
off the real mesh bounds) and writes it — with the `placeable` declaration —
into the model package's own manifest (USER RULING req_2718: the on-disk package
is the ENTIRE source of truth; localstore only caches). `skeletonToPropRig`
re-projects the stored skeleton back into the editable draft, so the manifest
stores exactly one record.

## Build slices

1. **The schema + validator** (this foundation pass): the carried-data schema
   (bones + joint + meshes + static + collision + physics + animation + mounts +
   contacts + behaviors) as the shared contract (TS authoring shape + zig types) and
   a `bones_loader` validator that accepts/rejects a formation. This is the
   substrate every thing-type conforms to.
2. **bones_loader ingest** — fold the GLB import path + authored data into the
   generic loader; produce a resident skeleton.
3. **Rigging-authoring host tools** — modelview-style host-native authoring to place
   bones/mounts/contacts, assign meshes, set joints — zero JS per event.
4. **Thing-types as content** — vehicle/player/weapon/building/clothing templates
   authored as skeleton data on the substrate. No engine change per type.

Foundation-pass target = slice 1 + the substrate skeleton of slices 2–3.
The concrete thing-types (slice 4) are content, authored later on the substrate.
