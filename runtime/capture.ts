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
