// cli/commands/push-bundle.ts - push a bundle to a running dev host.

import { parseArgs } from '../host/argv.ts';
import { fsExists, tryFsRead } from '../host/fs.ts';
import { err } from '../host/log.ts';
import { SocketError, tryUnixConnect, unixClose, unixReadLine, unixWrite } from '../host/net.ts';

const SOCKET_PATH = '/tmp/reactjit.sock';
const TIMEOUT_MS = 3000;

export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv.slice(0, 2), { positional: ['tabName', 'bundlePath'] });
  } catch (error) {
    err(`[push-bundle] ${(error as Error).message}`);
    return 1;
  }

  const tabName = parsed.positional.tabName;
  const bundlePath = parsed.positional.bundlePath;
  if (!tabName || !bundlePath) {
    err('[push-bundle] usage: push-bundle.js <tab-name> <bundle-path>');
    return 1;
  }

  const bundle = tryFsRead(bundlePath);
  if (bundle === null) {
    err(`[push-bundle] cannot read ${bundlePath}`);
    return 1;
  }

  if (!fsExists(SOCKET_PATH)) return 2;

  const fd = tryUnixConnect(SOCKET_PATH);
  if (fd === null) return 2;

  try {
    try {
      unixWrite(fd, `PUSH ${tabName} ${utf8ByteLength(bundle)}\n`);
    } catch (error) {
      if (error instanceof SocketError) {
        err('[push-bundle] write header failed');
        return 1;
      }
      throw error;
    }

    try {
      unixWrite(fd, bundle);
    } catch (error) {
      if (error instanceof SocketError) {
        err('[push-bundle] write bundle failed');
        return 1;
      }
      throw error;
    }

    const line = unixReadLine(fd, __nowMs() + TIMEOUT_MS).trim();
    if (line.startsWith('OK')) return 0;
    err(`[push-bundle] host error: ${line}`);
    return 1;
  } catch (error) {
    if (error instanceof SocketError && error.message === 'timeout') {
      err(`[push-bundle] timeout waiting for host @ ${SOCKET_PATH}`);
      return 2;
    }
    if (error instanceof SocketError && error.message === 'EOF before newline') {
      err('[push-bundle] host closed connection before ack');
      return 1;
    }
    throw error;
  } finally {
    unixClose(fd);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
