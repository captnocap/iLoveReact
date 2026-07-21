import { isStlFile, stlToGlbCommand } from './stlImport';

let failed = 0;
const log = (globalThis as any).print ?? ((message: string) => (globalThis as any).__writeStdout?.(`${message}\n`));
function assert(condition: boolean, message: string) {
  if (!condition) { failed += 1; log(`FAIL ${message}`); }
}

assert(isStlFile('/models/scan.STL'), 'STL extension should be case-insensitive');
assert(!isStlFile('/models/scan.obj'), 'OBJ must not enter the STL conversion path');
const command = stlToGlbCommand("/tmp/scan's model.stl", '/tmp/scan.glb');
assert(command.includes('blender --background --factory-startup'), 'conversion must run Blender locally in background mode');
assert(command.includes('stl_import'), 'conversion command must import STL');
assert(command.includes('export_format=') && command.includes('GLB'), 'conversion command must emit GLB');
assert(command.includes('scan') && command.includes('model.stl'), 'source path must survive shell quoting');

if (failed) throw new Error(`${failed} STL import test(s) failed`);
log('5 passed');
