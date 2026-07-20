// Controller tests stay at the persistence boundary: canonical Markdown is
// never created or replaced until a frozen proposal is explicitly confirmed.
import { WORLD_BIBLE_RECOVERY_FILE, WorldBibleController } from './controller';
import { parseKnowledgePage, type KnowledgeDraft, type KnowledgeKind } from './blockFormat';
import type { KnowledgeFilePort } from './session';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((value: string) => (globalThis as any).__writeStdout?.(`${value}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

class MapPort implements KnowledgeFilePort {
  files = new Map<string, string>();
  writes: string[] = [];
  failWrites = false;
  read(path: string) { return this.files.get(path) ?? null; }
  list(path: string) {
    const prefix = `${path.replace(/\/$/, '')}/`;
    return [...this.files.keys()]
      .filter((entry) => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('/'))
      .map((entry) => entry.slice(prefix.length));
  }
  writeAtomic(path: string, source: string) {
    this.writes.push(path);
    if (this.failWrites) return false;
    this.files.set(path, source);
    return true;
  }
  writeAtomicIfUnchanged(path: string, expected: string | null, source: string) {
    if ((this.files.get(path) ?? null) !== expected) return 'changed' as const;
    if (this.failWrites) return 'failed' as const;
    this.writes.push(path);
    this.files.set(path, source);
    return 'written' as const;
  }
  writeAtomicIfUnchangedTransient(path: string, expected: string | null, source: string) {
    return this.writeAtomicIfUnchanged(path, expected, source);
  }
  restoreAtomicIfUnchanged(path: string, expected: string | null, source: string, _retainPrevious: boolean, pendingOwnerPath: string) {
    if (this.files.get(`${path}.write-pending`) !== pendingOwnerPath) return 'changed' as const;
    return this.writeAtomicIfUnchanged(path, expected, source);
  }
  finalizePendingRecovery(path: string, expected: string, preparedPath: string, retirePrevious: boolean) {
    const pending = `${path}.write-pending`;
    const previous = `${preparedPath}.previous`;
    if (!this.files.has(pending)) {
      const alreadyFinal = this.files.get(path) === expected
        && !this.files.has(preparedPath)
        && (!retirePrevious || !this.files.has(previous));
      return alreadyFinal ? 'finalized' as const : 'changed' as const;
    }
    if (this.files.get(pending) !== preparedPath) return 'changed' as const;
    if ((this.files.get(path) ?? null) !== expected) return 'changed' as const;
    if (this.failWrites) return 'failed' as const;
    this.files.delete(preparedPath);
    if (retirePrevious) this.files.delete(previous);
    this.files.delete(pending);
    return 'finalized' as const;
  }
  removeDurable(path: string) {
    if (this.failWrites || !this.files.has(path)) return false;
    this.files.delete(path);
    return true;
  }
}

function sourceFor(ref: string, name: string, kind: KnowledgeKind = 'business'): string {
  return `# ${name}\n\nAuthor opening.\n\n<${kind}>\n  <ref>${ref}</ref>\n  <name>${name}</name>\n  <public>Public copy.</public>\n</${kind}>\n`;
}

function draftFor(ref: string, name: string, kind: KnowledgeKind = 'business'): KnowledgeDraft {
  return {
    kind,
    ref,
    name,
    logo: '',
    authorText: 'Author opening.',
    publicText: 'Public copy.',
    notesText: '',
    facts: [],
  };
}

function recover(port: MapPort, entries: Array<{ path: string; baseSource: string | null; draft: KnowledgeDraft }>): void {
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, JSON.stringify({ version: 1, entries }));
}

