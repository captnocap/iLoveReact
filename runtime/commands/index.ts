// commands — the native-application command authority.
//
// CommandRegistry exposes frozen declarations to menus, keybindings, toolbars,
// context menus, palettes, and remote peers. CommandAuthority owns the only
// handler entrance and publishes one applied/rejected outcome per invocation.
// keychord.ts supplies the shared chord normalizer and mode-aware registry keys.
export * from './keychord';
export * from './command';
