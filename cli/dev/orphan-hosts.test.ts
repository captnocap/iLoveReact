// Run:
//   tools/esbuild cli/dev/orphan-hosts.test.ts --bundle --outfile=/tmp/orphan-hosts.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/orphan-hosts.test.js
//
// This classifier decides what gets a kill signal, so it is tested against a real `ps`
// table shape BEFORE it ever signals anything. The failure mode that matters is not
// "missed an orphan" — it is "killed the window the user is working in".
import {
  classifyDevHosts,
  orphanCleanupToken,
  parseOrphanCleanupApproval,
  parseDevHostProcesses,
  parseSocketOwner,
  type DevHostProcess,
} from './orphan-hosts';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((line: string) => (globalThis as any).__writeStdout?.(`${line}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const BINARY = '/home/siah/creative/reactjit/zig-out/bin/reactjit-dev';

// The real table from 2026-08-08, the day this was written: one live host in a terminal
// and nine orphans reparented to init, the oldest six days old.
const PS_OUTPUT = [
  '  36987       1  43260 Sl   5-09:58:38 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  '  83857       1  43376 Sl   5-09:23:10 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  ' 100031       1  64672 Sl   3-07:20:10 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  '1709368       1 1099360 Sl  2-18:19:17 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  '1937545 1937429 1215684 Sl+ 01:54:27 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  '2496136       1 936844 Sl   2-13:32:57 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
].join('\n');

const noDisplay = () => 0;

test('the executable must BE the dev host, not a command line that mentions it', () => {
  const decoys = [
    '   4242       1   1000 Sl   00:01 /bin/bash -c pkill -f /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
    '   4243       1   1000 Sl   00:01 tail -f /home/siah/creative/reactjit/zig-out/bin/reactjit-dev.log',
    '   4244       1   1000 Sl   00:01 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  ].join('\n');
  const hosts = parseDevHostProcesses(decoys, BINARY);
  // Only the real executable. A substring match would have caught the shell that is
  // itself scanning for the pattern — the exact self-match that cascades.
  assert(hosts.length === 1, `matched ${hosts.length} processes instead of 1`);
  assert(hosts[0]!.pid === 4244, `matched pid ${hosts[0]!.pid}`);
});

test('a real ps table parses into pids, parents, and memory', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  assert(hosts.length === 6, `parsed ${hosts.length} hosts`);
  const live = hosts.find((host) => host.pid === 1937545)!;
  assert(live.ppid === 1937429, `live ppid was ${live.ppid}`);
  assert(live.rssKb === 1215684, `live rss was ${live.rssKb}`);
  assert(live.state === 'Sl+', `live state was ${live.state}`);
});

test('the socket owner is read from ss output', () => {
  const ss = 'u_str LISTEN 0 4 /tmp/reactjit.sock 22186066 * 0 users:(("reactjit-dev",pid=1937545,fd=6))';
  assert(parseSocketOwner(ss, '/tmp/reactjit.sock') === 1937545, 'the listener pid was not read');
  assert(parseSocketOwner('', '/tmp/reactjit.sock') === null, 'an empty table produced an owner');
});

test('the socket owner is NEVER an orphan, whatever else is true of it', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  // Force the worst case: the socket owner also looks reparented and windowless.
  const reparented: DevHostProcess[] = hosts.map((host) => (host.pid === 1937545 ? { ...host, ppid: 1 } : host));
  const scan = classifyDevHosts(reparented, 1937545, noDisplay);
  assert(!scan.orphans.some((row) => row.pid === 1937545), 'the socket owner was classified as an orphan');
  const kept = scan.live.find((row) => row.pid === 1937545)!;
  assert(kept.keptBecause.join(' ').includes('owns the dev socket'), `kept for: ${kept.keptBecause.join('; ')}`);
});

test('a host with a window is kept even when reparented and socket-less', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  const scan = classifyDevHosts(hosts, null, (pid) => (pid === 2496136 ? 9 : 0));
  assert(!scan.orphans.some((row) => row.pid === 2496136), 'a windowed host was called an orphan');
  const kept = scan.live.find((row) => row.pid === 2496136)!;
  assert(kept.keptBecause.join(' ').includes('display/GPU'), `kept for: ${kept.keptBecause.join('; ')}`);
});

test('a host whose launcher is alive is kept', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  const scan = classifyDevHosts(hosts, null, noDisplay);
  const kept = scan.live.find((row) => row.pid === 1937545)!;
  assert(kept.keptBecause.join(' ').includes('launcher is still alive'), `kept for: ${kept.keptBecause.join('; ')}`);
});

test('the real 2026-08-08 table classifies as one live host and five orphans', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  const scan = classifyDevHosts(hosts, 1937545, noDisplay);
  assert(scan.live.length === 1 && scan.live[0]!.pid === 1937545, `live: ${scan.live.map((r) => r.pid).join(',')}`);
  assert(scan.orphans.length === 5, `orphans: ${scan.orphans.length}`);
  assert(!scan.orphans.some((row) => row.pid === 1937545), 'the user\'s app was in the kill list');
  const expected = 43260 + 43376 + 64672 + 1099360 + 936844;
  assert(scan.reclaimableKb === expected, `reclaimable was ${scan.reclaimableKb}, expected ${expected}`);
});

test('with no socket readable, ppid and windows still protect a live host', () => {
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  const scan = classifyDevHosts(hosts, null, (pid) => (pid === 1937545 ? 9 : 0));
  assert(!scan.orphans.some((row) => row.pid === 1937545), 'losing ss output exposed the live host');
});

test('the GPU render node alone is not a window — that spared every orphan', () => {
  // Measured on 2026-08-08: orphans and the live host BOTH keep /dev/dri/renderD128,
  // because it only means the GPU was initialised. Only the live host had dmabufs.
  const hosts = parseDevHostProcesses(PS_OUTPUT, BINARY);
  const renderNodeOnly = () => 0; // what the fixed matcher reports for an orphan
  const scan = classifyDevHosts(hosts, 1937545, renderNodeOnly);
  assert(scan.orphans.length === 5, `render-node-only hosts were spared: ${scan.orphans.length} orphans`);
});

test('an empty process table produces an empty kill list, not an error', () => {
  const scan = classifyDevHosts(parseDevHostProcesses('', BINARY), null, noDisplay);
  assert(scan.hosts.length === 0 && scan.orphans.length === 0, 'an empty table produced work');
  assert(scan.reclaimableKb === 0, 'an empty table reclaimed memory');
});

test('pid 1 and malformed rows never reach the kill list', () => {
  const hostile = [
    '      1       1   1000 Sl   99:99 /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
    'garbage',
    '   nope    also   here bad row /home/siah/creative/reactjit/zig-out/bin/reactjit-dev',
  ].join('\n');
  const hosts = parseDevHostProcesses(hostile, BINARY);
  assert(!hosts.some((host) => host.pid <= 1), 'pid 1 survived parsing');
  assert(!hosts.some((host) => !Number.isInteger(host.pid)), 'a non-numeric pid survived parsing');
});

test('an approval token binds to the exact pid set it advertised', () => {
  const token = orphanCleanupToken([300, 100, 200]);
  assert(token === orphanCleanupToken([100, 200, 300]), 'token order changed its identity');
  assert(token !== orphanCleanupToken([100, 200]), 'a different pid set produced the same token');
});

test('an approval must carry the token prefix and real pids', () => {
  const good = parseOrphanCleanupApproval(JSON.stringify({ token: orphanCleanupToken([7, 8]), pids: [7, 8] }));
  assert(good?.pids.length === 2, 'a valid approval was rejected');
  assert(parseOrphanCleanupApproval(JSON.stringify({ token: 'native-update-v1:x', pids: [7] })) === null, 'a foreign token was accepted');
  assert(parseOrphanCleanupApproval(JSON.stringify({ token: orphanCleanupToken([1]), pids: [1] })) === null, 'pid 1 survived the approval');
  assert(parseOrphanCleanupApproval('not json') === null, 'garbage parsed as an approval');
  assert(parseOrphanCleanupApproval(null) === null, 'a missing file parsed as an approval');
});

log(`orphan-hosts: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