test('hot restart recovers a labeled draft without creating canonical source', () => {
  const port = new MapPort();
  const first = new WorldBibleController(port);
  first.ensureLoaded();
  first.beginNew('mechanic');
  first.patchDraft({ name: 'Recovered Mechanic', authorText: 'Literal design prose.' });
  const draft = first.selectedSession();
  assert(draft, 'draft was not created');
  assert(!port.files.has(WORLD_BIBLE_RECOVERY_FILE), 'edit bypassed the recovery debounce');
  assert(first.flushRecovery(), 'recovery flush failed');
  assert(port.files.has(WORLD_BIBLE_RECOVERY_FILE), 'noncanonical recovery envelope was not written');
  assert(!port.files.has(draft.path), 'canonical page was created without confirmation');

  const restarted = new WorldBibleController(port);
  restarted.ensureLoaded();
  const recovered = restarted.selectedSession();
  assert(recovered?.draft.name === 'Recovered Mechanic', 'restart did not recover the draft');
  assert(recovered.draft.authorText === 'Literal design prose.', 'author Markdown was lost from recovery');
  assert(restarted.stateFor(recovered) === 'DRAFT CHANGED', 'recovery masqueraded as canonical disk');
  assert(!port.files.has(recovered.path), 'recovery wrote canonical source');
});

test('legacy recovery drafts migrate missing authorText to empty', () => {
  const port = new MapPort();
  const legacy = draftFor('mechanic.legacy', 'Legacy', 'mechanic') as any;
  delete legacy.authorText;
  recover(port, [{ path: 'world/knowledge/mechanic-legacy.md', baseSource: null, draft: legacy }]);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(controller.selectedSession()?.draft.authorText === '', 'legacy recovery was not migrated');
});

test('unsupported recovery is preserved byte-for-byte and cannot be overwritten', () => {
  const port = new MapPort();
  const source = '{"version":2,"entries":[],"keep":"IRREPLACEABLE"}';
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, source);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!controller.hasDrafts(), 'unsupported recovery with no usable draft became a phantom draft');
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === source, 'unsupported recovery changed during close check');
  controller.beginNew('business');
  controller.patchDraft({ name: 'Must Stay In Memory' });
  assert(!controller.flushRecovery(), 'unsupported recovery was overwritten by a new draft');
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === source, 'new draft replaced unsupported recovery bytes');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-rewrite-blocked'), 'blocked recovery rewrite was not surfaced');
});

test('malformed recovery remains untouched', () => {
  const port = new MapPort();
  const source = '{not-json';
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, source);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!controller.hasDrafts(), 'malformed recovery with no usable draft became a phantom draft');
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === source, 'malformed recovery was silently normalized');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-invalid'), 'malformed recovery was not diagnosed');
});

test('close check does not initialize or write an unopened World Bible', () => {
  const port = new MapPort();
  const controller = new WorldBibleController(port);
  assert(!controller.hasDrafts(), 'an unopened World Bible reported a draft');
  assert(!controller.snapshot().loaded && port.writes.length === 0, 'close check initialized or wrote the unopened controller');
});

test('startup restores only an interrupted native claim pair', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/interrupted.md';
  const temp = `${canonical}.tmp.12345`;
  port.files.set(temp, sourceFor('biz.interrupted', 'Reviewed Proposal'));
  port.files.set(`${temp}.previous`, sourceFor('biz.interrupted', 'Durable Prior Version'));
  port.files.set(`${canonical}.write-pending`, temp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(canonical)?.includes('Durable Prior Version'), 'missing canonical pathname was not restored from the claimed prior bytes');
  assert(controller.selectedSession()?.draft.name === 'Durable Prior Version', 'restored canonical bytes were not loaded');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-claim-restored'), 'interrupted claim restoration was silent');
  assert(!port.files.has(temp), 'canonical replay marker was not durably retired');
  assert(!port.files.has(`${canonical}.write-pending`), 'canonical transaction marker was not retired after durable restore');
  assert(port.files.has(`${temp}.previous`), 'prior-version forensic backup was deleted');

  port.files.delete(canonical);
  const restarted = new WorldBibleController(port);
  restarted.ensureLoaded();
  assert(!port.files.has(canonical), 'retired claim replayed after an intentional canonical deletion');
  assert(restarted.snapshot().sessions.length === 0, 'intentionally deleted page re-entered the catalog after restore');
});

test('startup prefers the newest valid temp in an interrupted draft claim', () => {
  const port = new MapPort();
  const path = 'world/knowledge/recovered-newest.md';
  const oldEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.old', 'Older Draft') }] });
  const newEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.newest', 'Newest Draft') }] });
  const temp = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.777`;
  port.files.set(temp, newEnvelope);
  port.files.set(`${temp}.previous`, oldEnvelope);
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, temp);

  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === newEnvelope, 'newest fsynced draft envelope was not restored');
  assert(controller.selectedSession()?.draft.name === 'Newest Draft', 'restored newest draft was not loaded');
  assert(!port.files.has(temp) && !port.files.has(`${temp}.previous`), 'draft claim artifacts were not bounded after recovery');
  assert(!port.files.has(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`), 'draft transaction marker was not retired after durable restore');
});

