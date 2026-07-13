import { memorySettingsBackend, SettingRegistry, SettingsStore } from './setting';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

function fixture(initial: string | null = null) {
  const registry = new SettingRegistry();
  const autosave = registry.register({ id: 'files.autosave', section: 'Files', label: 'Autosave', description: 'Save materialized documents', kind: 'boolean', defaultValue: true });
  const delay = registry.register({ id: 'files.delay', section: 'Files', label: 'Delay', description: 'Autosave delay', kind: 'number', defaultValue: 400, min: 100, max: 5000, step: 100 });
  const reload = registry.register({ id: 'dev.reload', section: 'Development', label: 'Reload', description: 'Code update policy', kind: 'enum', defaultValue: 'automatic', options: [{ value: 'automatic', label: 'Automatic' }, { value: 'ask', label: 'Ask' }, { value: 'off', label: 'Off' }] });
  const backend = memorySettingsBackend(initial);
  const store = new SettingsStore(registry, backend);
  store.load();
  return { registry, autosave, delay, reload, backend, store };
}

test('schema validates defaults and duplicate identities', () => {
  const { registry } = fixture();
  let duplicate = false;
  try { registry.register({ id: 'files.autosave', section: 'Files', label: 'Again', description: '', kind: 'boolean', defaultValue: true }); } catch { duplicate = true; }
  assert(duplicate, 'duplicate setting id was accepted');
});

test('writes one versioned config and reloads validated values', () => {
  const first = fixture();
  assert(first.store.set(first.autosave, false), 'boolean set failed');
  assert(first.store.set(first.delay, 725), 'number set failed');
  assert(first.store.set(first.reload, 'ask'), 'enum set failed');
  assert(first.store.get(first.delay) === 700, 'number did not clamp to the declared step');
  const second = fixture(first.backend.text());
  assert(second.store.get(second.autosave) === false, 'boolean did not reload');
  assert(second.store.get(second.delay) === 700, 'number did not reload');
  assert(second.store.get(second.reload) === 'ask', 'enum did not reload');
});

test('invalid persisted values fall back independently', () => {
  const { store, autosave, delay, reload } = fixture(JSON.stringify({ version: 1, values: { 'files.autosave': 'yes', 'files.delay': 9000, 'dev.reload': 'explode' } }));
  assert(store.get(autosave) === true, 'invalid boolean replaced default');
  assert(store.get(delay) === 5000, 'bounded number was not clamped');
  assert(store.get(reload) === 'automatic', 'invalid enum replaced default');
});

test('subscribers receive effective changes and reset', () => {
  const { store, autosave } = fixture();
  const seen: string[] = [];
  const stop = store.subscribe((id, value) => seen.push(`${id}:${value}`));
  store.set(autosave, false);
  store.reset(autosave);
  stop();
  store.set(autosave, false);
  assert(seen.join('|') === 'files.autosave:false|files.autosave:true', `unexpected notifications: ${seen.join('|')}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
