// Semantic architecture host boundary tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/architectureHost.test.ts --bundle \
//     --outfile=/tmp/editor-architecture-host.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-architecture-host.test.js

import {
  ARCHITECTURE_WIRE,
  ArchitectureCapabilityError,
  ArchitectureHostRejection,
  ArchitecturePacketError,
  PACKET_KIND,
  REJECTION_CODE,
  SECTION_TAG,
  architectureHost,
  architectureHostTesting,
  decodeArchitecturePacket,
  type ArchitectureCatalogEntry,
  type ArchitectureSource,
} from './architectureHost';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function throws<T extends Error>(fn: () => unknown, Type: new (...args: any[]) => T, message: string): T {
  try { fn(); } catch (error) {
    if (error instanceof Type) return error;
    throw new Error(`${message}: wrong error ${(error as Error).name}: ${(error as Error).message}`);
  }
  throw new Error(`${message}: did not throw`);
}

const host = globalThis as any;
const hostNames = [
  '__game_build_arch_catalog_validate', '__game_build_arch_catalog_install', '__game_build_arch_catalog_query',
  '__game_build_arch_source_validate', '__game_build_arch_mutate', '__game_build_arch_compile',
  '__game_build_arch_raycast', '__game_build_arch_opening_slots',
  '__game_build_arch_scale_metadata', '__game_build_arch_catalog_rows',
];
function clearHosts(): void { for (const name of hostNames) delete host[name]; }

const HASH_A = 'a'.repeat(64), HASH_B = 'b'.repeat(64);
const measuredStyle: ArchitectureCatalogEntry = {
  catalogId: 'build:wall:style:test', contentHash: HASH_A, packageId: 'package:test-wall-style', label: 'Test Wall',
  family: 'wall', role: 'style', categoryPath: ['Wall', 'Styles'], themeTags: ['modern'], gameplayTags: ['solid'],
  measurement: {
    sourceBoundsU: { minXU: 0, minYU: 0, minZU: -2, maxXU: 16, maxYU: 48, maxZU: 2 },
    clearanceMask: [], pivotU: { xU: 0, yU: 0, zU: 0 },
  },
  wallStyleDefaults: { heightU: 48, thicknessU: 4, profile: 'full' },
  assetRefs: { meshContentHash: HASH_B, materialContentHashes: [] },
};
const emptySource: ArchitectureSource = { version: 1, revision: 7, walls: { vertices: [], edges: [], anchors: [] } };

function emptyResult(kind: number, sourceRevision = 0): Uint8Array {
  return architectureHostTesting.encodePacket({ kind, sourceRevision } as any);
}

function queryResult(indices: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(indices.length * 4);
  const view = new DataView(bytes.buffer);
  indices.forEach((value, index) => view.setUint32(index * 4, value, true));
  return architectureHostTesting.encodePacket({
    kind: PACKET_KIND.catalogQueryResult,
    sections: [{ tag: SECTION_TAG.catalogQuery, itemCount: indices.length, stride: 4, bytes }],
  } as any);
}

function rejectionResult(code: number, input: { stage?: number; expected?: number; actual?: number; detail?: string } = {}): Uint8Array {
  const detail = input.detail ?? `rejection-${code}`;
  const stringTable = Uint8Array.from(Array.from(detail).map(character => character.charCodeAt(0)));
  const row = new Uint8Array(32);
  const view = new DataView(row.buffer);
  view.setUint16(0, code, true);
  view.setUint16(2, input.stage ?? 0, true);
  view.setUint32(12, input.expected ?? 0, true);
  view.setUint32(16, input.actual ?? 0, true);
  view.setUint32(20, 0, true);
  view.setUint32(24, stringTable.length, true);
  return architectureHostTesting.encodePacket({
    kind: PACKET_KIND.sourceValidateResult,
    sourceRevision: input.actual ?? 0,
    family: 1,
    sections: [{ tag: SECTION_TAG.rejection, itemCount: 1, stride: 32, bytes: row }],
    stringTable,
  } as any);
}