test('an absent canonical target with only a pending marker remains blocked', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/unresolved.md';
  port.files.set(`${canonical}.write-pending`, `${canonical}.tmp.12346`);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.has(`${canonical}.write-pending`), 'unresolved pending ownership was silently cleared');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-pending-preserved'), 'unresolved pending ownership was not diagnosed');
});

test('transaction-bound pending ownership recovers its lone canonical predecessor', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/pending-predecessor.md';
  const temp = `${canonical}.tmp.12346`;
  const backup = `${temp}.previous`;
  port.files.set(backup, sourceFor('biz.pending_predecessor', 'Pending Predecessor'));
  port.files.set(`${canonical}.write-pending`, temp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(canonical)?.includes('Pending Predecessor'), 'bound predecessor was not restored');
  assert(!port.files.has(`${canonical}.write-pending`), 'bound pending ownership was not finalized');
  assert(port.files.has(backup), 'canonical prior-version history was not retained');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-claim-restored'), 'bound predecessor recovery was not diagnosed');
});

test('a newer pending transaction cannot adopt stale canonical history', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/stale-history.md';
  const staleBackup = `${canonical}.tmp.100.previous`;
  const newerTemp = `${canonical}.tmp.200`;
  port.files.set(staleBackup, sourceFor('biz.stale', 'Stale Prior Version'));
  port.files.set(newerTemp, sourceFor('biz.newer', 'Newer Prepared Version'));
  port.files.set(`${canonical}.write-pending`, newerTemp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has(canonical), 'stale history resurrected an intentionally absent canonical file');
  assert(port.files.has(staleBackup) && port.files.has(newerTemp), 'ambiguous transaction artifacts were not preserved');
  assert(port.files.has(`${canonical}.write-pending`), 'newer pending ownership was silently retired');
});

test('an old exact claim pair cannot spend a newer transaction marker', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/owner-mismatch.md';
  const oldTemp = `${canonical}.tmp.300`;
  const newerTemp = `${canonical}.tmp.301`;
  port.files.set(oldTemp, sourceFor('biz.old_proposal', 'Old Proposal'));
  port.files.set(`${oldTemp}.previous`, sourceFor('biz.old_prior', 'Old Prior'));
  port.files.set(newerTemp, sourceFor('biz.new_proposal', 'New Proposal'));
  port.files.set(`${canonical}.write-pending`, newerTemp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has(canonical), 'old claim pair adopted a differently-owned pending marker');
  assert(port.files.has(oldTemp) && port.files.has(`${oldTemp}.previous`) && port.files.has(newerTemp), 'owner-mismatched artifacts were mutated');
  assert(port.files.get(`${canonical}.write-pending`) === newerTemp, 'newer marker ownership changed');
});

test('recovery fails closed when the owner-aware restore capability is absent', () => {
  const port = new MapPort();
  (port as any).restoreAtomicIfUnchanged = undefined;
  const canonical = 'world/knowledge/no-restore-door.md';
  const temp = `${canonical}.tmp.302`;
  port.files.set(temp, sourceFor('biz.proposal', 'Prepared Proposal'));
  port.files.set(`${temp}.previous`, sourceFor('biz.prior', 'Durable Prior'));
  port.files.set(`${canonical}.write-pending`, temp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has(canonical), 'generic conditional writer bypassed the owner-aware recovery door');
  assert(port.files.has(temp) && port.files.has(`${temp}.previous`), 'recovery artifacts changed without the owner-aware door');
  assert(port.files.get(`${canonical}.write-pending`) === temp, 'pending ownership changed without the owner-aware door');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-claim-restore-failed'), 'missing recovery capability was not diagnosed');
});

