# The Animation Roof — one durable, role-addressed motion format

Proposal doc (req_4285, 2026-08-12 — follow-up to the req_4281 survey,
`ANIMATION_SLICE.md`). This is a **ruling request, not a diagnosis**: the survey
established that the slice is four disconnected rooms — canonical clips, the pose wire,
motion capture, and SkinTokens rigs — that all speak motion but don't speak to each
other. This proposal names the roof they should live under, in dependency order, and
names what each existing piece becomes once it's inside.

Standing law it builds on: V6 (animation DSL semantics win; the real format is "RLE'd,
relational animation data"), req_0576 (the animation workbench plan), req_4224
(variable joint counts are fine), req_4208 (rigging tier direction), req_4279 (the
rigid-player diagnosis this resolves as a side effect).

## The Goal

Make all motion — hand-authored keyframes, motion capture, and the built-in clips —
**one durable, role-addressed format that plays on any body.**

Everything else in the proposal is a consequence of that sentence:

- **Role-addressed** → motion stops being coupled to the canonical 24-bone palette, so
  SkinTokens rigs animate and the rigid-player bug dies as a side effect.
- **Durable** → capture finally attributes to something: takes are recorded, editable,
  and replayable instead of evaporating at session close.
- **One format** → clips, captured takes, and hand-keyed poses become the same kind of
  document, so authoring, layering, scrubbing, and reuse are built once and work for
  all of them.
- **Any body** → a motion authored or captured once retargets everywhere, which is the
  whole "pose it, declare time, forget the rest" dream in practice.

The user-facing version: author a pose, declare when it happens, and the system fills
in the rest — on any character, from any source, forever.

## Execution status (2026-08-12, same day — user set the goal, all five steps landed)

1. **Roles as the motion vocabulary — LANDED.** Clips sample as role-addressed
   deltas (`humanoid_clips.zig CHANNEL_IDS`/`sampleChannels`); the canonical-24
   gate is dead (`player_character_pose.zig resetRig` resolves channels against
   `retargetBoneIds`). Capture already spoke roles through the same palette.
2. **Motion documents + recording tap — LANDED.** RJAN v1
   (`motion_document.zig`: keys + dictated runs, coverage masks, planted
   annotations); capture `record`/`recordStop` persists content-addressed
   takes (`motion-<sha256>.rjan`); replay proven cross-body in-suite;
   `__compiled_world_play_motion` replays takes from disk on the mounted player.
3. **Clips as documents — LANDED, shot gate PASSED, source of truth FLIPPED
   (req_4294).** `clip_documents.zig` generates the five documents FROM
   ClipTuning (parity swept in-suite: 5 clips × 25 times × canonical +
   adopted) and holds them as a resident library; the runtime clip floor now
   plays the DOCUMENTS through the same `motion_document.sample` every mixer
   layer uses. Gate evidence: per-clip headless shots (`RJIT_FORCE_CLIP` +
   `RJIT_FORCE_CLIP_SECONDS` + `RJIT_CLIP_SOURCE` under `RJIT_FIXED_DT`,
   `shots/clip-parity/`) byte-identical table-vs-document for all five clips
   plus a mid-segment walk sample, with a byte-identical control twin. The
   table stays as the documents' generator input and as the
   `RJIT_CLIP_SOURCE=table` diagnostic — generated output, not the source of
   truth. New clips become content, not code.
4. **The mixer — LANDED.** Four per-role layers over the clip floor
   (`MAX_MOTION_LAYERS`); blend-in ramp + snapshot fade-out (the capture gate's
   hold/fade law); wave-over-walk proven in-suite; external owner still wins
   everything, doors unchanged.
5. **The workbench — LANDED.** `MotionDock` in the animation surface: REC/STOP
   takes, ADD KEY from the captured pose (native `poseKey` verb), per-role-group
   timeline with ghosting, nudge/move-to-playhead/delete, scrub through
   `__compiled_world_scrub_motion`, PLAY onto the registered /play world.
   Authoring codec: `motion_document_json.zig` behind
   `__compiled_world_motion_document`.

Runtime proofs: M4004 walking in /play — user-confirmed. Per-clip parity
shots — PASSED (byte-identical, see step 3). Still pending the user's eyes:
the facing fix in /play (req_4291), capture driving M4004 live, and the dock
exercised end to end.

## Rulings requested

1. **Roles are the motion vocabulary.** All motion sources address channels by semantic
   role, never by bone-ID string (Pillar 1).
2. **The motion document is the one durable motion format** — sparse keys where the
   author was sparse, dense runs where a take was dense; this is where V6's "RLE'd,
   relational animation data" lands (Pillar 2).
3. **The five clips migrate into the store** as the first five motion documents; the
   procedural table becomes generated output after shot-verified parity (Pillar 2).
4. **One mixer arbitrates playback**, layered by role coverage, under the existing
   single-owner law generalized per role (Pillar 3).
5. **The workbench extends the existing animation document surface** (req_0576
   execution), not a fresh surface.

## The claim

Everything in the slice is already a piece of one system that nobody has declared yet:
**a keyframe animation system where a user authors poses at declared times and the
in-betweens are filled in.** Read the survey again with that lens:

- The five clips are authored keyframes with fill-in — 2–5 hand-authored keys, slerp
  between them. The dream already exists in miniature; it's just frozen into a
  procedural table that only one skeleton can hear.
- Motion capture is a keyframe authoring device — the highest-bandwidth pose input we
  have — that currently throws every pose away at session close.
- The pose wire is the playback contract — exact, monotonic, interpolated frames with
  single-owner semantics — that everything already flows through.
- Role bindings are the translation layer between "a pose" and "a specific body" —
  computed at adoption time and then used by nothing.

The gap is not missing machinery. The gap is that motion is currently **addressed by
bone-ID string, and stored nowhere.** Fix the vocabulary and add the store, and every
room in the survey connects. The dream spec's demands (pose anything, declare time,
natural fill-in, layered control, capture reuse) fall out of that, mostly for free.

