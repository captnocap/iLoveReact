/**
 * useProcess — React hook for child-process lifetime.
 *
 * Extracted from useHost because process spawn is not inbound internet hosting.
 * Tier 1 wrapper over the process primitives in ./process.ts.
 */

import { useEffect, useRef, useState } from 'react';
import { spawn, kill, stdinWrite, stdinClose, onStdout, onStderr, onExit } from './process';

export type ProcessState = 'starting' | 'running' | 'stopped' | 'error';

export interface UseProcessSpec {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'pipe' | 'inherit' | 'ignore';
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onExit?: (res: { code: number; signal: string | null }) => void;
}

export interface UseProcessHandle {
  pid: number;
  state: ProcessState;
  error?: string;
  stop(): void;
  stdin(data: string): void;
  stdinClose(): void;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}

export function useProcess(spec: UseProcessSpec): UseProcessHandle {
  const [state, setState] = useState<ProcessState>('starting');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pid, setPid] = useState<number>(0);
  const pidRef = useRef<number>(0);
  pidRef.current = pid;

  const specRef = useRef(spec);
  specRef.current = spec;

  const procKey = JSON.stringify({
    cmd: spec.cmd,
    args: spec.args ?? [],
    cwd: spec.cwd ?? '',
    env: spec.env ?? {},
    stdin: spec.stdin ?? 'pipe',
  });

  useEffect(() => {
    let cancelled = false;
    const spawnedPid = spawn({
      cmd: specRef.current.cmd,
      args: specRef.current.args,
      cwd: specRef.current.cwd,
      env: specRef.current.env,
      stdin: specRef.current.stdin,
    });

    if (spawnedPid <= 0) {
      setError('spawn failed');
      setState('error');
      return () => {};
    }

    setPid(spawnedPid);
    setState('running');

    const offOut = onStdout(spawnedPid, (line) => {
      if (cancelled) return;
      specRef.current.onStdout?.(line);
    });
    const offErr = onStderr(spawnedPid, (line) => {
      if (cancelled) return;
      specRef.current.onStderr?.(line);
    });
    const offExit = onExit(spawnedPid, (r) => {
      if (cancelled) return;
      specRef.current.onExit?.(r);
      setState('stopped');
    });

    return () => {
      cancelled = true;
      offOut();
      offErr();
      offExit();
      const livePid = pidRef.current;
      if (livePid > 0) kill(livePid, 'SIGTERM');
      setState('stopped');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procKey]);

  return {
    pid,
    state,
    error,
    stop: () => { if (pid > 0) kill(pid, 'SIGTERM'); },
    stdin: (data) => { if (pid > 0) stdinWrite(pid, data); },
    stdinClose: () => { if (pid > 0) stdinClose(pid); },
    kill: (signal = 'SIGTERM') => { if (pid > 0) kill(pid, signal); },
  };
}