test('a pending canonical temp remains armed when prior canonical bytes still exist', () => {
  const port = new MapPort();
  const canonical = 'world/knowledge/pre-claim.md';
  const current = sourceFor('biz.current', 'Current Canonical');
  const newerTemp = `${canonical}.tmp.201`;
  port.files.set(canonical, current);
  port.files.set(newerTemp, sourceFor('biz.newer', 'Prepared Proposal'));
  port.files.set(`${canonical}.write-pending`, newerTemp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(canonical) === current, 'prepared proposal replaced canonical bytes during startup');
  assert(port.files.has(newerTemp), 'unresolved prepared proposal was silently deleted');
  assert(port.files.has(`${canonical}.write-pending`), 'pending ownership was retired while its prepared temp survived');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-pending-preserved'), 'pre-claim interruption was not diagnosed');
});

test('interrupted draft recovery falls back to a valid predecessor', () => {
  const port = new MapPort();
  const path = 'world/knowledge/recovered-fallback.md';
  const priorEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.fallback', 'Fallback Draft') }] });
  const temp = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.778`;
  port.files.set(temp, '{bad newest envelope');
  port.files.set(`${temp}.previous`, priorEnvelope);
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, temp);

  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === priorEnvelope, 'valid claimed predecessor was not restored');
  assert(controller.selectedSession()?.draft.name === 'Fallback Draft', 'fallback draft was not loaded');
  assert(!port.files.has(temp) && !port.files.has(`${temp}.previous`), 'fallback claim artifacts were not retired');
});

test('transaction-bound pending ownership recovers a draft predecessor whose temp is missing', () => {
  const port = new MapPort();
  const path = 'world/knowledge/draft-predecessor.md';
  const backup = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.781.previous`;
  const priorEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.draft_predecessor', 'Draft Predecessor') }] });
  port.files.set(backup, priorEnvelope);
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, `${WORLD_BIBLE_RECOVERY_FILE}.tmp.781`);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === priorEnvelope, 'bound draft predecessor was not restored');
  assert(controller.selectedSession()?.draft.name === 'Draft Predecessor', 'restored predecessor did not become the recovery draft');
  assert(!port.files.has(backup) && !port.files.has(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`), 'bound draft transaction was not finalized');
});

test('a newer pending draft transaction cannot adopt stale draft history', () => {
  const port = new MapPort();
  const path = 'world/knowledge/draft-stale.md';
  const staleBackup = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.100.previous`;
  const newerTemp = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.200`;
  port.files.set(staleBackup, JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.stale_draft', 'Stale Draft') }] }));
  port.files.set(newerTemp, JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.new_draft', 'New Draft') }] }));
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, newerTemp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has(WORLD_BIBLE_RECOVERY_FILE), 'stale draft history was installed as current recovery');
  assert(controller.snapshot().sessions.length === 0, 'stale history became an editor draft');
  assert(port.files.has(staleBackup) && port.files.has(newerTemp), 'ambiguous draft transaction artifacts were not preserved');
  assert(port.files.has(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`), 'newer draft pending ownership was silently retired');
});

test('a pending draft temp remains armed when the prior envelope still exists', () => {
  const port = new MapPort();
  const currentPath = 'world/knowledge/current-draft.md';
  const currentEnvelope = JSON.stringify({ version: 1, entries: [{ path: currentPath, baseSource: null, draft: draftFor('biz.current_draft', 'Current Draft') }] });
  const newerTemp = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.201`;
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, currentEnvelope);
  port.files.set(newerTemp, JSON.stringify({ version: 1, entries: [{ path: currentPath, baseSource: null, draft: draftFor('biz.new_draft', 'Prepared Draft') }] }));
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, newerTemp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === currentEnvelope, 'prepared draft replaced the current recovery envelope during startup');
  assert(port.files.has(newerTemp), 'unresolved prepared draft was silently deleted');
  assert(port.files.has(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`), 'draft pending ownership was retired while its prepared temp survived');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-pending-preserved'), 'pre-claim draft interruption was not diagnosed');
});

