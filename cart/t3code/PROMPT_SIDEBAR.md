# Worker: Sidebar

Read `/tmp/t3code/apps/web/src/components/Sidebar.tsx`, `Sidebar.logic.ts`, `ThreadStatusIndicators.tsx`, `AppSidebarLayout.tsx`, and `/tmp/t3code/apps/web/src/lib/threadSort.ts`.

Write `cart/t3code/components/Sidebar.tsx`. Use primitives from `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `TextInput`). Import types from `../types.ts`.

Props interface:
```ts
interface SidebarProps {
  threads: Thread[]; projects: Project[]; activeThreadId: ThreadId | null;
  settings: Settings; onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void; onArchiveThread: (id: ThreadId) => void;
  onDeleteThread: (id: ThreadId) => void; onRenameThread: (id: ThreadId, title: string) => void;
  onOpenSettings: () => void; onOpenCommandPalette: () => void;
  terminalOpenByThreadId: Record<ThreadId, boolean>;
}
```

Port all behavior 1:1. Dark theme, monospace fonts. Call `installBrowserShims()` from `@reactjit/runtime/hooks` at module top if you need `localStorage`.
