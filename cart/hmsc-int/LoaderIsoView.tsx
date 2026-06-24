// LoaderIsoView — the iso authoring viewport rendered by the NATIVE world_loader
// instead of a React Scene3D rebuild (LOADERVIEW req_1757/req_1769).
//
// Why this exists: booting the editor's iso pane through React's 3D path serialized
// ~683MB of mesh/instance/texture data across the host bridge every time (measured —
// the "I MADE IT" probe), which made the big 'main' map take ~30s and render blank. The
// compiled game loads the SAME static world from a gamefile in one native read. This
// pane mounts that loader inline (<WorldLoader>) and drives its camera from the editor's
// IsoStage — boot dropped to ~3s and the world renders.
//
// Camera: JS owns the solve. We push IsoStage.solve()'s eye+look+fov to the loader via
// __compiled_world_set_camera each frame; the host snaps to it (world_loader.zig
// setExternalCamera). It's the SAME GAME_CAMERA.solve(Isometric) pose IsoAuthor uses, so
// picking (when wired) matches the render by construction. Controls mirror IsoAuthor:
// drag rotates (yaw from horizontal motion), WASD/arrows pan (stage.nudge), wheel zooms.
//
// NOTE (rule-of-two): the control logic here is intentionally the same shape as
// IsoAuthor's. If a third consumer appears, extract a useIsoCameraControls(stage, …) hook.

import { createElement, useCallback, useEffect, useRef } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { IsoStage } from './isoStage';
import { editorTypingFocused } from './editors/controls';

const g: any = globalThis;

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

// key → pan axis. Arrows alias WASD, matching the iso-build legend.
const PAN_KEYS: Record<string, string> = {
  w: 'w', a: 'a', s: 's', d: 'd',
  arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd',
};

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

  // Keys: subscribe the key bus DIRECTLY (req_1777) rather than the editor control
  // contract. The contract's active/scope arbitration was swallowing WASD here (it
  // worked for IsoAuthor but not this pane); the raw bus is the same source the host
  // feeds and removes every middle layer. Still honor the typing gate so WASD in a
  // text field (the texture search, the tile box) types, not pans. Held WASD/arrows
  // pan; Q/E orbit; F/Home recenter.
  const heldPanRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const onKey = (down: boolean) => (e: any) => {
      const k = String(e?.key ?? '').toLowerCase();
      const axis = PAN_KEYS[k];
      if (axis) {
        if (down && editorTypingFocused()) return; // let the focused field have the key
        heldPanRef.current[axis] = down;
        return;
      }
      if (!down || editorTypingFocused()) return;
      if (k === 'q') { stage.rotate(-1); pushCamera(); }
      else if (k === 'e') { stage.rotate(1); pushCamera(); }
      else if (k === 'f' || k === 'home') { stage.centerOn(props.centerX ?? 0, props.centerZ ?? 0); pushCamera(); }
    };
    const offDown = busOn('__keydown', onKey(true));
    const offUp = busOn('__keyup', onKey(false));
    return () => { offDown(); offUp(); heldPanRef.current = {}; };
  }, [stage, pushCamera, props.centerX, props.centerZ]);

  // The held-key pan loop. Scheduled via rAF OR a setTimeout FALLBACK — exactly like
  // IsoAuthor (req_1777): this host doesn't always expose requestAnimationFrame as a
  // global, so a bare rAF call silently never ran and WASD did nothing.
  //
  // PERF (req_1790/1791 "lags like shit"): push the camera to the host ONLY when the
  // pose actually changes — while WASD is held. The host pending-camera table re-applies
  // the last pose every frame on its own, so an idle per-frame push was 60 wasted bridge
  // calls/sec. Drag/zoom push directly; the loop pushes only while panning.
  useEffect(() => {
    const sched: (fn: () => void) => any = g.requestAnimationFrame
      ? g.requestAnimationFrame.bind(g)
      : (fn: () => void) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? 0;
    pushCamera(); // once synchronously so the pose is set before the first paint
    const tick = () => {
      if (!alive) return;
      const now = g.performance?.now?.() ?? last + 16;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const held = heldPanRef.current;
      const forward = (held.w ? 1 : 0) - (held.s ? 1 : 0);
      const strafe = (held.d ? 1 : 0) - (held.a ? 1 : 0);
      if (forward || strafe) {
        const speed = Math.max(18, stage.distance() * 0.85); // m/s, scales with zoom
        stage.nudge(forward * speed * dt, strafe * speed * dt);
        pushCamera(); // only when the pose moved this frame
      }
      sched(tick);
    };
    sched(tick);
    return () => {
      alive = false;
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (nodeId && typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    };
  }, [pushCamera, stage]);

  // ── pointer: left-drag rotates the view (yaw from horizontal motion) ────────────
  // Pane-relative cursor from the event itself (e.x − rect.x), exactly like IsoAuthor —
  // the host fires move events with real coords; getMouseX() is for passive polling.
  const dragRef = useRef<{ x: number } | null>(null);
  const local = useCallback((e: any) => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  }, []);
  const onDown = useCallback((e: any) => { dragRef.current = { x: local(e).x }; }, [local]);
  const onMove = useCallback((e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const p = local(e);
    if (p.x !== d.x) { stage.rotateBy((p.x - d.x) * 0.3); d.x = p.x; pushCamera(); }
  }, [local, stage, pushCamera]);
  const onUp = useCallback(() => { dragRef.current = null; }, []);

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
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