test('native golden empty-source packet decodes with exact header and row shape', () => {
  const golden = Uint8Array.from([
    0x52, 0x4a, 0x41, 0x57, 0x01, 0x00, 0x07, 0x00,
    0x48, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x28, 0x00, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const decoded = decodeArchitecturePacket(golden);
  assert(decoded.kind === PACKET_KIND.sourceValidateRequest, 'golden packet kind drifted');
  assert(decoded.family === 1 && decoded.sourceRevision === 0, 'golden family/revision drifted');
  const source = decoded.sections.get(SECTION_TAG.sourceHeader);
  assert(source?.itemCount === 1 && source.stride === 8 && source.bytes.length === 8, 'golden source row shape drifted');
});

test('measured catalog install and structured query use typed binary rows', () => {
  clearHosts();
  let installedRequest: ReturnType<typeof decodeArchitecturePacket> | null = null;
  host.__game_build_arch_catalog_install = (request: Uint8Array) => {
    installedRequest = decodeArchitecturePacket(request);
    return emptyResult(PACKET_KIND.catalogInstallResult);
  };
  host.__game_build_arch_catalog_query = (request: Uint8Array) => {
    const decoded = decodeArchitecturePacket(request);
    assert(decoded.sections.get(SECTION_TAG.catalogQuery)?.stride === 32, 'query row did not use fixed semantic stride');
    // Semantic rows carry types.ArchitectureFamily (wall=0), NEVER the packet
    // header's FamilyTag (wall=1). The first live install crashed on this exact
    // byte (req_4470) — if this assertion fires, one codec side drifted again.
    assert(decoded.sections.get(SECTION_TAG.catalogQuery)?.bytes[0] === 0, 'query family byte must be the 0-based entry enum (wall=0)');
    assert(decoded.sections.get(SECTION_TAG.catalogTags)?.itemCount === 2, 'query tag filters were not serialized');
    return queryResult([0]);
  };
  architectureHost.installCatalog([measuredStyle]);
  assert(installedRequest?.sections.get(SECTION_TAG.catalogEntries)?.stride === 176, 'measured catalog row stride drifted');
  assert(installedRequest?.sections.get(SECTION_TAG.catalogEntries)?.bytes[32] === 0, 'entry family byte must be the 0-based entry enum (wall=0), not the header FamilyTag');
  assert(installedRequest?.sections.get(SECTION_TAG.catalogTags)?.itemCount === 4, 'category/theme/gameplay rows missing');
  assert(architectureHost.queryCatalog({ family: 'wall', role: 'style', requiredThemeTags: ['modern'], requiredGameplayTags: ['solid'] })[0] === 0, 'query result index drifted');
});

test('every stable rejection code maps without falling through', () => {
  clearHosts();
  for (const [name, code] of Object.entries(REJECTION_CODE)) {
    host.__game_build_arch_source_validate = () => rejectionResult(code);
    const error = throws(() => architectureHost.validateSource(emptySource), ArchitectureHostRejection, `rejection ${name}`);
    assert(error.code === name, `rejection ${code} mapped to ${error.code}, expected ${name}`);
    assert(error.codeValue === code, `rejection numeric code ${code} was lost`);
  }
});

test('stale revision preserves stage and expected/actual revision evidence', () => {
  clearHosts();
  host.__game_build_arch_source_validate = () => rejectionResult(REJECTION_CODE.stale_source_revision, { stage: 5, expected: 7, actual: 8, detail: 'stale source' });
  const error = throws(() => architectureHost.validateSource(emptySource), ArchitectureHostRejection, 'stale revision');
  assert(error.code === 'stale_source_revision', 'stale revision code changed');
  assert(error.stage === 5 && error.expectedRevision === 7 && error.actualRevision === 8, 'stale revision evidence changed');
  assert(error.message === 'stale source', 'stale detail changed');
});

test('declared-short and declared-long result lengths reject before section decode', () => {
  clearHosts();
  const short = emptyResult(PACKET_KIND.sourceValidateResult, 7);
  new DataView(short.buffer).setUint32(8, short.length - 1, true);
  host.__game_build_arch_source_validate = () => short;
  throws(() => architectureHost.validateSource(emptySource), ArchitecturePacketError, 'declared-short result');
  const long = emptyResult(PACKET_KIND.sourceValidateResult, 7);
  new DataView(long.buffer).setUint32(8, long.length + 1, true);
  host.__game_build_arch_source_validate = () => long;
  throws(() => architectureHost.validateSource(emptySource), ArchitecturePacketError, 'declared-long result');
});

test('result kind mismatch cannot masquerade as success', () => {
  clearHosts();
  host.__game_build_arch_source_validate = () => emptyResult(PACKET_KIND.catalogInstallResult);
  throws(() => architectureHost.validateSource(emptySource), ArchitecturePacketError, 'wrong result kind');
});

test('absent host capability fails loudly instead of returning a facade success', () => {
  clearHosts();
  const error = throws(() => architectureHost.scaleMetadata(), ArchitectureCapabilityError, 'absent scale host');
  assert(error.message.includes('scale metadata'), 'capability error omitted the operation');
});

test('shared constants remain byte-exact with the native contract', () => {
  assert(ARCHITECTURE_WIRE.magic === 0x57414a52, 'magic changed');
  assert(ARCHITECTURE_WIRE.packetVersion === 1 && ARCHITECTURE_WIRE.headerBytes === 40, 'header contract changed');
  assert(ARCHITECTURE_WIRE.sectionDirectoryBytes === 24 && ARCHITECTURE_WIRE.sectionAlignment === 8, 'directory contract changed');
  assert(ARCHITECTURE_WIRE.maximumPacketBytes === 67_108_864 && ARCHITECTURE_WIRE.maximumSections === 64, 'wire limits changed');
});

clearHosts();
log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exitCode = 1;
