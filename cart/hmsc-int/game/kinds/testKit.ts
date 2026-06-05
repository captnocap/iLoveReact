// Tiny behavior-test harness for the game/kinds registries (P4). Tests bundle
// with tools/esbuild and run under tools/v8cli — no node, no test framework.
// Internal to kinds/ — NOT exported through the index door.
//
//   tools/esbuild cart/hmsc-int/game/kinds/<family>.test.ts --bundle \
//     --outfile=/tmp/kinds-<family>.test.js && tools/v8cli /tmp/kinds-<family>.test.js
//
// A failing assertion throws (v8cli surfaces the stack and exits non-zero);
// a passing run prints one PASS line per test and a family summary.

let passed = 0;
let failed = 0;

export function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function assertClose(actual: number, expected: number, epsilon: number, message: string): void {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(`${message} — expected ${expected} ±${epsilon}, got ${actual}`);
  }
}

// Exits the run with a verdict line. Call once at the end of each test file.
export function report(family: string): void {
  const verdict = failed === 0 ? 'OK' : 'FAILED';
  console.log(`${family}: ${passed} passed, ${failed} failed — ${verdict}`);
  if (failed > 0) throw new Error(`${family}: ${failed} behavior test(s) failed`);
}