test('failed lock-scoped finalization preserves every draft artifact', () => {
  class FinalizeChangedPort extends MapPort {
    finalizePendingRecovery(_path: string, _expected: string, _prepared: string, _retirePrevious: boolean) {
      return 'changed' as const;
    }
  }
  const port = new FinalizeChangedPort();
  const path = 'world/knowledge/finalize-race.md';
  const temp = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.401`;
  const priorEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.prior', 'Prior Draft') }] });
  const nextEnvelope = JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.next', 'Next Draft') }] });
  port.files.set(temp, nextEnvelope);
  port.files.set(`${temp}.previous`, priorEnvelope);
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`, temp);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === nextEnvelope, 'validated draft restore did not reach its target');
  assert(port.files.has(temp) && port.files.has(`${temp}.previous`), 'controller used raw-removal fallback after finalization changed');
  assert(port.files.get(`${WORLD_BIBLE_RECOVERY_FILE}.write-pending`) === temp, 'controller removed ownership after finalization changed');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-pending-finalize-changed'), 'failed finalization was not diagnosed');
});

test('successful transient draft writes leave bounded predecessor history', () => {
  const port = new MapPort();
  const source = JSON.stringify({ version: 1, entries: [] });
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, source);
  port.files.set(`${WORLD_BIBLE_RECOVERY_FILE}.tmp.779.previous`, source);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has(`${WORLD_BIBLE_RECOVERY_FILE}.tmp.779.previous`), 'orphan app-owned predecessor was not pruned');
});

test('a valid lone draft predecessor survives a malformed current envelope', () => {
  const port = new MapPort();
  const path = 'world/knowledge/predecessor.md';
  const backup = `${WORLD_BIBLE_RECOVERY_FILE}.tmp.780.previous`;
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, '{malformed current');
  port.files.set(backup, JSON.stringify({ version: 1, entries: [{ path, baseSource: null, draft: draftFor('biz.predecessor', 'Preserved Predecessor') }] }));
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(port.files.has(backup), 'the last valid predecessor was deleted behind a malformed current envelope');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-claim-predecessor-preserved'), 'preserved predecessor was not surfaced');
  controller.beginNew('business');
  assert(!controller.flushRecovery(), 'automatic draft rewrite bypassed the preserved-predecessor block');
});

test('a lone prior-version backup never resurrects an intentional deletion', () => {
  const port = new MapPort();
  port.files.set('world/knowledge/deleted.md.tmp.12345.previous', sourceFor('biz.deleted', 'Deleted On Purpose'));
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!port.files.has('world/knowledge/deleted.md'), 'history backup resurrected a canonical file without an interrupted temp marker');
  assert(controller.snapshot().sessions.length === 0, 'intentionally absent page entered the catalog');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'canonical-prior-version-retained'), 'retained prior-version inode was invisible to the author');
});

test('recovery targets outside canonical source paths are rejected', () => {
  const port = new MapPort();
  recover(port, [{ path: 'world/knowledge/../escape.md', baseSource: null, draft: draftFor('biz.escape', 'Escape') }]);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(controller.snapshot().sessions.length === 0, 'unsafe recovery path became a session');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-path-invalid'), 'unsafe path rejection was not surfaced');
});

test('catalog diagnostics include recovered duplicate refs and unresolved links', () => {
  const port = new MapPort();
  const first = draftFor('biz.duplicate', 'First');
  first.facts.push({ key: 'missing_owner', label: 'Missing owner', value: '@[npc.missing]', visibility: 'author' });
  recover(port, [
    { path: 'world/knowledge/first.md', baseSource: null, draft: first },
    { path: 'world/knowledge/second.md', baseSource: null, draft: draftFor('biz.duplicate', 'Second') },
  ]);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  const diagnostics = controller.snapshot().diagnostics;
  assert(diagnostics.some((item) => item.code === 'ref-duplicate'), 'duplicate ref was not diagnosed');
  assert(diagnostics.some((item) => item.code === 'ref-unresolved'), 'unresolved ref was not diagnosed');
  assert(!controller.reviewSelected(), 'ambiguous ref reached formal review');
  assert(controller.snapshot().notice.includes('ambiguous'), 'collision review block was not explained');
});

