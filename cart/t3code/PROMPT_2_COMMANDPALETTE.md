# Agent Assignment: CommandPalette.tsx

## Task
Read the source files below and write `cart/t3code/components/CommandPalette.tsx`. Do NOT simplify. Port every mode, every action group, every browse behavior. Target 1200+ lines.

## Source files to read (in /tmp/t3code/apps/web/src/)
1. `components/CommandPalette.tsx` — main file, read the ENTIRE thing
2. `components/CommandPalette.logic.ts` — all helper logic
3. `components/CommandPaletteResults.tsx` — result rendering
4. `components/ProjectFavicon.tsx` — used in palette items
5. `components/ThreadStatusIndicators.tsx` — status pills

## What to write
`cart/t3code/components/CommandPalette.tsx`

## Rules
- Use `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `TextInput`).
- Import types from `../types.ts`.
- The host already has `useT3Store` in `../store.ts` — read it to know what state is available.
- Replace browser APIs:
  - DOM elements → `Box` / `Text` / `Pressable`
  - Tailwind classes → inline `style` objects
  - `useNavigate` → skip, call `onSelectThread` / `onNewThread` props instead
  - `useQuery` for filesystem browse → use `__fs_list_json` or `__exec` to browse
  - React Query `prefetchQuery` → skip
- Keep ALL modes from original:
  - Root mode (recent threads, projects, actions)
  - Browse mode (`~/` paths, directory traversal)
  - Submenu mode (nested views with back button)
  - Add-project flow (local folder browse + clone)
- Keep ALL action items:
  - New thread in project
  - Open project
  - Open thread
  - Add project (browse + clone sources)
  - Settings
  - Close palette
- Keep the view stack (push/pop palette views).
- Keep highlighted item navigation (↑↓).
- Keep shortcut labels.
- Props interface:
```ts
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  threads: Thread[];
  projects: Project[];
  activeThreadId: ThreadId | null;
  settings: Settings;
  onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void;
  onOpenSettings: () => void;
}
```
- Export `default function CommandPalette`.
- Dark theme, monospace fonts.

## Checklist before finishing
- [ ] Fuzzy search across threads, projects, actions
- [ ] Highlighted item state with keyboard navigation
- [ ] Browse mode triggered by `~/` or `/` queries
- [ ] Submenu push/pop with back navigation
- [ ] Add-project flow (local folder + git clone sources)
- [ ] Recent threads section
- [ ] All actions from original
- [ ] Footer with shortcut hints
