// World Bible concrete-syntax and query contract tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/worldBible/blockFormat.test.ts --bundle \
//     --outfile=/tmp/editor-world-bible-format.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-world-bible-format.test.js
import {
  draftFromPage,
  parseKnowledgePage,
  patchKnowledgePage,
  semanticChanges,
} from './blockFormat';
import {
  buildKnowledgeCatalog,
  publicKnowledgeDraftPreview,
  publicKnowledgeProjection,
} from './model';

function draftPreviewText(page: NonNullable<ReturnType<typeof parseKnowledgePage>>): string {
  const preview = publicKnowledgeDraftPreview(draftFromPage(page));
  if (!preview.eligible) return '';
  return [
    preview.identity.name,
    preview.prose,
    ...preview.facts.map((fact) => `${fact.label}: ${fact.value}`),
  ].join('\n');
}

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const BUSINESS = `# CropDuster Labs

This loose paragraph is author-only and must survive exactly.
<!-- human formatting stays human-owned -->

<business>
  <ref>biz.cropduster_labs</ref>
  <name>CropDuster Labs</name>
  <logo>cart/editor/assets/cropduster.png</logo>

  <fact key="legal_name" label="Legal name" visibility="public">CropDuster Laboratories LLC</fact>
  <fact key="location" label="Location" visibility="public">@[place.east_mercer_depot]</fact>
  <fact key="disposal_practice" label="Disposal practice" visibility="secret">storm-drain dumping</fact>

  <public>
CropDuster Labs provides pest-control services throughout East Mercer.
  </public>
</business>

<notes>
The disposal-practice fact is a reveal. Do not put it in player copy.
</notes>
`;

test('entity tag is authoritative and ref prefix is only a warning', () => {
  const mismatch = BUSINESS.replace('biz.cropduster_labs', 'npc.cropduster_labs');
  const page = parseKnowledgePage(mismatch, 'mismatch.md');
  assert(page?.kind === 'business', 'ref prefix overrode the entity tag');
  assert(page.diagnostics.some((item) => item.code === 'ref-prefix-kind-mismatch' && item.severity === 'warning'), 'prefix mismatch was not visible');
});

test('missing and duplicate fact keys are hard errors', () => {
  const source = BUSINESS.replace(
    '</business>',
    '  <fact key="location" label="Other location" visibility="public">somewhere</fact>\n  <fact visibility="author">unkeyed</fact>\n</business>',
  );
  const page = parseKnowledgePage(source, 'bad-facts.md');
  assert(page?.diagnostics.some((item) => item.code === 'fact-key-duplicate' && item.severity === 'error'), 'duplicate key passed');
  assert(page?.diagnostics.some((item) => item.code === 'fact-key-missing' && item.severity === 'error'), 'missing key passed');
});

test('duplicate fact attributes are rejected instead of choosing a public-looking first value', () => {
  const source = BUSINESS.replace(
    'visibility="secret">storm-drain dumping',
    'visibility="public" visibility="secret">SECRET ATTRIBUTE VALUE',
  );
  const page = parseKnowledgePage(source, 'duplicate-attribute.md');
  assert(page?.diagnostics.some((item) => item.code === 'fact-attribute-duplicate' && item.severity === 'error'), 'duplicate visibility attribute passed');
  // @ts-expect-error Parsing alone deliberately does not mint canonical-disk provenance.
  assert(page && publicKnowledgeProjection(page) === null, 'parsed malformed bytes entered canonical public output');
});

