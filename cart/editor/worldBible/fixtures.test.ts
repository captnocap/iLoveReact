// The committed first-slice corpus is executable design: every file must parse
// and the public CropDuster projection must stay fail-closed.
import { listDir, readFile } from '../../../runtime/hooks/fs';
import { parseKnowledgePage } from './blockFormat';
import { buildKnowledgeCatalog, publicProjectionText } from './model';
import { readCanonicalKnowledgePage } from './canonical';
import { WORLD_KNOWLEDGE_ROOT } from './controller';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const pages = listDir(WORLD_KNOWLEDGE_ROOT)
  .filter((entry) => entry.endsWith('.md'))
  .map((entry) => {
    const path = `${WORLD_KNOWLEDGE_ROOT}/${entry}`;
    const source = readFile(path);
    return source === null ? null : parseKnowledgePage(source, path);
  })
  .filter((page): page is NonNullable<typeof page> => page !== null);

test('the complete hand-editable fixture parses without hard errors', () => {
  const requiredRefs = [
    'biz.cropduster_labs',
    'place.east_mercer_depot',
    'npc.rowena_pike',
    'place.rowena_apartment',
    'position.cropduster_site_manager',
    'shift.cropduster_weekday_day',
    'mechanic.evidence_visibility',
  ];
  for (const ref of requiredRefs) assert(pages.some((page) => page.ref === ref), `required seed page ${ref} is missing`);
  const errors = pages.flatMap((page) => page.diagnostics).filter((item) => item.severity === 'error');
  assert(errors.length === 0, errors.map((item) => `${item.path}: ${item.message}`).join('; '));
});

test('fixture links resolve and form backlinks', () => {
  const catalog = buildKnowledgeCatalog(pages);
  const unresolved = catalog.diagnostics.filter((item) => item.code === 'ref-unresolved');
  assert(unresolved.length === 0, unresolved.map((item) => item.message).join('; '));
  assert(catalog.backlinks.get('biz.cropduster_labs')?.some((row) => row.fromRef === 'place.east_mercer_depot'), 'business backlink from depot missing');
  assert(catalog.backlinks.get('npc.rowena_pike')?.some((row) => row.fromRef === 'position.cropduster_site_manager'), 'person backlink from position missing');
});

test('public fixture excludes the disposal reveal and designer instructions', () => {
  const page = pages.find((candidate) => candidate.ref === 'biz.cropduster_labs');
  assert(page, 'CropDuster page missing');
  const canonical = readCanonicalKnowledgePage(page.path);
  assert(canonical, 'CropDuster canonical bytes could not be loaded');
  const projection = publicProjectionText(canonical);
  assert(projection.includes('municipal pest-control services'), 'benign description missing');
  assert(!projection.includes('storm-drain dumping'), 'secret disposal fact leaked');
  assert(!projection.includes('mission reveal'), 'designer notes leaked');
});

log(`\nworld bible fixtures: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} world-bible fixture test(s) failed`);
