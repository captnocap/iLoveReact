# The Animation Slice — skeleton, clips, pose plumbing, motion capture

Survey doc (req_4281, 2026-08-12). Written after the req_4279 diagnosis (SkinTokens-rigged
player loads into the world rigid). Everything below is disk truth with file:line cites as
of this date; it is a map, not a ruling. Related history: V6 (animation DSL semantics,
hmsc era), req_0576 (animation workbench plan), req_4208 (rigging tier direction).
The follow-up proposal that names the roof over this slice: `ANIMATION_ROOF.md`
(req_4285, awaiting ruling).

## The one-paragraph story

A mounted character has exactly **three possible motion sources**, in priority order
(`framework/world_loader/player_character_pose.zig:182`):

1. **An external pose stream** — a named owner (motion capture, or any host caller)
   publishes complete quaternion frames; they interpolate and win over everything.
2. **The five built-in clips** — idle / walk / jump / sit / lay, sampled natively per
   frame — but **only** if the skeleton is the canonical 24-bone humanoid-v1 palette,
   matched by exact bone-ID string.
3. **Frozen bind pose** — the deliberate fallback for any non-canonical skeleton.

Every part of the slice — clips AND capture retargeting — speaks **canonical bone IDs**.
A SkinTokens rig speaks `external_joint_N` with semantic role bindings on the side, and
nothing translates between the two yet. That is the entire reason the world player is
rigid today, and it is also why motion capture currently "exists but attributes to
nothing": it drives a live preview and records **nothing**.

---

## 1. The canonical skeleton — humanoid-v1, 24 bones

Authored once in `runtime/skeleton/data/humanoid-v1.json`, code-generated both ways by
`rjit codegen-bindings`: `runtime/skeleton/generated/humanoid-v1.ts` (JS) and
`framework/skeleton/generated/humanoid_v1.zig` (native). Pelvis sits at 0.99 m; segment
lengths are authored bind translations that **animation can never stretch** (only the
root translates; all other channels are rotations).

```
root
└─ pelvis
   ├─ spine_lower → spine_upper
   │  ├─ neck → head
   │  ├─ clavicle_left  → upper_arm_left  → lower_arm_left  → hand_left  → fingers_left
   │  └─ clavicle_right → upper_arm_right → lower_arm_right → hand_right → fingers_right
   ├─ upper_leg_left  → lower_leg_left  → foot_left  → toes_left
   └─ upper_leg_right → lower_leg_right → foot_right → toes_right
```

Joint constraints (authored per bone, clamped every frame by
`framework/skeleton/rig_pose.zig` before anything reaches the GPU):

| Bone | Joint | Limits (degrees) |
|---|---|---|
| root | — | free root control (the only translating channel) |
| pelvis | ball | swing ±20, twist ±25 |
| spine_lower / spine_upper | ball | swing ±18, twist ±20 |
| neck | ball | swing ±35, twist ±60 |
| head | ball | swing ±25, twist ±45 |
| clavicle L/R | ball | swing ±25, twist ±20 |
| upper_arm L/R | ball | swing ±120, twist ±90 |
| lower_arm L/R (elbow) | hinge X | 0 … 150 |
| hand L/R | ball | swing ±45, twist ±60 |
| fingers L/R (one bone per hand) | hinge X | 0 … 100 |
| upper_leg L/R | ball | swing ±100/±60, twist ±45 |
| lower_leg L/R (knee) | hinge −X | 0 … 150 |
| foot L/R | ball | swing −45…60 / ±30, twist ±25 |
| toes L/R | hinge X | −20 … 45 |

This palette is deliberately coarse: **one** fingers bone per hand, **one** toes bone
per foot. Compare that to what SkinTokens generates (§6).

## 2. The five clips — `framework/skeleton/humanoid_clips.zig`