test('selection remains path-safe when refs collide', () => {
  const port = new MapPort();
  recover(port, [
    { path: 'world/knowledge/first.md', baseSource: null, draft: draftFor('biz.duplicate', 'First') },
    { path: 'world/knowledge/second.md', baseSource: null, draft: draftFor('biz.duplicate', 'Second') },
  ]);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  controller.selectPath('world/knowledge/second.md');
  assert(controller.selectedSession()?.draft.name === 'Second', 'path selection chose the wrong duplicate ref');
  controller.select('biz.duplicate');
  assert(controller.selectedSession()?.draft.name === 'Second', 'ambiguous ref selection changed identity');
  assert(controller.snapshot().notice.includes('ambiguous'), 'ambiguous ref selection was silent');
});

test('review blocks a recovered new draft whose target file now exists', () => {
  const port = new MapPort();
  const path = 'world/knowledge/claimed-target.md';
  recover(port, [{ path, baseSource: null, draft: draftFor('biz.new_draft', 'New Draft') }]);
  port.files.set(path, sourceFor('biz.disk_owner', 'Disk Owner'));
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!controller.reviewSelected(), 'new draft was allowed to overwrite an existing target');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'path-duplicate'), 'target-path collision was not diagnosed');
});

test('recovery writes coalesce until flush and failures remain diagnosed', () => {
  const port = new MapPort();
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  controller.beginNew('business');
  controller.patchDraft({ name: 'One' });
  controller.patchDraft({ name: 'Two' });
  assert(port.writes.length === 0, 'an edit synchronously wrote the recovery envelope');
  port.failWrites = true;
  assert(!controller.flushRecovery(), 'failed recovery write reported success');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-write-failed'), 'failed recovery write was not persistent');
  port.failWrites = false;
  assert(controller.flushRecovery(), 'recovery did not resume after a failure');
  assert(!controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-write-failed'), 'successful recovery did not clear failure diagnostic');
});

test('a valid empty recovery envelope does not create a phantom close guard', () => {
  const port = new MapPort();
  port.files.set(WORLD_BIBLE_RECOVERY_FILE, JSON.stringify({ version: 1, entries: [] }));
  port.failWrites = true;
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!controller.hasDrafts(), 'empty recovery envelope became a phantom draft');
  assert(!controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-write-failed'), 'harmless empty recovery triggered a needless rewrite');
});

test('close guard stays armed when a redundant recovered entry cannot be cleared', () => {
  const port = new MapPort();
  const path = 'world/knowledge/clean-recovery.md';
  const source = sourceFor('biz.clean_recovery', 'Clean Recovery');
  port.files.set(path, source);
  recover(port, [{ path, baseSource: source, draft: draftFor('biz.clean_recovery', 'Clean Recovery') }]);
  port.failWrites = true;
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(controller.hasDrafts(), 'failed stale recovery cleanup was treated as safe to close');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-write-failed'), 'stale recovery cleanup failure was not surfaced');
});

test('two editor processes cannot overwrite each other recovery envelopes', () => {
  const port = new MapPort();
  const first = new WorldBibleController(port);
  const second = new WorldBibleController(port);
  first.ensureLoaded();
  second.ensureLoaded();
  first.beginNew('business');
  first.patchDraft({ name: 'First Process Draft' });
  second.beginNew('person');
  second.patchDraft({ name: 'Second Process Draft' });
  assert(first.flushRecovery(), 'first process could not establish recovery');
  const firstBytes = port.files.get(WORLD_BIBLE_RECOVERY_FILE);
  assert(!second.flushRecovery(), 'second process overwrote a concurrently established recovery');
  assert(port.files.get(WORLD_BIBLE_RECOVERY_FILE) === firstBytes, 'first process recovery bytes were lost');
  assert(second.snapshot().diagnostics.some((item) => item.code === 'draft-recovery-concurrent-change'), 'concurrent recovery ownership conflict was not surfaced');
});

test('discard is a request and requires explicit confirmation', () => {
  const port = new MapPort();
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  controller.beginNew('business');
  controller.patchDraft({ name: 'Keep Until Confirmed' });
  controller.flushRecovery();
  const path = controller.selectedSession()!.path;

  controller.revertSelected();
  assert(controller.snapshot().pendingDiscard === 'revert', 'revert did not enter confirmation state');
  assert(controller.snapshot().sessions.some((session) => session.path === path), 'one click erased the draft');
  controller.cancelDiscard();
  assert(controller.snapshot().pendingDiscard === null, 'cancel did not clear discard request');
  assert(controller.snapshot().sessions.some((session) => session.path === path), 'cancel erased the draft');

  assert(controller.requestDiscard('revert'), 'second discard request failed');
  assert(controller.confirmDiscard(), 'explicit discard confirmation failed');
  assert(!controller.snapshot().sessions.some((session) => session.path === path), 'confirmed new-page discard retained the draft');
  const envelope = JSON.parse(port.files.get(WORLD_BIBLE_RECOVERY_FILE)!);
  assert(envelope.entries.length === 0, 'confirmed discard remained in recovery');
});

test('malformed external reload preserves a divergent draft with a diagnostic', () => {
  const port = new MapPort();
  const path = 'world/knowledge/reload.md';
  const baseSource = sourceFor('biz.reload', 'Reload');
  const changed = draftFor('biz.reload', 'Changed Draft');
  recover(port, [{ path, baseSource, draft: changed }]);
  port.files.set(path, '<business><ref>broken');
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(!controller.requestDiscard('reload'), 'malformed disk entered destructive confirmation');
  assert(controller.selectedSession()?.draft.name === 'Changed Draft', 'malformed reload erased the draft');
  assert(controller.snapshot().diagnostics.some((item) => item.code === 'external-reload-malformed'), 'malformed reload was not surfaced');
});

test('valid external reload also requires confirmation before replacing a draft', () => {
  const port = new MapPort();
  const path = 'world/knowledge/reload-confirm.md';
  const baseSource = sourceFor('biz.reload_confirm', 'Loaded Base');
  const diskSource = sourceFor('biz.reload_confirm', 'External Revision');
  recover(port, [{ path, baseSource, draft: draftFor('biz.reload_confirm', 'In-App Draft') }]);
  port.files.set(path, diskSource);
  const controller = new WorldBibleController(port);
  controller.ensureLoaded();
  assert(controller.requestDiscard('reload'), 'valid reload did not enter confirmation');
  assert(controller.selectedSession()?.draft.name === 'In-App Draft', 'reload request erased the draft before confirmation');
  assert(controller.snapshot().pendingDiscard === 'reload', 'reload confirmation state was not surfaced');
  assert(controller.confirmDiscard(), 'confirmed reload failed');
  assert(controller.selectedSession()?.draft.name === 'External Revision', 'confirmed reload did not adopt canonical disk');
});

test('refresh removes externally deleted clean sessions but retains dirty ones as conflicts', () => {
  const cleanPort = new MapPort();
  const cleanPath = 'world/knowledge/clean-refresh.md';
  const cleanSource = sourceFor('biz.clean_refresh', 'Clean Refresh');
  const cleanPage = parseKnowledgePage(cleanSource, cleanPath);
  assert(cleanPage, 'clean fixture did not parse');
  recover(cleanPort, [{ path: cleanPath, baseSource: cleanSource, draft: draftFor('biz.clean_refresh', 'Clean Refresh') }]);
  cleanPort.files.set(cleanPath, cleanSource);
  const cleanController = new WorldBibleController(cleanPort);
  cleanController.ensureLoaded();
  cleanPort.files.delete(cleanPath);
  cleanController.refreshDisk();
  assert(!cleanController.snapshot().sessions.some((session) => session.path === cleanPath), 'deleted clean session survived refresh');

  const dirtyPort = new MapPort();
  const dirtyPath = 'world/knowledge/dirty-refresh.md';
  const dirtySource = sourceFor('biz.dirty_refresh', 'Dirty Refresh');
  recover(dirtyPort, [{ path: dirtyPath, baseSource: dirtySource, draft: draftFor('biz.dirty_refresh', 'Dirty Draft') }]);
  dirtyPort.files.set(dirtyPath, dirtySource);
  const dirtyController = new WorldBibleController(dirtyPort);
  dirtyController.ensureLoaded();
  dirtyPort.files.delete(dirtyPath);
  dirtyController.refreshDisk();
  const retained = dirtyController.snapshot().sessions.find((session) => session.path === dirtyPath);
  assert(retained, 'deleted dirty session was dropped');
  assert(dirtyController.stateFor(retained) === 'CONFLICT', 'deleted dirty session did not become a conflict');
});

log(`\nworld bible controller: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} world-bible controller test(s) failed`);
