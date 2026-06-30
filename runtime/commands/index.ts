// commands — the editor command + keybinding registry.
//
// The text menu is the source of truth: every editor action is one CommandDef
// (command.ts), registered once and reachable both from its menu
// (commandsByMenu) and from its hotkey (resolveHotkey). Commands EMIT authoring
// events on the editorbus; they never mutate state. keychord.ts is the chord
// parser/normalizer the hotkey index resolves through.
export * from './keychord';
export * from './command';
