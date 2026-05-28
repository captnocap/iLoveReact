// cli/host/fs.ts - typed, throwing wrappers over __fs_*.

export class FsError extends Error {
  constructor(public op: string, public path: string, message?: string) {
    super(`fs ${op} failed: ${path}${message ? ': ' + message : ''}`);
  }
}

export function fsRead(path: string): string {
  const result = __fs_read(path);
  if (result === null) throw new FsError('read', path);
  return result;
}

export function tryFsRead(path: string): string | null {
  return __fs_read(path);
}

export function fsWrite(path: string, content: string): void {
  if (!__fs_write(path, content)) throw new FsError('write', path);
}

export function fsExists(path: string): boolean {
  return __fs_exists(path);
}

export interface FsStat {
  size: number;
  mtimeMs: number;
  isDir: boolean;
}

export function fsStat(path: string): FsStat {
  const result = __fs_stat_json(path);
  if (result === null) throw new FsError('stat', path);
  return JSON.parse(result) as FsStat;
}

export function tryFsStat(path: string): FsStat | null {
  const result = __fs_stat_json(path);
  return result === null ? null : (JSON.parse(result) as FsStat);
}

export function fsList(path: string): string[] {
  return JSON.parse(__fs_list_json(path)) as string[];
}

export function fsMkdir(path: string): void {
  if (!__fs_mkdir(path)) throw new FsError('mkdir', path);
}

export function fsRemove(path: string): void {
  if (!__fs_remove(path)) throw new FsError('remove', path);
}

export function fsReadJson<T>(path: string): T {
  const raw = fsRead(path);
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new FsError('parse-json', path, (error as Error).message);
  }
}
