// cli/host/net.ts - typed wrappers over __unix*.

export class SocketError extends Error {}

export function unixConnect(path: string): number {
  const fd = __unixConnect(path);
  if (fd < 0) throw new SocketError(`connect failed: ${path}`);
  return fd;
}

export function tryUnixConnect(path: string): number | null {
  const fd = __unixConnect(path);
  return fd < 0 ? null : fd;
}

export function unixWrite(fd: number, data: string): void {
  const written = __unixWrite(fd, data);
  if (written < 0) throw new SocketError(`write failed (fd=${fd})`);
}

export function unixReadLine(fd: number, deadlineMs: number): string {
  let reply = '';
  while (reply.indexOf('\n') === -1) {
    const remaining = deadlineMs - __nowMs();
    if (remaining <= 0) throw new SocketError('timeout');
    const chunk = __unixReadAll(fd, remaining, 4096);
    if (chunk === null) continue;
    if (chunk === '') throw new SocketError('EOF before newline');
    reply += chunk;
  }
  return reply.slice(0, reply.indexOf('\n'));
}

export function unixClose(fd: number): void {
  __unixClose(fd);
}
