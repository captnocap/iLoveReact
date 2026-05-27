// scripts/push-bundle.js — push a bundle to a running dev host.
//
// Usage: tools/v8cli scripts/push-bundle.js <tab-name> <bundle-path>
//
// Connects to /tmp/reactjit.sock (framework/dev_ipc.zig listener), sends
// "PUSH <name> <len>\n<bundle-bytes>", waits for a line of reply.
//
// Exit codes (consumed by scripts/dev's retry loop):
//   0 — ack OK
//   1 — protocol/host error
//   2 — host not running (socket missing / refused) or timeout

const SOCKET_PATH = '/tmp/reactjit.sock';
const TIMEOUT_MS = 3000;

const argv = process.argv.slice(1); // drop script path
const name = argv[0];
const bundlePath = argv[1];
if (!name || !bundlePath) {
  __writeStderr('[push-bundle] usage: push-bundle.js <tab-name> <bundle-path>\n');
  __exit(1);
}

const bundle = __fs_read(bundlePath);
if (bundle === null) {
  __writeStderr('[push-bundle] cannot read ' + bundlePath + '\n');
  __exit(1);
}

if (!__fs_exists(SOCKET_PATH)) {
  // Host not running — don't emit noise; scripts/dev treats exit 2 as "spawn one".
  __exit(2);
}

const fd = __unixConnect(SOCKET_PATH);
if (fd < 0) {
  // ECONNREFUSED / stale socket file.
  __exit(2);
}

// UTF-8 byte length, not code-point count. The bundle is ASCII+escaped in
// practice (esbuild output), so String#length == UTF-8 bytes for us. For
// safety, cross-check via a manual counter.
const byteLen = utf8ByteLength(bundle);
const header = 'PUSH ' + name + ' ' + byteLen + '\n';

if (__unixWrite(fd, header) < 0) {
  __writeStderr('[push-bundle] write header failed\n');
  __unixClose(fd);
  __exit(1);
}
if (__unixWrite(fd, bundle) < 0) {
  __writeStderr('[push-bundle] write bundle failed\n');
  __unixClose(fd);
  __exit(1);
}

// Drain reply until a newline shows up or we time out. One read per poll;
// __unixReadAll returns null on timeout.
let reply = '';
const deadline = __nowMs() + TIMEOUT_MS;
while (reply.indexOf('\n') === -1) {
  const remaining = deadline - __nowMs();
  if (remaining <= 0) {
    __writeStderr('[push-bundle] timeout waiting for host @ ' + SOCKET_PATH + '\n');
    __unixClose(fd);
    __exit(2);
  }
  const chunk = __unixReadAll(fd, remaining, 4096);
  if (chunk === null) continue; // timeout on this poll — loop again
  if (chunk === '') {
    // EOF with no newline — host closed without ack.
    __writeStderr('[push-bundle] host closed connection before ack\n');
    __unixClose(fd);
    __exit(1);
  }
  reply += chunk;
}

const line = reply.slice(0, reply.indexOf('\n')).trim();
__unixClose(fd);

if (line.startsWith('OK')) __exit(0);
__writeStderr('[push-bundle] host error: ' + line + '\n');
__exit(1);

function utf8ByteLength(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // surrogate pair
    else n += 3;
  }
  return n;
}
