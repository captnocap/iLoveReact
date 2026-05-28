// cli/host/process.ts - typed wrappers over __spawn{,Sync}.

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function spawnSync(cmd: string, args: string[], stdin: string = ''): SpawnResult {
  return JSON.parse(__spawnSync(cmd, JSON.stringify(args), stdin)) as SpawnResult;
}

export function run(cmd: string, args: string[], stdin: string = ''): string {
  const result = spawnSync(cmd, args, stdin);
  if (result.code !== 0) {
    throw new Error(`${cmd} exited ${result.code}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export interface AsyncChild {
  id: number;
}

export function spawn(cmd: string, args: string[]): AsyncChild {
  const id = __spawn(cmd, JSON.stringify(args));
  if (id < 0) throw new Error(`spawn failed: ${cmd}`);
  return { id };
}

export function readChildLine(child: AsyncChild, timeoutMs: number): string | null {
  return __childReadLine(child.id, timeoutMs);
}

export function killChild(child: AsyncChild): void {
  __childKill(child.id);
}
