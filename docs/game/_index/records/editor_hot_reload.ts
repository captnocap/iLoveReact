import type { DocIndex } from '../types';

export const editor_hot_reload: DocIndex = {
  name: 'editor_hot_reload',
  file: 'editor_hot_reload.md',
  cart: 'cart/editor/stage/ModelView.tsx',
  purpose: ['ui', 'persistence', 'interaction'],
  summary:
    'Hot-reload state survival (req_2898): the Zig process outlives every dev reload, so the editor mirrors working state into framework/state/hotstate.zig twigs and ADOPTS the host\'s still-live mesh session on remount — current edits, undo journal, paint atlas, mesh camera, world iso camera, and tool/brush state all survive a code save. Cold restart stays clean by design (twigs are in-process); the named world save / meshdoc autosaves remain the durable layer.',
  interfaces: [
    {
      name: '__model_session_json',
      purpose: ['host_bridge', 'persistence'],
      kind: 'host_fn',
      sourceFile: 'framework/gpu/3d.zig',
      description:
        'Readback of the resident mesh-editor session: edit mesh key/count, orbit radius, undo/redo depths, atlas presence ("" when nothing loaded). Pure readback — the remounted viewer compares it against its hot doc twig to decide resume-vs-load.',
      consumers: ['cart/editor/stage/ModelView.tsx'],
      status: 'live',
    },
    {
      name: 'resumeHostSession (DOC twig editor:meshdoc:v1)',
      purpose: ['persistence', 'interaction'],
      kind: 'utility',
      sourceFile: 'cart/editor/stage/ModelView.tsx',
      description:
        'On mount: doc twig {docId, key} matching the host session key ⇒ adopt the live session (setModel from readback, resync part ranges, mirror host selection, re-enter paint when the atlas is live) — the load doors never fire, so meshJournalClear/orbitFrame never wipe the undo journal or the camera. Twig re-stamps on every mesh adopt (topology ops re-key). Mismatch ⇒ the normal seed load, exactly as before.',
      dependsOn: ['__model_session_json', 'useHotState (framework/state/hotstate.zig)'],
      status: 'live',
    },
    {
      name: 'TOOL twig (editor:meshtool:v1) + ISO pose twig (editor:isopose:v1)',
      purpose: ['persistence', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/editor/world/WorldViewport.tsx',
      description:
        'ModelView seeds wire/camLock/gizmo/mirror/brush/palette/safety/detail/lights/paint-mode from its tool twig (written on every change); WorldViewport seeds IsoStage.pose from the iso twig (written on every camera push). Paint MODE only re-arms when the resumed session confirms a live atlas.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'host outlives the JS world — resume, never re-seed',
      purpose: ['persistence'],
      description:
        'Anything living host-side (edit mesh, journal, atlas, orbit) already survives a hot reload; the bug was the remount re-LOADING seeds over it. Preserving state = detecting "the host still holds my document" (hot twig + session readback) and adopting, not copying state through JS. New editor state should join an existing twig or the session readback, never invent a parallel store.',
      examples: ['editor_hot_reload'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'doc twig must track every mesh re-key',
      purpose: ['persistence'],
      description:
        'Topology ops re-key the host mesh; the doc twig is stamped by an effect on model.key. A new adopt path that sets model state without going through setModel (or that bypasses the effect) would leave a stale twig key and silently disable resume for that doc — the fallback is a normal load (safe, but the edits-survival promise breaks). Proven live by the meshops `session` op (twig tracked primitive:cube:19 → modelview-edit-…-1, match=true).',
      evidence: ['cart/editor/stage/ModelView.tsx'],
      severity: 'low',
    },
  ],
};
