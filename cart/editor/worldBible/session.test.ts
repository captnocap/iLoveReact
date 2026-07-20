// World Bible disk/base/draft/write-door tests. See blockFormat.test.ts for the
// standalone v8cli invocation pattern.
import type { KnowledgeFilePort } from './session';
import {
  confirmKnowledgeWrite,
  knowledgeSourceState,
  openKnowledgeSession,
  prepareKnowledgeWrite,
  refreshKnowledgeDisk,
  revertKnowledgeDraft,
  setKnowledgeDraft,
  newKnowledgeSession,
} from './session';
import { publicKnowledgeProjection } from './model';
import type { CanonicalKnowledgePage } from './canonical';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const SOURCE = `<business>
  <ref>biz.example</ref>
  <name>Example, Inc.</name>
  <fact key="location" label="Location" visibility="public">@[place.example]</fact>
  <public>
An ordinary company.
  </public>
</business>

<notes>
Designer-only context.
</notes>
`;

class MemoryPort implements KnowledgeFilePort {
  writes = 0;
  failWrite = false;
  raceSource: string | null | undefined = undefined;
  constructor(public source: string | null) {}
  read() { return this.source; }
  writeAtomic(_path: string, source: string) {
    this.writes += 1;
    if (this.failWrite) return false;
    this.source = source;
    return true;
  }
  writeAtomicIfUnchanged(_path: string, expected: string | null, source: string) {
    if (this.raceSource !== undefined) {
      this.source = this.raceSource;
      this.raceSource = undefined;
    }
    if (this.source !== expected) return 'changed' as const;
    if (this.failWrite) return 'failed' as const;
    this.writes += 1;
    this.source = source;
    return 'written' as const;
  }
}

function editedSession() {
  const opened = openKnowledgeSession('world/knowledge/example.md', SOURCE);
  const draft = { ...opened.draft, facts: opened.draft.facts.map((fact) => ({ ...fact })) };
  draft.name = 'Example Municipal';
  return setKnowledgeDraft(opened, draft);
}

test('open is DISK and draft mutation never calls the writer', () => {
  const port = new MemoryPort(SOURCE);
  const opened = openKnowledgeSession('world/knowledge/example.md', SOURCE);
  assert(knowledgeSourceState(opened) === 'DISK', 'open was not disk-clean');
  const edited = setKnowledgeDraft(opened, { ...opened.draft, name: 'Changed', facts: opened.draft.facts });
  assert(knowledgeSourceState(edited) === 'DRAFT CHANGED', 'edit did not become a divergent draft');
  assert(port.writes === 0 && port.source === SOURCE, 'draft edit touched canonical bytes');
});

test('review freezes the exact path, hash, semantic changes, and text patch', () => {
  const session = editedSession();
  const result = prepareKnowledgeWrite(session, SOURCE);
  assert(result.ok, result.ok ? '' : result.error);
  assert(result.proposal.path === 'world/knowledge/example.md', 'proposal hid its target path');
  assert(result.proposal.expectedDiskHash === session.baseHash, 'proposal did not freeze the base hash');
  assert(result.proposal.changes.some((change) => change.key === 'name'), 'semantic change missing');
  assert(result.proposal.patch.includes('-   <name>Example, Inc.</name>') && result.proposal.patch.includes('+   <name>Example Municipal</name>'), 'exact text patch missing');
});

test('confirmation is the only write door and reparses accepted bytes', () => {
  const port = new MemoryPort(SOURCE);
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, port.read(''));
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  assert(port.writes === 0, 'review wrote before confirmation');
  const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
  assert(confirmed.ok, confirmed.ok ? '' : confirmed.error);
  assert(port.writes === 1, 'confirmation did not use exactly one atomic write');
  assert(confirmed.page.name === 'Example Municipal', 'confirmed bytes did not reparse');
  assert(knowledgeSourceState(confirmed.session) === 'DISK', 'confirmed session did not reset its base');
});

test('external edit becomes DISK CHANGED or CONFLICT and cannot be overwritten', () => {
  const clean = openKnowledgeSession('world/knowledge/example.md', SOURCE);
  const external = SOURCE.replace('ordinary company', 'externally changed company');
  assert(knowledgeSourceState(refreshKnowledgeDisk(clean, external)) === 'DISK CHANGED', 'clean external edit was not detected');
  const local = editedSession();
  const conflict = refreshKnowledgeDisk(local, external);
  assert(knowledgeSourceState(conflict) === 'CONFLICT', 'two-sided edit was not a conflict');
  const blocked = prepareKnowledgeWrite(local, external);
  assert(!blocked.ok && blocked.state === 'CONFLICT', 'review prepared over an external edit');
});

test('a disk change after review invalidates confirmation without a write', () => {
  const port = new MemoryPort(SOURCE);
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, SOURCE);
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  port.source = SOURCE.replace('ordinary company', 'late external edit');
  const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
  assert(!confirmed.ok && confirmed.state === 'CONFLICT', 'stale proposal was accepted');
  assert(port.writes === 0, 'stale proposal invoked the writer');
});