test('fact attributes are fully consumed and malformed or unknown syntax fails closed', () => {
  const attacks = [
    {
      name: 'unquoted value before a public-looking duplicate',
      attributes: 'key="disposal_practice" label="Disposal practice" visibility=secret visibility="public"',
      code: 'fact-attribute-malformed',
    },
    {
      name: 'trailing unparsed syntax',
      attributes: 'key="disposal_practice" label="Disposal practice" visibility="public" trailing',
      code: 'fact-attribute-malformed',
    },
    {
      name: 'unknown quoted attribute',
      attributes: 'key="disposal_practice" label="Disposal practice" visibility="public" audience="players"',
      code: 'fact-attribute-unknown',
    },
  ];
  for (const attack of attacks) {
    const source = BUSINESS.replace(
      'key="disposal_practice" label="Disposal practice" visibility="secret"',
      attack.attributes,
    );
    const page = parseKnowledgePage(source, 'malformed-attributes.md');
    assert(page?.diagnostics.some((item) => item.code === attack.code && item.severity === 'error'), `${attack.name} was accepted`);
    // @ts-expect-error Parsing alone deliberately does not mint canonical-disk provenance.
    assert(page && publicKnowledgeProjection(page) === null, `${attack.name} entered canonical public output`);
  }
});

test('HTML comments and Markdown fences cannot mint structural semantics', () => {
  const hiddenEntity = [
    '<business>',
    '  <ref>biz.comment_decoy</ref>',
    '  <name>Comment Decoy</name>',
    '  <fact key="leak" label="Leak" visibility="public">COMMENT ROOT SECRET</fact>',
    '  <public>COMMENT ROOT PUBLIC</public>',
    '</business>',
  ].join('\n');
  const fencedEntity = hiddenEntity.replaceAll('COMMENT', 'FENCE').replace('comment_decoy', 'fence_decoy');
  assert(parseKnowledgePage(`<!--\n${hiddenEntity}\n-->`, 'comment-only.md') === null, 'a commented entity became a canonical page');
  assert(parseKnowledgePage(`\`\`\`world-bible\n${fencedEntity}\n\`\`\``, 'fence-only.md') === null, 'a fenced entity became a canonical page');

  const source = [
    '# Safe Company',
    '',
    '<!--',
    hiddenEntity,
    '-->',
    '',
    '```world-bible',
    fencedEntity,
    '```',
    '',
    '<business>',
    '  <ref>biz.safe_company</ref>',
    '  <name>Safe Company</name>',
    '  <!-- <fact key="comment_leak" label="Leak" visibility="public">COMMENT FACT SECRET</fact> -->',
    '',
    '~~~world-bible',
    '  <fact key="fence_leak" label="Leak" visibility="public">FENCE FACT SECRET</fact>',
    '  <public>FENCE PUBLIC SPOOF</public>',
    '~~~',
    '',
    '  <fact key="real" label="Real" visibility="public">REAL PUBLIC FACT</fact>',
    '  <public>',
    'Safe public copy.',
    '',
    '```xml',
    '<notes>This is a literal fenced example, not a notes block.</notes>',
    '```',
    '  </public>',
    '</business>',
    '',
    '<notes>REAL AUTHOR NOTE</notes>',
    '',
  ].join('\n');
  const page = parseKnowledgePage(source, 'inert-markdown.md');
  assert(page, 'real entity was hidden with the inert examples');
  assert(!page.diagnostics.some((item) => item.severity === 'error'), page.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; '));
  assert(page.ref === 'biz.safe_company' && page.facts.length === 1 && page.facts[0]!.key === 'real', 'commented or fenced semantics entered the page');
  const projected = draftPreviewText(page);
  assert(projected.includes('REAL PUBLIC FACT') && projected.includes('Safe public copy.'), 'real public content was lost');
  assert(!projected.includes('COMMENT ROOT SECRET') && !projected.includes('FENCE FACT SECRET') && !projected.includes('FENCE PUBLIC SPOOF'), 'inert structural examples minted public semantics');

  const draft = draftFromPage(page);
  draft.name = 'Safe Company Renamed';
  const patched = patchKnowledgePage(page, draft);
  assert(patched.ok, patched.diagnostics.map((item) => item.message).join('; '));
  assert(patched.source.includes(`<!--\n${hiddenEntity}\n-->`), 'human-owned HTML comment changed');
  assert(patched.source.includes(`\`\`\`world-bible\n${fencedEntity}\n\`\`\``), 'human-owned fenced prose changed');
  assert(patched.source.includes('<notes>This is a literal fenced example, not a notes block.</notes>'), 'ordinary fenced block example changed');
});

test('middle insertion is one keyed addition and reorder is not semantic churn', () => {
  const page = parseKnowledgePage(BUSINESS, 'cropduster.md');
  assert(page, 'fixture did not parse');
  const draft = draftFromPage(page);
  draft.facts.splice(1, 0, { key: 'founded', label: 'Founded', value: '1997', visibility: 'public' });
  const inserted = semanticChanges(page, draft);
  assert(inserted.length === 1 && inserted[0]!.key === 'fact.founded', `expected one keyed addition, got ${inserted.map((item) => item.key).join(', ')}`);
  const insertedPatch = patchKnowledgePage(page, draft);
  assert(insertedPatch.ok && insertedPatch.page, insertedPatch.diagnostics.map((item) => item.message).join('; '));
  const foundedAt = insertedPatch.source.indexOf('key="founded"');
  assert(foundedAt > insertedPatch.source.indexOf('key="legal_name"') && foundedAt < insertedPatch.source.indexOf('key="location"'), 'middle insertion was appended instead of preserving requested order');
  assert(insertedPatch.page.facts.some((fact) => fact.key === 'founded' && fact.value === '1997'), 'middle insertion did not round-trip');
  const reordered = { ...draft, facts: [...draft.facts].reverse() };
  assert(semanticChanges(draft, reordered).length === 0, 'presentation order became fact identity');
  const originalDraft = draftFromPage(page);
  const reorderOnly = { ...originalDraft, facts: [...originalDraft.facts].reverse() };
  const patched = patchKnowledgePage(page, reorderOnly);
  assert(patched.ok && patched.source === BUSINESS, 'reorder-only draft rewrote canonical text');
});

test('loose author Markdown is parsed, patchable, and remains author-only', () => {
  const page = parseKnowledgePage(BUSINESS, 'cropduster.md');
  assert(page?.authorText.includes('loose paragraph'), 'author Markdown preamble was invisible');
  const draft = draftFromPage(page);
  draft.authorText = 'A literal mechanic rule authored before runtime code.';
  const patched = patchKnowledgePage(page, draft);
  assert(patched.ok && patched.page?.authorText === draft.authorText, patched.diagnostics.map((item) => item.message).join('; '));
  assert(patched.source.startsWith('# CropDuster Labs\n\nA literal mechanic rule'), 'author Markdown patch damaged the heading boundary');
  assert(!draftPreviewText(patched.page).includes('literal mechanic rule'), 'author Markdown entered the public draft preview');
});

test('structural blocks must be direct children and malformed pages fail closed', () => {
  const nested = BUSINESS.replace(
    'storm-drain dumping</fact>',
    'prefix <public>SECRET NEEDLE</public></fact>',
  );
  const page = parseKnowledgePage(nested, 'nested.md');
  assert(page?.diagnostics.some((item) => item.code === 'block-nesting-invalid' && item.severity === 'error'), 'nested public block was accepted');
  // @ts-expect-error Parsing alone deliberately does not mint canonical-disk provenance.
  assert(page && publicKnowledgeProjection(page) === null, 'malformed parsed page emitted canonical public text');

  const crossed = BUSINESS.replace(
    'CropDuster Labs provides pest-control services throughout East Mercer.',
    'Visible <notes>SECRET NOTE</notes>',
  );
  const crossedPage = parseKnowledgePage(crossed, 'crossed.md');
  assert(crossedPage?.diagnostics.some((item) => item.code === 'block-nesting-invalid'), 'notes nested inside public prose were accepted');
  // @ts-expect-error Parsing alone deliberately does not mint canonical-disk provenance.
  assert(crossedPage && publicKnowledgeProjection(crossedPage) === null, 'nested notes entered canonical public text');
});

test('draft validation rejects unresolvable refs and structural field injection', () => {
  const page = parseKnowledgePage(BUSINESS, 'cropduster.md');
  assert(page, 'fixture did not parse');
  const badRef = draftFromPage(page);
  badRef.ref = 'biz.bad/path';
  assert(semanticChanges(page, badRef).some((change) => change.key === 'ref'), 'identity drift was invisible to dirty-state semantics');
  assert(!patchKnowledgePage(page, badRef).ok, 'unresolvable ref passed validation');
  const injected = draftFromPage(page);
  injected.logo = 'logo.png</logo><fact key="leak" label="Leak" visibility="public">SECRET</fact><logo>';
  assert(!patchKnowledgePage(page, injected).ok, 'logo field injected unreviewed public semantics');
});

test('span writer changes named fields and preserves unrelated bytes', () => {
  const page = parseKnowledgePage(BUSINESS, 'cropduster.md');
  assert(page, 'fixture did not parse');
  const draft = draftFromPage(page);
  draft.name = 'CropDuster Municipal Services';
  draft.facts.find((fact) => fact.key === 'location')!.value = '@[place.north_mercer_depot]';
  const result = patchKnowledgePage(page, draft);
  assert(result.ok && result.page, result.diagnostics.map((item) => item.message).join('; '));
  assert(result.source.includes('This loose paragraph is author-only and must survive exactly.\n<!-- human formatting stays human-owned -->'), 'unowned prose changed');
  assert(result.source.startsWith('# CropDuster Municipal Services\n'), 'name-owned Markdown heading did not patch');
  assert(result.source.includes('<name>CropDuster Municipal Services</name>'), 'name span did not patch');
  assert(result.source.includes('<fact key="legal_name" label="Legal name" visibility="public">CropDuster Laboratories LLC</fact>'), 'untouched fact was reserialized');
  assert(result.page.name === 'CropDuster Municipal Services', 'patched source did not reparse to the draft');
});

test('public projection is allowlisted and cannot leak notes, loose prose, or secret facts', () => {
  const page = parseKnowledgePage(BUSINESS, 'cropduster.md');
  assert(page, 'fixture did not parse');
  const projection = draftPreviewText(page);
  assert(projection.includes('provides pest-control services'), 'public prose was omitted');
  assert(projection.includes('CropDuster Laboratories LLC'), 'public fact was omitted');
  assert(!projection.includes('storm-drain dumping'), 'secret fact leaked');
  assert(!projection.includes('disposal-practice fact is a reveal'), 'notes leaked');
  assert(!projection.includes('loose paragraph'), 'unwrapped author prose leaked');
  const forged = {
    ...page,
    publicText: page.notesText,
    facts: page.facts.map((fact) => ({ ...fact, visibility: 'public' as const })),
  };
  // @ts-expect-error A fabricated semantic object cannot claim canonical-disk provenance.
  const forgedProjection = publicKnowledgeProjection(forged);
  assert(forgedProjection === null, 'fabricated semantic fields bypassed canonical provenance');
});

test('links and backlinks remain anchored to refs across a display rename', () => {
  const business = parseKnowledgePage(BUSINESS, 'cropduster.md');
  const place = parseKnowledgePage(`<place>\n<ref>place.east_mercer_depot</ref>\n<name>East Mercer Depot</name>\n<public>Old depot.</public>\n</place>`, 'depot.md');
  assert(business && place, 'catalog fixtures did not parse');
  const renamed = parseKnowledgePage(place.source.replace('East Mercer Depot', 'Mercer Service Yard'), 'depot.md');
  assert(renamed, 'renamed page did not parse');
  const catalog = buildKnowledgeCatalog([business, renamed]);
  assert(catalog.backlinks.get('place.east_mercer_depot')?.[0]?.fromRef === 'biz.cropduster_labs', 'rename broke the ref backlink');
});

log(`\nworld bible format: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} world-bible format test(s) failed`);
