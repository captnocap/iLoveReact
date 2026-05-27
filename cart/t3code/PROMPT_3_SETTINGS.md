# Agent Assignment: Settings.tsx

## Task
Read the source files below and write `cart/t3code/components/Settings.tsx`. Do NOT simplify. Port every settings panel, every provider card, every form. Target 1000+ lines.

## Source files to read (in /tmp/t3code/apps/web/src/)
1. `components/settings/SettingsPanels.tsx` — main settings panels
2. `components/settings/SettingsPanels.logic.ts` — panel logic
3. `components/settings/settingsLayout.tsx` — layout primitives
4. `components/settings/ProviderInstanceCard.tsx` — provider cards
5. `components/settings/ProviderSettingsForm.tsx` — provider forms
6. `components/settings/AddProviderInstanceDialog.tsx` — add provider dialog
7. `components/settings/KeybindingsSettings.tsx` — keybindings panel
8. `components/settings/ConnectionsSettings.tsx` — connections panel

## What to write
`cart/t3code/components/Settings.tsx`

## Rules
- Use `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `Switch`).
- Import types from `../types.ts`.
- The host already has `useT3Store` in `../store.ts` — read it to know what state is available.
- Replace browser APIs:
  - DOM elements → `Box` / `Text` / `Pressable`
  - Tailwind classes → inline `style` objects
  - React Query → skip or use local state
  - Dialogs / modals → render inline with `position: 'absolute'` overlays
- Keep ALL tabs from original:
  - General (theme, timestamp format, sidebar sort, confirm archive, auto-open plan)
  - Providers (instance list, add provider, driver picker, model input, enable toggle)
  - Keybindings (shortcut list)
  - Connections / Source Control (skip if too server-dependent)
- Keep provider instance cards with:
  - Driver icon/label
  - Model display
  - Enable/disable toggle
  - Remove button
- Keep add-provider flow:
  - Driver picker (Claude, Codex, Kimi, Local AI, OpenAI Compatible)
  - Label input
  - Model input
  - Add button
- Props interface:
```ts
interface SettingsProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onSetProvider: (id: string, patch: Partial<ProviderInstance>) => void;
  onAddProvider: (p: ProviderInstance) => void;
  onRemoveProvider: (id: string) => void;
  onClose: () => void;
}
```
- Export `default function SettingsPanel`.
- Dark theme, monospace fonts.

## Checklist before finishing
- [ ] Left sidebar nav (General, Providers, Keybindings)
- [ ] General tab with all settings
- [ ] Providers tab with instance cards
- [ ] Add provider form
- [ ] Keybindings tab with shortcut rows
- [ ] Close button in header
- [ ] Overlay backdrop
