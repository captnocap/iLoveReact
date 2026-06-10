import { memo, useEffect, useMemo, useState } from 'react';
import { Box, Effect, StaticSurface, Video } from '@reactjit/primitives';
import type { Building } from '../design';
import { driveInScreenTextureKey } from '../world/structures';
import { getDriveInSource, useDriveInSources } from '../state/driveInScreens';

// Live capture for every drive-in screen — the billboard_demo / game_item_gallery
// pattern: an animated 2D source is rendered into an offscreen <StaticSurface>,
// and the screen mesh in render3d/structures/DriveIn samples that texture by key.
// Mounted in HmscGameplayRig as a sibling of <Scene3D> (the 2D tree), parked
// off-screen — only the captured textures matter. One capture per drive-in.
//
// Two states:
//   • no movie picked → an animated plasma <Effect> (the proven billboard bb-fx
//     surface). This is ALSO the diagnostic: if the wall shows moving plasma, the
//     live StaticSurface→mesh path works here and <Video> is the specific issue.
//   • movie picked → a <Video>, with a 1px driver <Effect> forcing the re-bake.

// Screen panel is ~38m × 16m (~2.4:1); match that aspect, under the ~900px cap.
const SCREEN_W = 720;
const SCREEN_H = 304;
const SCREEN_REFRESH_MS = 33; // ~30fps re-capture

// Animated plasma — byte-for-byte the billboard_demo bb-fx shader (the known-good
// "Effect on a mesh" surface). No unary + in WGSL; no backticks in comments.
const FX_SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = ys[0];
  let uv = in.uv;
  let r = 0.5 + 0.5 * sin(t + uv.x * 6.2831);
  let g = 0.5 + 0.5 * sin(t * 1.3 + uv.y * 6.2831 + 2.0);
  let b = 0.5 + 0.5 * sin(t * 0.7 + (uv.x + uv.y) * 5.0 + 4.0);
  return vec4f(r, g, b, 1.0);
}
`;

// 1px transparent quad whose data changes each tick — mounting it inside the
// StaticSurface forces a reconciler UPDATE so gpu.zig RE-BAKES the surface (the
// captured texture would otherwise freeze on the first <Video> frame). Alpha 0
// so it never tints the movie.
const DRIVER_SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let keep = ys[0] * 0.0;
  return vec4f(0.0, 0.0, 0.0, keep);
}
`;

const DriveInScreenCapture = memo(function DriveInScreenCapture(props: { buildingId: string }) {
  useDriveInSources(); // re-render when this screen's source changes
  const src = getDriveInSource(props.buildingId);
  const [frame, setFrame] = useState(0);

  // Tick every frame so the source animates and the surface re-bakes (the
  // billboard cadence). Runs whether or not a movie is picked — the plasma
  // intermission animates too.
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, SCREEN_REFRESH_MS);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    const loop = () => { setFrame((n) => (n + 1) & 0xffffff); handle = sched(loop); };
    handle = sched(loop);
    return () => cancel(handle);
  }, []);

  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: SCREEN_W, height: SCREEN_H }),
    [],
  );
  const fxStyle = useMemo(() => ({ width: SCREEN_W, height: SCREEN_H }), []);
  const driverStyle = useMemo(
    () => ({ position: 'absolute' as const, left: 0, top: 0, width: 1, height: 1 }),
    [],
  );

  return (
    <StaticSurface staticKey={driveInScreenTextureKey(props.buildingId)} style={surfaceStyle}>
      {src ? (
        <>
          <Video src={src} loop paused={false} style={{ width: '100%', height: '100%' }} />
          <Effect shader={DRIVER_SHADER} data={[frame]} style={driverStyle} />
        </>
      ) : (
        // Intermission / diagnostic: the proven billboard plasma. If THIS animates
        // on the wall, the live texture-on-mesh path works and <Video> is the issue.
        <Effect shader={FX_SHADER} data={[frame * 0.05]} style={fxStyle} />
      )}
    </StaticSurface>
  );
});

// DIAGNOSTIC: a small on-screen <Video> of the same src, drawn directly (NOT
// through a capture). Compare it to the wall:
//   • preview plays, wall freezes  → the capture path is the problem.
//   • both freeze after ~2 frames   → videos.zig stops feeding frames (the
//                                      drive-in capture is not the cause).
// It also paints the video EVERY frame on-screen, which keeps the engine's
// playback entry hot — so if the wall comes alive too, "video must be painted
// every frame" is the fix and we fold that guarantee into the capture.
const DriveInDebugPreview = memo(function DriveInDebugPreview(props: { buildingId: string }) {
  useDriveInSources();
  const src = getDriveInSource(props.buildingId);
  if (!src) return null;
  return (
    <Box style={{ position: 'absolute', right: 12, bottom: 12, width: 256, height: 144, zIndex: 50, borderWidth: 2, borderColor: '#f59e0b', backgroundColor: '#000' }}>
      <Video src={src} loop paused={false} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
});

// Offscreen captures (one per drive-in) → the screen meshes' live textures.
// Memoized so it only re-renders when the buildings list changes — not on every
// player/camera frame (the captures' own ticks drive their re-bake).
export const DriveInScreenCaptures = memo(function DriveInScreenCaptures(props: { buildings: Building[] }) {
  const driveIns = props.buildings.filter((b) => b.kind === 'driveIn');
  if (driveIns.length === 0) return null;
  return (
    <>
      {driveIns.map((b) => (
        <DriveInScreenCapture key={driveInScreenTextureKey(b.id)} buildingId={b.id} />
      ))}
      {driveIns.map((b) => (
        <DriveInDebugPreview key={`preview-${b.id}`} buildingId={b.id} />
      ))}
    </>
  );
});