Clips are **authored as a table, played as documents** (req_4285/req_4294):
each clip is 2–5 authored keys built as rotations off the bind pose, every
behavior-affecting number in one authored `ClipTuning` table
(`humanoid_clips.zig`). At runtime the clip floor no longer samples that table —
`clip_documents.zig` generates the five clips as RJAN motion documents from it
(a resident library), and playback goes through the same
`motion_document.sample` every mounted motion layer uses. The flip was gated
on per-clip headless shots: table-vs-document byte-identical for all five
clips under `RJIT_FIXED_DT` (`RJIT_CLIP_SOURCE=table` remains the diagnostic
to replay the procedural sampler). A comptime assert still pins the authoring
palette: *"humanoid-v1 clips require the canonical 24-bone palette"*
(`humanoid_clips.zig:18`) — authoring stays canonical; playback is
role-addressed and body-agnostic.

Every clip key builds on the **rest stance** (`arm_rest_degrees`, req_4300):
each upper arm drops 75° from the T-pose bind toward the body, so a standing
body carries its arms at its sides while the bind itself stays a T for
skinning. Clip arm swings compose in the lowered frame (sagittal).

| Clip | Duration | Loops | Clock | What it keys |
|---|---|---|---|---|
| idle | 2.0 s | yes | continuous state clock | breath: spine_lower ±2°, head −1° |
| walk | 1.0 s cycle | yes | `gait_phase` (1.6 Hz walk / 2.3 Hz run, `world_loader/config.zig:298`) | root bob 0.025 m; pelvis twist 3°; spine_upper counter −4°; hips ±26°; knees 7° base + 25° lift; arm swing ±18°; elbows 14° ± 6° |
| jump | 0.60 s | no | `jump_time` (crouch→flight at 0.22 s) | root −0.10/+0.12/−0.03 m; hips 22/−8/8°; knees 48/10/18°; arms −24/52/8° |
| sit | static key | yes | continuous | root −0.42 m; pelvis −10°; hips 80°; knees 75°; arms 14°; elbows 24° |
| lay | static key | yes | continuous | root −0.78 m; pelvis −85°; arms 8°; knees 6° |

**Bones the clips actually animate (13 of 24):** root (translation), pelvis,
spine_lower, spine_upper, head, upper_arm L/R, lower_arm L/R, upper_leg L/R,
lower_leg L/R.

**Bones no clip ever touches (11):** neck, clavicle L/R, hand L/R, fingers L/R,
foot L/R, toes L/R — they hold bind-local rotation and ride their parents.

`sampleForBind` (`humanoid_clips.zig:305`) rebases the canonical deltas onto a fitted
target's actual bind rotations, so a skeleton fitted to a differently-proportioned body
still plays clips without discarding its authored bind.

## 3. Who picks the clip — the /play world loader

Per frame in `framework/world_loader/runtime_stream.zig:536-546`:

```
posture == sit  → sit          posture == lay → lay
airborne        → jump         moving or run  → walk        otherwise → idle
```

`RJIT_FORCE_GAIT=1` forces the walk clip with no input — the headless animation-repro
hook for `rjit shot` (req_2781).

The sampled frame then flows: pose state (`player_character_pose.zig:182 advance`) →
FK + constraint clamp (`CharacterAsset.evaluate`) → GPU skin palette → the clamped
result is fed **back** into the interpolator (`acceptEvaluated`,
`player_character_pose.zig:223`) so a hostile out-of-range frame can't make the next
blend start from an invisible pose.

**The gate is role-addressed as of req_4285 (was: the canonical-palette gate that
made SkinTokens rigs rigid).** `resetRig` now resolves each clip channel
(`humanoid_clips.zig CHANNEL_IDS`, the 12 driven rotations) against the role-aliased
palette (`CharacterAsset.retargetBoneIds`); a body answers to clips exactly when every
clip role is bound. Unbound rigs still hold bind pose until an explicit
capture/animation stream takes ownership. The old law (bone count == 24 + exact ID
order) is dead; M4004's 13 role-bound joints satisfy the clip channel set.

**NPCs** (`world_loader/npc_character_session.zig:110-115`): canonical idle clip only,
though each instance owns its own clock, quaternion state, and GPU palette.

**Scene nodes** (`world_loader/animation.zig`): normal /play mounts one deformed
skinned player node; capture mode swaps in a bind + deformed specimen **pair** parked
at a fixed diagnostic anchor (never moved by physics/input) with its own framing camera.

## 4. The pose wire and the doors