test('an edit at the final expected-content check is rejected', () => {
  const port = new MemoryPort(SOURCE);
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, SOURCE);
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  port.raceSource = SOURCE.replace('ordinary company', 'boundary race');
  const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
  assert(!confirmed.ok && confirmed.error.includes('final expected-content check'), 'boundary race overwrote canonical source');
  assert(port.writes === 0 && port.source?.includes('boundary race'), 'expected-content check did not preserve the racing edit');
});

test('confirmation authenticates the complete reviewed proposal payload', () => {
  const port = new MemoryPort(SOURCE);
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, SOURCE);
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  const tampered = { ...prepared.proposal, after: prepared.proposal.after.replace('Example Municipal', 'Injected Name') };
  const confirmed = confirmKnowledgeWrite(prepared.session, tampered, port);
  assert(!confirmed.ok && confirmed.error.includes('altered'), 'mutated proposal retained write authority');
  assert(port.writes === 0 && port.source === SOURCE, 'mutated proposal reached the writer');
});

test('confirmation rejects a draft changed after review', () => {
  const port = new MemoryPort(SOURCE);
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, SOURCE);
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  const changedAgain = setKnowledgeDraft(prepared.session, { ...prepared.session.draft, name: 'Changed Again', facts: prepared.session.draft.facts });
  const confirmed = confirmKnowledgeWrite(changedAgain, prepared.proposal, port);
  assert(!confirmed.ok && confirmed.error.includes('draft changed'), 'stale reviewed semantics retained write authority');
  assert(port.writes === 0, 'changed draft reached the writer');
});

test('failed atomic write leaves canonical bytes and draft divergence intact', () => {
  const port = new MemoryPort(SOURCE);
  port.failWrite = true;
  const session = editedSession();
  const prepared = prepareKnowledgeWrite(session, SOURCE);
  assert(prepared.ok, prepared.ok ? '' : prepared.error);
  const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
  assert(!confirmed.ok, 'failed writer was reported as success');
  assert(port.source === SOURCE, 'failed writer changed canonical bytes');
  assert(knowledgeSourceState(confirmed.session) === 'DRAFT CHANGED', 'draft was discarded after failed write');
});

test('revert is explicit and restores the loaded base', () => {
  const reverted = revertKnowledgeDraft(editedSession());
  assert(reverted.draft.name === 'Example, Inc.' && knowledgeSourceState(reverted) === 'DISK', 'revert did not restore base');
});

test('a new page still requires review and confirmation against file absence', () => {
  const port = new MemoryPort(null);
  const session = newKnowledgeSession('world/knowledge/new-place.md', {
    kind: 'place', ref: 'place.new_place', name: 'New Place', logo: '',
    authorText: '', publicText: 'A newly established place.', notesText: 'Still only a draft.', facts: [],
  });
  const prepared = prepareKnowledgeWrite(session, port.read(''));
  assert(prepared.ok && prepared.proposal.expectedDiskHash === null, prepared.ok ? 'new proposal expected an existing file' : prepared.error);
  assert(port.writes === 0 && port.source === null, 'new page appeared before confirmation');
  const confirmed = confirmKnowledgeWrite(prepared.session, prepared.proposal, port);
  assert(confirmed.ok && confirmed.page.ref === 'place.new_place', confirmed.ok ? 'wrong page written' : confirmed.error);
});

test('canonical path policy rejects recovery traversal before review', () => {
  const malicious = newKnowledgeSession('world/knowledge/../../docs/game/DECISIONS.md', {
    kind: 'mechanic', ref: 'mechanic.bad_path', name: 'Bad Path', logo: '', authorText: '',
    publicText: '', notesText: 'Never write outside the root.', facts: [],
  });
  const prepared = prepareKnowledgeWrite(malicious, null);
  assert(!prepared.ok && prepared.error.includes('outside'), 'path traversal reached proposal creation');
});

test('identity-only drift is divergent and cannot masquerade as disk', () => {
  const opened = openKnowledgeSession('world/knowledge/example.md', SOURCE);
  const drifted = setKnowledgeDraft(opened, { ...opened.draft, kind: 'person', ref: 'npc.example', facts: opened.draft.facts });
  assert(knowledgeSourceState(drifted) === 'DRAFT CHANGED', 'kind/ref drift was reported as DISK');
  const prepared = prepareKnowledgeWrite(drifted, SOURCE);
  assert(!prepared.ok, 'existing identity rewrite reached confirmation review');
});

test('a parsed session base cannot claim canonical public provenance', () => {
  const session = editedSession();
  assert(session.basePage, 'base page missing');
  const projection = publicKnowledgeProjection(session.basePage as CanonicalKnowledgePage);
  assert(projection === null, 'a caller assertion manufactured canonical public provenance');
});

log(`\nworld bible session: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} world-bible session test(s) failed`);
