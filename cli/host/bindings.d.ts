// cli/host/bindings.d.ts - typed contract for the v8cli host functions.

declare global {
  function __argv(): string;
  function __env(name: string): string | null;
  function __exit(code: number): void;
  function __cwd(): string;
  /** This process's own pid. A script that scans the process table needs it to
   *  exclude itself — self-matching is the whole hazard class behind `pkill -f`. */
  function __pid(): number;
  function __nowMs(): number;
  function __sleepMs(ms: number): void;
  function __writeStdout(text: string): void;
  function __writeStderr(text: string): void;
  function __setStdinRaw(enable: number): boolean;
  function __readStdin(): string;
  function __termSize(): string;
  function __spawnSync(cmd: string, argsJson: string, stdin: string): string;
  function __spawn(cmd: string, argsJson: string): number;
  function __childReadLine(id: number, timeoutMs: number): string | null;
  function __childKill(id: number): boolean;
  function __unixConnect(path: string): number;
  function __unixWrite(fd: number, data: string): number;
  function __unixReadAll(fd: number, timeoutMs: number, maxBytes: number): string | null;
  function __unixClose(fd: number): void;
  function __hotGet(key: string): string | null;
  function __hotSet(key: string, value: string): void;
  function __hotRemove(key: string): void;
  function __hotClear(): void;
  function __hotKeys(): string;

  function __fs_read(path: string): string | null;
  function __fs_read_base64(path: string): string | null;
  function __fs_read_rjmp_entities(path: string): string | null;
  function __fs_write(path: string, content: string): boolean;
  function __fs_write_base64_atomic(path: string, contentBase64: string): boolean;
  function __fs_exists(path: string): boolean;
  function __fs_list_json(path: string): string;
  function __fs_stat_json(path: string): string | null;
  function __fs_mkdir(path: string): boolean;
  function __fs_remove(path: string): boolean;
  function __fs_readfile(path: string): string;
  function __fs_writefile(path: string, content: string): number;
  function __fs_deletefile(path: string): number;
  function __fs_scandir(path: string): string[];
  function __fs_media_scan_json(dir: string, recursive?: boolean, maxDepth?: number): string;
  function __fs_media_stats_json(dir: string, recursive?: boolean, maxDepth?: number): string;
  function __fs_media_index_json(dir: string, recursive?: boolean, maxDepth?: number): string;

  function __proc_spawn(specJson: string): number;
  function __proc_kill(pid: number, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGHUP' | 'SIGINT'): boolean;
  function __proc_stdin_write(pid: number, data: string): boolean;
  function __proc_stdin_close(pid: number): void;
  function __proc_stat(pid: number): string | null;
  function __proc_watch_add(pid: number, intervalMs: number): void;
  function __proc_watch_remove(pid: number): void;

  const console: {
    log: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  const process: {
    readonly argv: string[];
    readonly env: Record<string, string | undefined>;
    exit: (code: number) => void;
    cwd: () => string;
    readonly platform: 'linux';
  };
}

export {};