Wire v1 (`framework/skeleton/pose_stream.zig`): little-endian
`{version:u16, boneCount:u16, frameId:u64, rootTranslation:f32x3}` + one quaternion
(16 B) per bone; max 255 bones; frame IDs strictly monotonic; render-rate interpolation
targets 90 ms between ingested frames. Bone-local translations never cross this door.

| Door | What it does |
|---|---|
| `__compiled_world_set_player_character` | stages one already-bound saved character (RJMD/RJSK reopened + hash-checked natively); returns the bone-ID palette |
| `__compiled_world_set_player_pose` | publishes one complete v1 frame as owner `compiled-world-host`; empty bytes release the override so clips resume; refused with `CharacterPoseOwnedByCapture` while a capture session owns the target |
| `__compiled_world_npc_character_session` | explicit NPC instances over the same CharacterAsset path |
| `__capture_session` | the native capture/retarget session (openTarget / calibrate / freeze / resume / setDepthSign / snapshot / close) |
| `__pose_estimate_async` / `__pose_camera_devices` | MoveNet inference over a cam:N surface via the ONNX worker (off the V8 thread) |

Ownership law: pose ownership is a single named owner (`OwnerId`, 64 bytes). Capture
activation and the direct host door cannot fight — whoever owns, owns all bones, and a
replaced session's late close cannot tear down a newer session's pose.

## 5. The motion-capture portion — exists, drives live, records NOTHING

The chain, end to end:

```
V4L2 camera (cam:N only — SELFSHOT law, no desktop capture)
  → live feed surface (RenderTarget keeps it mounted)
  → __pose_estimate_async: MoveNet SinglePose, COCO-17 keypoints, ~30 Hz pipelined
      (runtime/capture/pose.ts — importing it gates the has-onnx build flag)
  → __capture_session (framework/skeleton/capture_session.zig)
  → source_skeleton.zig: calibration = median of 30 fully-valid frames
      (min keypoint confidence 0.25, 10 s deadline; 16 joints / 12 segments;
       monocular depth SIGN is an explicit input, never guessed)
  → humanoid_retarget.zig: per-segment drive gate (confidence ≥ 0.35,
      hold 150 ms / fade 350 ms on dropout); share splits (clavicle 0.25,
      spine 0.45/1.0, neck 0.40/head 1.0)
  → rig_pose constraint clamp → target CharacterAsset FK → GPU palette
```

UI: the **animation document surface** (`cart/editor/stage/AnimationCaptureSurface.tsx`,
document kind `animation`, mounted in `stage/Stage.tsx:165`) — camera feed, detected
landmarks, reconstructed source skeleton, and the native target viewport are three views
of the exact same completed frame. The target loads through the same strict
saved-character contract as /play (`cart/editor/skeleton/captureTarget.ts`). Capture can
also claim the **mounted /play player** as its target
(`framework/world_loader.zig:380-457`).

**What it attributes to: nothing durable.** Confirmed by sweep:

- No pose frame is ever recorded — the wire format is transport-only; no file format
  for captured motion exists anywhere in the slice.
- No clip is ever authored from capture — the five clips are hand-authored procedural
  tables; there is no path from a capture session into `ClipTuning` or any keyframe store.
- Session close (`closeMountedPlayerCharacterTarget`) clears the pose and the character
  reverts to clips/bind. The motion evaporates with the session.
- The capture retarget is **also canonical-coupled**: its channel table maps MoveNet
  segments to bones by canonical ID string (`humanoid_retarget.zig:71-85` — "pelvis",
  "upper_arm_left", …) and requires bones literally named `pelvis` and `head`
  (`humanoid_retarget.zig:218-220`). Against a SkinTokens rig (`external_joint_N`) it
  has zero matching channels. Hands/fingers/feet/toes are excluded by design even on
  canonical rigs (`preservesBindOrientation`, `humanoid_retarget.zig:136`).

## 6. What the SkinTokens era changes — the palette mismatch

Adopted external rigs (`character_rig_session.zig adoptExternalRig`, ~line 2826) keep
the generated skeleton as-is (per the req_4224 ruling: variable joint counts are fine;
the legacy fixed count "was arbitrary"). Bones are named `external_joint_N`; display
names and **semantic role bindings** are stamped from dominant part weights.

