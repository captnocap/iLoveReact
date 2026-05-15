# Worker: TerminalDrawer

Read `/tmp/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`, `/tmp/t3code/apps/web/src/terminalStateStore.ts`, `/tmp/t3code/apps/web/src/lib/terminalContext.ts`, `/tmp/t3code/apps/web/src/components/ThreadTerminalDrawer.browser.tsx`, and `/tmp/t3code/apps/web/src/keybindings.ts`.

Write `cart/t3code/components/TerminalDrawer.tsx`.

Use primitives from `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `Terminal`, `TextInput`). Import `useTerminal` from `@reactjit/runtime/hooks/useTerminal`. Import types from `../types.ts`.

Props:
```ts
interface TerminalDrawerProps {
  threadId: ThreadId | null; visible: boolean; height: number;
  terminalIds: string[]; activeTerminalId: string;
  terminalGroups: TerminalGroup[]; activeTerminalGroupId: string;
  onHeightChange: (height: number) => void;
  onSplitTerminal: () => void; onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onAddTerminalContext: (ctx: TerminalContextSelection) => void;
  splitShortcutLabel?: string; newShortcutLabel?: string; closeShortcutLabel?: string;
}
```

The `<Terminal>` primitive takes `shell={string}` and optionally `terminal_id={number}`. Use `shell="bash"` for new terminals.

Port 1:1: tab bar with active/hover states, split/new/close buttons, resize handle, drawer height clamping, terminal group tabs, keyboard shortcuts.
