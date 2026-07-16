import type { DocIndex } from '../types';

export const editor_spin_props: DocIndex = {
  name: 'editor_spin_props',
  file: 'editor_spin_props.md',
  cart: 'cart/editor/world/pieceEditCommand.ts',
  purpose: ['building', 'animation', 'rendering'],
  summary:
    'Spin quick verb (req_3128): a placed AUTHORED prop turns continuously about its placement anchor at the one shared sign rate (45°/s toggle) — the rotating business-sign. Visual-only per the ticker/traffic law: the live loader draws yaw + rate×clock while colliders, door state, and placement identity keep the authored yaw. Rides a v2 live-mesh wire (28-byte header carrying spinDegPerSec) behind its own presence-gated host door, so an older host keeps rendering via v1 with spin dropped.',
  interfaces: [
    {
      name: 'planPieceSpin (world.piece.spin)',
      purpose: ['building', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/pieceEditCommand.ts',
      description:
        'The undoable spin transaction: sets or (rate 0) deletes PlacedPiece.spinDegPerSec IN PLACE — no destination victims, no list churn; exact forward/inverse patches like move/rotate. Registered in data/applicationCommands.ts (icon Orbit) and routed as a toggle by AppFrame (current ≠ 0 → 0, else PIECE_SPIN_RATE_DEG_PER_SEC = 45 from world/pieces.ts). The WorldContextMenu shows Spin/Stop Spin for authored pieces only — catalog boxes render as instance rows, not mesh refs, and would ignore it.',
      dependsOn: ['cart/editor/world/pieces.ts PlacedPiece.spinDegPerSec', 'cart/editor/data/applicationCommands.ts'],
      consumers: ['cart/editor/shell/AppFrame.tsx', 'cart/editor/stage/WorldContextMenu.tsx'],
      status: 'live',
    },
    {
      name: 'live-mesh v2 wire (encodeMeshRefsV2 → __compiled_world_set_live_mesh_props2)',
      purpose: ['rendering', 'animation'],
      kind: 'host_fn',
      sourceFile: 'framework/world_loader/live_inputs.zig',
      description:
        '28-byte header per ref: u32 keyHash, f32 x,y,z,yaw,spinDegPerSec, u32 matCount (then matCount×u32). setLiveMeshProps2 shares one walker with the v1 door; livePush.ts presence-gates — the v2 door when the host has it, else the v1 24-byte encode with spin dropped and a loud warn. appendLiveMeshRef (runtime_live_scene.zig) draws mod(yaw + spin×Runtime.live_spin_seconds, 360) — the live draw tail is rebuilt every frame, so spin is pure arithmetic at append time. Door identity, the RESKIN coincident-hide key, and live colliders all keep the authored yaw.',
      dependsOn: ['cart/editor/world/meshProps.ts encodeMeshRefsV2', 'framework/world_loader/runtime_stream.zig stepNow clock'],
      consumers: ['cart/editor/world/livePush.ts pushLiveWorld'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'prop animation is visual-only, identity keeps the authored transform',
      purpose: ['animation', 'physics'],
      description:
        'The ticker/traffic/cooked-door law extended to placed props: anything identity-shaped (physics colliders, door state reconciliation, baked-hide position keys) reads the authored yaw; only the drawn node transform animates. Spinning a prop never moves its collider.',
      examples: ['editor_spin_props', 'game_world'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'baked gamefile path does not spin yet',
      purpose: ['building', 'animation'],
      description:
        'Spin rides only the LIVE mesh-ref push (iso viewport + playtest tab — the whole active render path today). The baked MeshPropInstance record (constructor.zig) has no spin field; when the editor compile lane lands, the bake needs the field plus a per-frame step over baked node ranges (the cooked-door pattern), or a compiled world drops every sign to static.',
      evidence: ['docs/game/editor_spin_props.md "Reach"'],
      severity: 'medium',
    },
  ],
};
