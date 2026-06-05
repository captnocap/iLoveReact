// _testkit.ts — the tiny behavior-test harness every game/*.test.ts shares (P4).
//
// No test framework: the repo has zero npm deps. A suite bundles with
// tools/esbuild and runs under tools/v8cli:
//
//   tools/esbuild cart/hmsc-int/game/<file>.test.ts --bundle \
//     --outfile=zig-out/game/tests/<file>.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli zig-out/game/tests/<file>.js
//
// `rjit game verify` does exactly that for every suite. A suite is:
//
//   test('a dropped barrier disrupts only paths through it', () => { ... });
//   finish('pathing');
//
// finish() prints one PASS/FAIL line per case plus the tally, and exits
// non-zero if anything failed — the bit the verify verdict keys off.

type TestCase = { name: string; fn: () => void };

const cases: TestCase[] = [];

export function test(name: string, fn: () => void): void {
  cases.push({ name, fn });
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

export function assertClose(actual: number, expected: number, epsilon: number, message: string): void {
  if (!(Math.abs(actual - expected) <= epsilon)) {
    throw new Error(`${message} (expected ${expected} ±${epsilon}, got ${actual})`);
  }
}

export function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

export function finish(suiteName: string): void {
  let failed = 0;
  for (const testCase of cases) {
    try {
      testCase.fn();
      console.log(`PASS ${suiteName} :: ${testCase.name}`);
    } catch (error: any) {
      failed += 1;
      console.error(`FAIL ${suiteName} :: ${testCase.name} — ${error?.message ?? String(error)}`);
    }
  }
  console.log(`${suiteName}: ${cases.length - failed}/${cases.length} passed`);
  const exit = (globalThis as any).__exit;
  if (typeof exit === 'function') exit(failed > 0 ? 1 : 0);
  else if (failed > 0) throw new Error(`${suiteName}: ${failed} test(s) failed`);
}
