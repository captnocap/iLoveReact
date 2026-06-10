// runtime/capture.ts — the frame self-capture door (SELFSHOT-0606).
//
// USER RULING (2026-06-06): desktop/X11 capture of the user's system is
// BANNED — "make a command to get the proper screenshot of whatever u need,
// dont look at the system." The app screenshots ITSELF: __capture_frame
// reads back the frame the GPU already composed (framework/gpu/capture.zig)
// and writes it as a PNG. Nothing here ever touches the desktop.
//
// Importing this module is the metafile-gate trigger for -Dhas-capture
// (sdk/dependency-registry.json "frame-capture") — the source-driven
// bundling law: the binding compiles in iff a shipped file imports this door.

import { callHost } from './ffi';

/** Queue a one-shot capture of the NEXT rendered frame to a PNG at `path`.
 *  Returns true when the host accepted the request — the PNG lands within a
 *  frame or two (the host logs `SCREENSHOT_SAVED:<path>` once it's on disk).
 *  False: empty/oversized path, the F9 recorder owns the capture hook, or
 *  no GPU host (headless verify boots — callers degrade gracefully). */
export function captureFrame(path: string): boolean {
  if (!path) return false;
  return callHost<boolean>('__capture_frame', false, path);
}

/** A captured StaticSurface's pixels, read back from the GPU. `width`/`height`
 *  are the TEXTURE's dimensions (the engine may capture at a DPI multiple of
 *  the node's logical size); `rgba` is tight width*4-byte rows. */
export type SurfacePixels = { width: number; height: number; rgba: Uint8Array };

/** Read a captured `<StaticSurface staticKey>` back to pixels (DECALPIX-0610:
 *  the decal pixel bake — the editor executes authored content once and ships
 *  the pixels). Null until the surface has actually captured — mount it, give
 *  the engine a frame or two, and poll. Blocks on the GPU copy, so this is a
 *  save/bake-point door, never a per-frame one. */
export function readSurfacePixels(staticKey: string): SurfacePixels | null {
  if (!staticKey) return null;
  const raw = callHost<Uint8Array | null>('__capture_surface_pixels', null, staticKey);
  if (!raw || raw.length < 8) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  if (width === 0 || height === 0 || raw.length !== 8 + width * height * 4) return null;
  return { width, height, rgba: raw.subarray(8) };
}
