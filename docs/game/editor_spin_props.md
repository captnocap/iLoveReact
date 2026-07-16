# Editor spinning props (Spin quick verb)

Active surface: `cart/editor/` world document + its live loader viewports.
Last verified: 2026-07-15. USER ASK req_3128.

## In one sentence

Spin is a quick verb on a placed AUTHORED prop (right-click menu / Build →
Spin Piece): the prop turns continuously about its placement anchor at one
shared sign rate — the rotating business-sign — while its collider, door
state, and placement identity keep the authored yaw.

## Why it exists

The user's ask (req_3128): a giant export of a modeled prop (the bong) mounted
"as a business sign … that is just spinning around and is on some platform
above the door." Everything else about the sign (the giant export, the
platform, the placement) already existed; the missing capability was a
continuous per-placement rotation.

Design follows the ticker/traffic law (`docs/game` animated-content pattern):
**animation is visual-only** — physics, door machines, and the coincident
baked-hide key all read the authored yaw; only the drawn transform animates.

## Mechanism (host fn vs JS, file:line)

- `cart/editor/world/pieces.ts` — `PlacedPiece.spinDegPerSec?: number`
  (absent/0 = static; negative = counter-clockwise) and the one shared rate
  `PIECE_SPIN_RATE_DEG_PER_SEC = 45` (a storefront-sign turn). Persists with
  the map (`data/worldStore.ts` validates finite).
- `cart/editor/world/pieceEditCommand.ts planPieceSpin` — the undoable
  transaction (`world.piece.spin`, action `'spin'`): sets or (rate 0) deletes
  the field IN PLACE — no destination victims, no list churn. Registered in
  `data/applicationCommands.ts` (icon Orbit) beside move/rotate/delete;
  outcomes ride the same `piece.edit` eventbus type.
- `cart/editor/stage/WorldContextMenu.tsx` — the quick menu grows a
  `Spin` / `Stop Spin` row for AUTHORED pieces only (catalog boxes render as
  live instance rows, not mesh refs, and would ignore it); the header readout
  shows `yaw° · rate°/s` while spinning. `shell/AppFrame.tsx` routes the verb
  as a toggle: current rate ≠ 0 → 0, else the shared rate.
- `cart/editor/world/meshProps.ts encodeMeshRefsV2` — the v2 live-mesh wire:
  28-byte header per ref (u32 keyHash, f32 x,y,z,yaw,**spin**, u32 matCount).
  `world/livePush.ts` prefers the v2 door and falls back to the v1 24-byte
  encode (spin dropped, loud console.warn) when the host predates it.
- HOST `framework/v8_bindings_compiled_world.zig
  __compiled_world_set_live_mesh_props2` →
  `framework/world_loader/live_inputs.zig setLiveMeshProps2` — decodes the v2
  header into `LiveMeshRef.spin_deg_per_sec` (one shared walker with the v1
  door; presence-gating IS the version negotiation, the repo's door law).
- HOST render `framework/world_loader/runtime_live_scene.zig
  appendLiveMeshRef` — the live mesh-prop draw tail is rebuilt EVERY frame at
  the end of `stepNow`, so spin is pure arithmetic at append time:
  `draw_yaw = mod(yaw + spin_deg_per_sec × live_spin_seconds, 360)`. The
  clock (`Runtime.live_spin_seconds`, `runtime_stream.zig stepNow`) advances
  with the same clamped dt as tickers/traffic. Door identity
  (`live_mesh_doors.identity`), the RESKIN coincident-hide key
  (`meshPosKey`), and live colliders all still read the authored `r.yaw`.

## Reach

Both live consumers of the one push (`livePush.ts pushLiveWorld`) spin: the
iso world viewport and the playtest tab. The BAKED gamefile path
(`constructor.zig MeshPropInstance`) does not carry spin yet — when the new
compile lane lands, spin needs a field in the baked instance record plus a
step over baked node ranges (the cooked-door pattern). Ghost refs
(`encodeMeshGhost`) intentionally stay static.

## Proven by

- `cart/editor/world/pieceEditCommand.test.ts` — spin sets/clears in place,
  preserves slots/overrides/transform/order, exact undo round-trip, rejects
  no-ops and non-finite rates.
- `cart/editor/world/meshProps.test.ts` — v2 wire offsets (spin@20,
  matCount@24, stride 28) and the v1 stride staying 24 so an older host never
  misparses.
