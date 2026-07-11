# World loader

The compiled-world loader is framework code. Its public entrypoint is
`framework/world_loader.zig`; implementation lives in this directory. The
top-level `world_loader.zig` is the untouched legacy comparator until the two
implementations are reviewed side by side.

## Boundaries

| Area | Files | Owns |
| --- | --- | --- |
| Public host surface | `../world_loader.zig` | Mounts, embedded/detached rendering, editor ingress, standalone `main` |
| Retained ownership | `runtime.zig`, `state.zig` | Runtime fields and small value/state types |
| Tuning and wire constants | `config.zig` | Behavior-affecting constants shared across subsystems |
| Construction | `scene_build.zig`, `instances.zig`, `geometry.zig`, `game_file.zig` | Game-file input, procedural meshes, row batching, retained-scene assembly |
| Physics and presentation | `physics.zig`, `camera.zig`, `animation.zig` | Collider derivation, player physics, camera solve, clip sampling |
| Runtime phases | `runtime_lifecycle.zig`, `runtime_stream.zig`, `runtime_dynamics.zig`, `runtime_interaction.zig` | Init/deinit, frame coordination, dynamic systems, interaction/HUD |
| Live editor overlay | `live_inputs.zig`, `runtime_live_scene.zig` | Pending editor ingress and retained live mesh/material reconciliation |
| Map authoring preview | `paint_surface.zig`, `paint_runtime.zig`, `transport_render.zig`, `foliage_preview.zig` | Pointer projection, terrain/water publication, semantic paths, async flora |
| Streaming records | `streaming_support.zig` | Streaming policy and immutable range/erase records |

The intended dependency direction is:

```text
framework/world_loader.zig
  -> runtime.zig
       -> focused runtime operation modules
            -> state/config + pure construction/physics/presentation modules
```

Pure modules do not import `Runtime`. Runtime operation functions are generic
over the retained state shape, which avoids circular imports while keeping
ownership in one visible place. Cart/editor code does not belong here; it sends
data through the existing public ingress functions.

## Public contract

`framework/world_loader.zig` preserves the legacy declarations used by the
engine and V8 bindings, including `Runtime`, mount/unmount/render functions,
camera and aiming controls, live piece/mesh/material setters, physics tuning,
paint pointer routing, player model/animation/pose staging, and standalone
`main`.

Adding a subsystem should normally mean:

1. Put its behavior and state records in the narrowest related module.
2. Keep behavior-affecting values named in `config.zig` or a subsystem tuning
   record.
3. Reconcile external/editor input at a frame boundary instead of reaching into
   cart state.
4. Add a Zig-layer test under `framework/testing/unit/`.

## Parity gates

The legacy comparator baseline at the time of this split is:

```text
sha256(world_loader.zig) = dd65fb8da3ef8a6b7d10fd9636e431b48c2c841161ccdd2b0c5680c20eca4509
```

Build both implementations without changing the legacy source:

```bash
zig build app -Dapp-name=world_loader_legacy \
  -Dapp-source=world_loader.zig -Duse-v8=false -Dhas-gpu=true \
  -Doptimize=ReleaseFast

zig build app -Dapp-name=world_loader_refactored \
  -Dapp-source=framework/world_loader.zig -Duse-v8=false -Dhas-gpu=true \
  -Doptimize=ReleaseFast

zig build test-world-loader
```

The one-time fixture construction probe used for this split compared lowered
instance rows, every shape batch, primitive geometry, packed physics input,
initial player/camera state, retained node count, and status text before frame
timing could diverge; all compared values were exact.
Headless captures are also useful side by side, but their falling-player pose
can differ by a few milliseconds of real frame time; PNG byte identity is not a
deterministic gate until the standalone loop gains an explicit fixed-dt test
mode.
