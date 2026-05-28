// cli/host/log.ts - leveled writes.

export function out(...parts: string[]): void {
  __writeStdout(parts.join('') + '\n');
}

export function err(...parts: string[]): void {
  __writeStderr(parts.join('') + '\n');
}

export function info(tag: string, ...parts: string[]): void {
  __writeStdout(`[${tag}] ${parts.join('')}\n`);
}

export function warn(tag: string, ...parts: string[]): void {
  __writeStderr(`[${tag}] ${parts.join('')}\n`);
}

export function die(tag: string, message: string, code: number = 1): never {
  __writeStderr(`[${tag}] ${message}\n`);
  __exit(code);
  throw new Error('unreachable');
}
