import { SettingRegistry, SettingsStore, jsonFileSettingsBackend } from '../../../runtime/settings';

export const editorSettingRegistry = new SettingRegistry();

export const AUTOSAVE_ENABLED = editorSettingRegistry.register({
  id: 'documents.autosave.enabled',
  section: 'Documents',
  label: 'Autosave',
  description: 'Write changes to documents that already exist on disk.',
  kind: 'boolean',
  defaultValue: true,
});

export const AUTOSAVE_DELAY_MS = editorSettingRegistry.register({
  id: 'documents.autosave.delay_ms',
  section: 'Documents',
  label: 'Autosave delay (ms)',
  description: 'Wait this long after the last change before writing.',
  kind: 'number',
  defaultValue: 400,
  min: 100,
  max: 10_000,
  step: 100,
});

export type HotUpdatePolicy = 'automatic' | 'ask' | 'off';

export const HOT_UPDATE_POLICY = editorSettingRegistry.register<HotUpdatePolicy>({
  id: 'development.hot_update.policy',
  section: 'Development',
  label: 'Carry working state over code updates',
  description: 'Choose whether a development bundle update applies immediately, asks first, or waits.',
  kind: 'enum',
  defaultValue: 'automatic',
  options: [
    { value: 'automatic', label: 'Automatic' },
    { value: 'ask', label: 'Ask' },
    { value: 'off', label: 'Off' },
  ],
});

export const editorSettings = new SettingsStore(
  editorSettingRegistry,
  jsonFileSettingsBackend('reactjit/editor'),
);
editorSettings.load();

export type EditorPersistenceSettings = Readonly<{
  autosave: boolean;
  autosaveDelayMs: number;
  hotUpdate: HotUpdatePolicy;
}>;

export function editorPersistenceSettings(): EditorPersistenceSettings {
  return {
    autosave: editorSettings.get(AUTOSAVE_ENABLED),
    autosaveDelayMs: editorSettings.get(AUTOSAVE_DELAY_MS),
    hotUpdate: editorSettings.get(HOT_UPDATE_POLICY),
  };
}
