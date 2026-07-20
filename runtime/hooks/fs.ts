/**
 * fs — file system bindings backed by framework/fs.zig.
 *
 * Wraps Zig-registered globals with type-safe helpers. All ops are synchronous
 * — file I/O on local disk is fast and the main thread handles it fine for the
 * sizes typical carts deal with. For long-running work (multi-MB reads, large
 * directory walks), queue it behind a setTimeout(0) so the current frame
 * doesn't stall.
 *
 * Registration (Zig side, in qjs_app.zig:appInit or a shared registerAll):
 *
 *   qjs_runtime.registerHostFn("__fs_read", @ptrCast(&fs_read), 1);
 *   qjs_runtime.registerHostFn("__fs_write", @ptrCast(&fs_write), 2);
 *   qjs_runtime.registerHostFn("__fs_exists", @ptrCast(&fs_exists), 1);
 *   qjs_runtime.registerHostFn("__fs_list_json", @ptrCast(&fs_list_json), 1);
 *   qjs_runtime.registerHostFn("__fs_mkdir", @ptrCast(&fs_mkdir), 1);
 *   qjs_runtime.registerHostFn("__fs_remove", @ptrCast(&fs_remove), 1);
 *   qjs_runtime.registerHostFn("__fs_stat_json", @ptrCast(&fs_stat_json), 1);
 *
 * Paths are absolute or relative to the binary's working directory.
 */

import { callHost, callHostJson } from '../ffi';

/** Read a file as a UTF-8 string. Returns null if the file doesn't exist. */
export function readFile(path: string): string | null {
  return callHost<string | null>('__fs_read', null, path);
}

/** Read a file as base64. Use this for binary payloads. */
export function readFileBase64(path: string): string | null {
  return callHost<string | null>('__fs_read_base64', null, path);
}

/** Read the ENTITIES text lump from an RJMP mapfile through the Zig reader. */
export function readRjmpEntities(path: string): string | null {
  return callHost<string | null>('__fs_read_rjmp_entities', null, path);
}

/** Write a UTF-8 string to a file (creating or truncating). Returns true on success. */
export function writeFile(path: string, content: string): boolean {
  return callHost<boolean>('__fs_write', false, path, content);
}

/** Native per-user application configuration directory. The host creates it
 * before returning. Settings belong here rather than in project data or the
 * SQLite-backed localstore. */
export function configDir(appName: string): string | null {
  return callHost<string | null>('__fs_config_dir', null, appName);
}

/** Atomically write base64-decoded bytes via temp file + fsync + rename. */
export function writeFileBase64Atomic(path: string, contentBase64: string): boolean {
  return callHost<boolean>('__fs_write_base64_atomic', false, path, contentBase64);
}

/** Write a Uint8Array's raw bytes to a file, zero-copy (no base64 / UTF-8
 *  re-encoding). The binary write door — use this for large binary payloads
 *  (game-files, asset blobs) where base64-through-a-string would balloon the
 *  JS heap. Returns true on success. */
export function writeFileBytes(path: string, bytes: Uint8Array): boolean {
  return callHost<boolean>('__fs_write_bytes', false, path, bytes);
}

/** Atomically write a Uint8Array's raw bytes via temp file + fsync + rename (req_1799).
 *  Same zero-copy binary path as writeFileBytes (no base64 heap balloon), but a write
 *  interrupted mid-flight corrupts only the temp — never the live file. Use for critical
 *  artifacts that must not be clobbered by a partial write (the baked game-file). */
export function writeFileBytesAtomic(path: string, bytes: Uint8Array): boolean {
  return callHost<boolean>('__fs_write_bytes_atomic', false, path, bytes);
}

export type AtomicCompareWriteResult = 'written' | 'changed' | 'failed';

/**
 * Install bytes only while the live file still equals the reviewed snapshot.
 * `expected === null` means the review observed that the file did not exist.
 */
export function writeFileBytesAtomicIfUnchanged(
  path: string,
  expected: Uint8Array | null,
  bytes: Uint8Array,
  retainPrevious = true,
): AtomicCompareWriteResult {
  const status = callHost<number>(
    '__fs_write_bytes_atomic_if_unchanged',
    -1,
    path,
    expected,
    bytes,
    retainPrevious ? 1 : 0,
    0,
  );
  return status === 1 ? 'written' : status === 0 ? 'changed' : 'failed';
}

/** Reinstall validated bytes under ownership left by one exact interrupted
 * prepared path. Missing or differently-owned pending state fails closed. */
export function restoreFileBytesAtomicIfUnchanged(
  path: string,
  expected: Uint8Array | null,
  bytes: Uint8Array,
  pendingOwnerPath: string,
  retainPrevious: boolean,
): AtomicCompareWriteResult {
  const status = callHost<number>(
    '__fs_write_bytes_atomic_if_unchanged',
    -1,
    path,
    expected,
    bytes,
    retainPrevious ? 1 : 0,
    1,
    pendingOwnerPath,
  );
  return status === 1 ? 'written' : status === 0 ? 'changed' : 'failed';
}

/** Remove one file and fsync its parent directory so a retired recovery
 * marker cannot reappear after a crash. Directories are intentionally
 * rejected; use `remove` for ordinary recursive cleanup. */
export function removeFileDurable(path: string): boolean {
  return callHost<boolean>('__fs_remove_file_durable', false, path);
}

export type PendingRecoveryFinalizeResult = 'finalized' | 'changed' | 'failed';

/**
 * Finish an interrupted transaction under its target lock: recheck exact
 * target bytes and marker ownership, retire the replay temp and optional
 * predecessor, then durably remove pending ownership last.
 */
export function finalizePendingRecovery(
  path: string,
  expected: Uint8Array,
  preparedPath: string,
  retirePrevious: boolean,
): PendingRecoveryFinalizeResult {
  const status = callHost<number>(
    '__fs_finalize_pending_recovery',
    -1,
    path,
    expected,
    preparedPath,
    retirePrevious ? 1 : 0,
  );
  return status === 1 ? 'finalized' : status === 0 ? 'changed' : 'failed';
}

/** True if a file or directory exists at `path`. */
export function exists(path: string): boolean {
  return callHost<boolean>('__fs_exists', false, path);
}

/** List direct children of a directory (names only, no full paths). Empty array if not a directory. */
export function listDir(path: string): string[] {
  return callHostJson<string[]>('__fs_list_json', [], path);
}

/** Create a directory (and parents as needed). */
export function mkdir(path: string): boolean {
  return callHost<boolean>('__fs_mkdir', false, path);
}

/** Remove a file or a directory tree recursively. */
export function remove(path: string): boolean {
  return callHost<boolean>('__fs_remove', false, path);
}

export interface FsStat {
  size: number;
  mtimeMs: number;
  isDir: boolean;
}

/** Stat a file. Returns null if not found. */
export function stat(path: string): FsStat | null {
  return callHostJson<FsStat | null>('__fs_stat_json', null, path);
}
