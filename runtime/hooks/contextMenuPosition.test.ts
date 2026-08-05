// Run:
//   tools/esbuild runtime/hooks/contextMenuPosition.test.ts --bundle \
//     --outfile=/tmp/context-menu-position.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/context-menu-position.test.js
import { contextMenuPosition, contextMenuViewportSize } from './contextMenuPosition';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((line: string) => (globalThis as any).__writeStdout?.(`${line}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test('keeps cursor placement when the menu fits', () => {
  const point = contextMenuPosition({ x: 220, y: 140 }, { width: 188, height: 300 }, { width: 900, height: 700 });
  assert(point.x === 220 && point.y === 140, `unexpected placement ${point.x},${point.y}`);
});

test('opens upward when the bottom edge would clip', () => {
  const point = contextMenuPosition({ x: 220, y: 640 }, { width: 188, height: 354 }, { width: 900, height: 700 });
  assert(point.x === 220 && point.y === 286, `menu did not flip upward: ${point.x},${point.y}`);
});

test('opens left when the right edge would clip', () => {
  const point = contextMenuPosition({ x: 850, y: 140 }, { width: 240, height: 300 }, { width: 900, height: 700 });
  assert(point.x === 610 && point.y === 140, `menu did not flip left: ${point.x},${point.y}`);
});

test('clamps oversized or corner menus to the application edge', () => {
  const corner = contextMenuPosition({ x: 2, y: 2 }, { width: 188, height: 354 }, { width: 900, height: 700 });
  assert(corner.x === 4 && corner.y === 4, `corner escaped padding: ${corner.x},${corner.y}`);
  const oversized = contextMenuPosition({ x: 890, y: 690 }, { width: 950, height: 800 }, { width: 900, height: 700 });
  assert(oversized.x === 4 && oversized.y === 4, `oversized menu did not choose the only stable origin: ${oversized.x},${oversized.y}`);
});

test('preserves cursor coordinates until host and menu measurements exist', () => {
  const point = contextMenuPosition({ x: 850, y: 640 }, { width: 0, height: 0 }, { width: 900, height: 700 });
  assert(point.x === 850 && point.y === 640, 'unmeasured menu guessed a position');
});

test('reserves both viewport edges for an oversized menu scroll box', () => {
  const available = contextMenuViewportSize({ width: 464, height: 344 });
  assert(available.width === 456 && available.height === 336, `wrong scroll bounds ${available.width}×${available.height}`);
});

log(`${failed === 0 ? 'PASS' : 'FAIL'} context menu position: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} context menu position test(s) failed`);