M4004 (the current declared player, `cart/editor/data/models/props/M4004/manifest.json`):
**53 bones**, 18 role-bound — the full required humanoid role set:

| Canonical | M4004 |
|---|---|
| root | — (pelvis is M4004's root) |
| pelvis / spine_lower / spine_upper | joint_0 / joint_1 (abdomen) / joint_2 (chest) |
| neck | joint_3 — exists, **no role** |
| head | joint_4 (+2 unlabeled children) |
| clavicle / upper_arm / lower_arm / hand L,R | joints 7-10 (L), 26-29 (R) — all role-bound |
| fingers L/R | **15 bones per hand** (11-25 L, 30-44 R), no roles |
| upper_leg / lower_leg / foot L,R | joints 49-51 (L), 45-47 (R) — all role-bound |
| toes L/R | joints 52 / 48 — exist, no role |

Net: richer skeleton, zero shared vocabulary with the clip/capture channel tables.

## 7. The named gaps (filed, not decided)

1. **Clips → role retarget. CLOSED by req_4285 step 1.** Clips sample as
   role-addressed bind-relative deltas (`sampleChannels`) and rebase per channel onto
   any rig that binds the clip roles; unbound extras (fingers, toes, neck) ride their
   parents. Capture already spoke the role vocabulary through `retargetBoneIds` —
   both halves of the slice now address motion by role, never bone-ID string.
2. **Weights-only SkinTokens (Tier 1, req_4208 direction).** Author the canonical
   skeleton, run SkinTokens `--use_skeleton` for weights only → palette check passes,
   clips and capture work today, untouched.
3. **Capture recording → clip authoring.** The "attributes to nothing" gap. The wire
   frames are already exact and monotonic; nothing persists them. The req_0576
   workbench plan (keyframe timeline, in-game playback) and the V6 ruling (animation
   DSL semantics; "RLE'd, relational animation data" as the real format) are the
   standing direction for where recorded motion should land.
4. **Clip coverage.** Even canonically, 11 of 24 bones are never animated, NPCs only
   idle, and there is no run-distinct clip (run = walk cycle at 2.3 Hz).

## 8. File map of the slice

| Layer | Files |
|---|---|
| Skeleton data | `runtime/skeleton/data/humanoid-v1.json` → generated `runtime/skeleton/generated/humanoid-v1.ts`, `framework/skeleton/generated/humanoid_v1.zig` |
| Clips | `framework/skeleton/humanoid_clips.zig` |
| Pose core | `framework/skeleton/pose_stream.zig` (wire+interp), `rig_pose.zig` (constraints/FK), `fk_pose.zig` (quat math) |
| Capture | `framework/skeleton/capture_session.zig`, `source_skeleton.zig`, `humanoid_retarget.zig`; `runtime/capture/pose.ts`; `cart/editor/stage/AnimationCaptureSurface.tsx`, `cart/editor/skeleton/captureSession.ts`, `captureTarget.ts` |
| Rig authoring | `framework/skeleton/character_rig_session.zig` (+ `autoweights.zig`, `humanoid_fit.zig`, `skin_binding.zig`); `cart/editor/skeleton/externalAutoRig.ts` (SkinTokens lane), `humanoidSemanticAssignment.ts` |
| World runtime | `framework/world_loader/player_character_pose.zig` (pose ownership + clip gate), `runtime_stream.zig:536` (clip selection), `animation.zig` (nodes+clocks), `npc_character_session.zig`; doors in `framework/v8_bindings_compiled_world.zig`, `v8_bindings_onnx.zig` |
| Editor load path | `cart/editor/world/playerCharacterLoader.ts`, `playerCharacterGate.ts` |

Note on the working tree at time of writing: the old JS-side animation stack
(`cart/editor/world/playerAnimation.ts`, `poseSolve.ts`, `playerRigSlices.ts`,
`poseMarkers.ts`, `playerModelPush.ts`, `cart/editor/model/playerStarter.ts`) is deleted
uncommitted — the req_4208-era migration to this native slice. The clips were not lost;
they were ported into `humanoid_clips.zig` and gained the canonical-palette coupling
documented here.
