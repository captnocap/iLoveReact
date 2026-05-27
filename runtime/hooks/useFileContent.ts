// useFileContent(path) — loads a file into a Zig-owned buffer and returns a
// numeric handle. Pass the handle as `contentHandle` to a TextEditor
// primitive; the primitive reads the bytes directly from the Zig buffer, so
// the file's content never crosses the JS bridge.
//
// This is the fix for "clicking a large file takes 2+ seconds because the
// bundle serializes the whole `value` string to JSON on every render." With
// a handle, the prop diff is 8 bytes instead of 1 MB.
//
// Lifetime: the buffer is reference-counted only at the hook level — the
// effect's cleanup releases the handle when `path` changes or the caller
// unmounts. There is exactly one TextEditor reading per handle by design.
// If you need the same buffer in multiple places, load it twice.
import { useEffect, useState } from 'react';
import { callHost, hasHost } from '../ffi';

export function useFileContent(path: string | null | undefined): number {
  const [handle, setHandle] = useState(0);

  useEffect(() => {
    if (!path || path === '__landing__' || path === '__settings__') {
      setHandle(0);
      return;
    }
    if (!hasHost('__hostLoadFileToBuffer')) {
      setHandle(0);
      return;
    }
    const h = callHost<number>('__hostLoadFileToBuffer', 0, path) | 0;
    setHandle(h);
    return () => {
      if (h > 0) callHost('__hostReleaseFileBuffer', undefined, h);
    };
  }, [path]);

  return handle;
}