## The three pillars

### Pillar 1 — Motion speaks roles, not bone names (the vocabulary fix)

Standing gap #1 from the survey, promoted to the foundation of everything else.

**Ruling requested:** all motion sources — clips, capture retarget, and the new
keyframe store — address channels by semantic role (pelvis-role, upper-arm-left-role,
…), never by bone-ID string. A skeleton, canonical or SkinTokens-adopted, is "just a
body that answers to some set of roles." Bones with no role-bound motion ride their
parents — which is already the declared behavior for the 11 canonical bones no clip
touches, so this generalizes existing law rather than inventing new law.

What this buys immediately, before any keyframe work:

- The five clips play on M4004 and every adopted rig with the required role set. The
  rigid-player diagnosis (req_4279) is resolved as a side effect.
- Motion capture drives SkinTokens rigs through the same channel map.
- Every future keyframe authored on one body replays on any body — the dream spec's
  "reuse on other characters, adapted to different sizes" clause — because
  `sampleForBind` already knows how to rebase deltas onto a target's actual bind. That
  machinery becomes the retarget path for **all** motion, not just clips.

This pillar touches the retarget channel table and the clip channel table and nothing
else. It is the smallest change with the largest blast radius, and everything below
assumes it.

### Pillar 2 — The keyframe store (the thing that doesn't exist)

Standing gap #3, given a shape. This is the actual "authored keyframes + declared
time" system from the dream spec, and the answer to "capture attributes to nothing."

A **motion document** is the new durable artifact. It contains:

- **Keys:** role-addressed poses (rotations per role, root translation), each at a
  declared time. Partial keys are first-class — a key may cover one role, the whole
  body, or anything between. This is the dream spec's "I only pose the left arm and
  the rest is not my problem," and it costs nothing to honor because roles are already
  independently addressable channels.
