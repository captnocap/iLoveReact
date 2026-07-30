import { UV_CONTEXT_MENU_TUNING, uvContextMenuHeight } from './uvContextMenuLayout';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('texture menu first frame budgets every action including Reset', () => {
  const height = uvContextMenuHeight('texture', { group: null, height: 0 });
  assert(UV_CONTEXT_MENU_TUNING.expandedRows.texture === 8, 'Texture Atlas row estimate lost an action');
  assert(height === 330 + 8 * 26, `texture fallback height drifted to ${height}`);
});

test('rendered menu height replaces estimates only for the matching group', () => {
  assert(uvContextMenuHeight('texture', { group: 'texture', height: 571.2 }) === 572, 'live menu measurement was ignored');
  assert(
    uvContextMenuHeight('arrange', { group: 'texture', height: 571.2 }) === 330 + 6 * 26,
    'stale Texture Atlas measurement leaked into another submenu',
  );
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
