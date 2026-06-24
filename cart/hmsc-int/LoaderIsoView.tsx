// LoaderIsoView — the iso authoring viewport rendered by the NATIVE world_loader
// instead of a React Scene3D rebuild (LOADERVIEW req_1757).
//
// Why this exists: booting the editor's iso pane through React's 3D path serialized
// ~683MB of mesh/instance/texture data across the host bridge every time (measured —
// the "I MADE IT" probe). The compiled game loads the SAME static world from a gamefile
// in one native read with zero of that traffic. This pane mounts that loader inline
// (<WorldLoader>) and drives its camera from the editor's IsoStage, so the static world
// costs a single read — React keeps only the editing affordances on top.
//
// Camera: JS owns the solve. We push IsoStage.solve()'s eye+look+fov to the loader via
// __compiled_world_set_camera each frame; the host snaps to it (world_loader.zig
// setExternalCamera). Because it's the SAME GAME_CAMERA.solve(Isometric) pose the
// picking math uses, the rendered view matches the cursor ray by construction.
//
// SIDE-BY-SIDE (req_1757, swap-safety): this is an OPT-IN alternate to <IsoAuthor>,
// off by default. It renders + camera-controls the world; picking/placement overlay is
// a later step. The React IsoAuthor path is untouched until the user flips the default.

import { createElement, useCallback, useEffect, useRef } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { IsoStage } from './isoStage';

const g: any = globalThis;

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

export function LoaderIsoView(props: {
  gameFile?: string;
  storeDir?: string;
  centerX?: number;
  centerZ?: number;
}) {
  const gameFile = props.gameFile ?? DEFAULT_GAME_FILE;
  const storeDir = props.storeDir ?? DEFAULT_STORE_DIR;

  const loaderRef = useRef<any>(null);
  const rectRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 1, height: 1 });

  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) {
    stageRef.current = new IsoStage(
      { centerX: props.centerX ?? 0, centerZ: props.centerZ ?? 0, zoom: 1, level: 0 },
      () => 0,
    );
  }
  const stage = stageRef.current;

  // Push the JS-solved iso pose to the native loader's camera. Cheap (8 floats) — this
  // is the ONLY per-frame bridge traffic, vs the ~683MB the React scene shipped.
  const pushCamera = useCallback(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_camera !== 'function') return;
    const s: any = stage.solve();
    g.__compiled_world_set_camera(
      nodeId,
      s.pos[0], s.pos[1], s.pos[2],
      s.target[0], s.target[1], s.target[2],
      s.fov,
    );
  }, [stage]);

  // The loader mounts lazily on its first embedded render and re-mounts when the gamefile
  // changes (a Compile). A per-frame push keeps the external camera applied across both,
  // with no flash of the player-trailing camera.
  useEffect(() => {
    let alive = true;
    pushCamera(); // once synchronously — the host pending table holds it across the lazy
                  // mount, so a frame loop isn't required (and headless has no rAF).
    const tick = () => {
      if (!alive) return;
      pushCamera();
      g.requestAnimationFrame?.(tick);
    };
    g.requestAnimationFrame?.(tick);
    return () => {
      alive = false;
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (nodeId && typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    };
  }, [pushCamera]);

  // ── pointer: left-drag rotates the view, wheel zooms toward the cursor ──────────
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const local = useCallback((e: any) => {
    const r = rectRef.current;
    const mx = Number(g.getMouseX?.() ?? (e?.x ?? r.x + r.width / 2));
    const my = Number(g.getMouseY?.() ?? (e?.y ?? r.y + r.height / 2));
    return { mx, my };
  }, []);
  const onDown = useCallback((e: any) => { const { mx, my } = local(e); dragRef.current = { x: mx, y: my }; }, [local]);
  const onMove = useCallback((e: any) => {
    if (!dragRef.current) return;
    const { mx } = local(e);
    const dx = mx - dragRef.current.x;
    dragRef.current.x = mx;
    if (dx) { stage.rotateBy(dx * 0.4); pushCamera(); }
  }, [local, stage, pushCamera]);
  const onUp = useCallback(() => { dragRef.current = null; }, []);

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}
      onLayout={(e: any) => {
        const l = e?.layout ?? e;
        if (l && Number.isFinite(l.width)) rectRef.current = { x: l.x ?? 0, y: l.y ?? 0, width: l.width, height: l.height };
      }}
    >
      {createElement('WorldLoader', {
        ref: loaderRef,
        gameFile,
        storeDir,
        testID: 'loader-iso-view',
        style: { width: '100%', height: '100%' },
      })}

      {/* pointer capture (near-transparent so it's hittable), same idiom as IsoAuthor */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={(e: any) => {
          const d = Number(e?.deltaY ?? 0);
          if (!d) return;
          const r = rectRef.current;
          const mx = Number(g.getMouseX?.() ?? (r.x + r.width / 2));
          const my = Number(g.getMouseY?.() ?? (r.y + r.height / 2));
          stage.zoomToCursor(mx - r.x, my - r.y, d > 0 ? 1.15 : 1 / 1.15, r);
          pushCamera();
        }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />
    </Box>
  );
}