- **Fill-in policy** per key-pair, per role, defaulting to what clips already do:
  shortest-arc slerp through constraint clamp. The clamp is the survey's existing
  "impossible poses handled quietly" guarantee — `rig_pose` already clamps every frame
  before the GPU, so in-betweens can never bend an elbow backwards no matter what the
  interpolation produces. The dream spec asked for this as a feature; we get it as an
  invariant we already enforce.
- **Layered override,** in the dream spec's onion order: nothing → per-transition
  easing declarations → per-role timing offsets → a fully dictated frame range where
  the author (or a capture take) specifies every step and the system blends at the
  edges. The bottom layer of that onion is literally the pose wire format — a dense
  run of exact frames — so "total dictatorship" and "captured motion" are the same
  storage case. This is where the V6 ruling's "RLE'd, relational animation data"
  lands: sparse keys where the author was sparse, dense runs where a capture or a
  dictator was dense, one format.

**Capture recording becomes trivial by construction.** A capture session already emits
exact, monotonically-IDed frames through the retarget chain. Recording is: persist
those frames into a motion document as a dense run, tagged with the source role map.
No new wire, no new math — the survey's finding that "the wire frames are already
exact and monotonic; nothing persists them" means the recorder is a tap on an existing
pipe. A recorded take is then immediately editable as keyframes: decimate the dense
run to sparse keys where the motion is smooth, keep it dense where it isn't, let the
author delete/move/re-time keys like any hand-authored ones. Capture stops being a
live-only puppet show and becomes the fastest keyframe authoring tool in the system.

**The five clips migrate into this store** as five small motion documents (their
authored keys are already enumerable from `ClipTuning`). The procedural table stays as
the reference implementation until playback parity is shot-verified
(`RJIT_FORCE_GAIT`-style repro hooks per clip), then the table becomes generated
output of the documents rather than the source of truth. Net effect:
idle/walk/jump/sit/lay stop being privileged compiled-in citizens and become the first
five documents in a library anyone can add to — which is the only honest fix for
standing gap #4 (clip coverage, no run clip, NPCs only idle). New clips become
content, not code.

### Pillar 3 — One playback arbiter (the roof itself)

The survey's priority chain (external stream > clips > bind) generalizes into a
**motion mixer** with the ownership law we already have:

- **Sources:** the world loader's state-driven clip selection (now selecting motion
  documents), host-published pose streams, capture sessions, and scrub/preview from
  the workbench. All produce role-addressed frames; all flow through the same
  retarget-onto-target path; all get constraint-clamped; all feed back through
  `acceptEvaluated` so blends never start from an invisible pose. Nothing about the
  per-frame pipeline changes — the mixer sits where the priority `if` currently sits.
- **Layering, not just priority** — the dream spec's "base walk + wave + head turn,
  each editable." Because channels are per-role, a partial source (a wave document
  covering arm roles) composes over a base source (walk) by role coverage, with the
  existing hold/fade dropout behavior from the capture gate reused as the
  blend-in/blend-out discipline. Single-owner law is preserved **per role** rather
  than per body: whoever owns a role, owns it; a full-body external stream still wins
  everything, exactly as today.
- **Looping seams, gait-phase clocks, and the sit/lay/jump/walk/idle selection logic
  stay where they are** in the world loader — they become clients of the mixer, not
  special cases inside it.

## The workbench (where the human stands)

The req_0576 animation workbench plan is the standing direction; this proposal slots
it in as the editor surface over Pillar 2, and rules that it **extends the existing
animation document surface** rather than starting fresh — the capture surface already
has the target viewport, the strict saved-character load contract, and the
same-completed-frame view discipline. It gains:

- A timeline of keys per role group; drag keys in time, everything recalculates (the
  dream spec's "slide poses around and nothing breaks" — cheap, because keys are just
  times over role channels).
- Scrubbing through the mixer at any speed, live, using the same render-rate
  interpolation the pose wire already does.
- Ghosting (faint prior/next keys around the playhead) and A/B comparison between two
  versions of a transition — both are pure view features over the store, listed here
  so they're scoped in, not discovered later.
- One-button capture-to-take: start a capture session, record into the open document,
  stop, and the take appears on the timeline as an editable dense run.

Pose authoring by direct manipulation (grab a limb, drag it) rides the constraint
clamp for free — the pose you can author is by definition a pose the body can hold.

## What deliberately stays out from under the roof

- **Physics-aware fill-in, foot planting, IK.** The dream spec asks for planted feet
  and momentum-feel. The survey shows feet/toes are excluded from capture retarget by
  design and clips fake ground contact with authored root bob. Honoring that: contact
  and IK are a later layer above the mixer, not a Pillar. The store should record
  which keys the author declared as "planted" (an annotation, cheap now) so the later
  layer has ground truth, but no solver ships under this req.
- **The animation DSL (V6).** The motion document is the data the DSL will eventually
  address. Format decisions here should cite V6's semantics, but the language itself
  is out of scope.
- **Feel-words → easing translation ("snappy," "heavy").** The store supports named
  easing policies per transition; shipping a curated vocabulary of them is content
  work after the workbench exists.

## Order of work and what each step proves

1. **Roles as the motion vocabulary** (Pillar 1). Proof: M4004 walks in /play; capture
   drives M4004 live. Kills the req_4279 symptom outright.
2. **Motion document format + capture recording tap** (Pillar 2, storage half). Proof:
   record a capture take, close the session, replay the take from disk onto a
   different body. The moment this lands, capture attributes to something.
3. **Clips as documents, parity-shot-verified** (Pillar 2, migration half). Proof:
   pixel-parity repro shots for all five clips, canonical and adopted rigs.
4. **The mixer with role-coverage layering** (Pillar 3). Proof: wave-over-walk on the
   mounted player with the existing ownership doors unchanged from the host's view.
5. **Workbench timeline over the store** (req_0576 execution). Proof: author a
   three-key motion by hand, scrub it, re-time it, play it in /play.

Each step is independently shippable and independently valuable; step 1 alone
justifies the req. Nothing in the list requires a new door, a new wire version, or a
change to the ownership law — the survey found the plumbing sound, and this proposal
keeps it.

## The one-paragraph story, after

A body — canonical or adopted — answers to roles. Motion — hand-keyed, captured, or
migrated from the old clips — is a document of role-addressed keys at declared times,
sparse where an author was sparse, dense where a take was dense, filled in between by
the same clamped slerp we already trust. One mixer plays documents onto bodies,
layered by role, owned by the same single-owner law as today. The user poses what they
care about, declares when, and forgets the rest; the system's defaults are the
behaviors the slice already exhibits, finally pointed at the same target. Maximum
control where the author digs in — down to dictated frames, which are just capture's
native tongue — and everything untouched stays effortless, because untouched channels
ride their parents, exactly as they always have.

## Landed after the roof: the exercise (req_4323, stage 1 of the workshop proposal)

The mixer's vocabulary reached the rig session on 2026-08-13. `mountExercise`
(`clip:<idle|walk|jump|sit|lay>` or a motion-library path, content-address
verified by the same `motion-<sha256>.rjan` law) plays a document on the rig
session's working body: channels resolve through the shared role→wire alias
(`skeleton.semanticRetargetId` — the exact table `retargetBoneIds` uses), deltas
apply bind-relative, and the pose flows through the same `rig_pose.evaluate`
constraint clamp as every displayed pose. `parkExercise` freezes an exact frame
(negative seconds = park where the native clock stands) so weights, joints, and
constraints are edited AGAINST the failing pose; `resumeExercise` releases it;
`setTestPose` stops it — the exercise and the bend tests are two writers to one
displayed slot, and the last writer answers. Exercise state is view-state: no
undo units, cleared on open/close, and the per-frame clock lives natively
(`character_rig_session.tickExercise` → `gpu/3d.zig update`), moving matrices
only — never resident geometry. The EXERCISE section in the rig pane
(`cart/editor/inspector/CharacterRigSection.tsx`) lists the five clips and every
`userdata/editor/motion/*.rjan` document.
