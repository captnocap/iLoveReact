# Agent Assignment: ChatView.tsx

## Task
Read the source files below and write `cart/t3code/components/ChatView.tsx`. Do NOT simplify. Port every hook, every sub-component, every piece of state management that makes sense in reactjit. Target 1500+ lines.

## Source files to read (in /tmp/t3code/apps/web/src/)
1. `components/ChatView.tsx` — main file, read the ENTIRE thing
2. `components/chat/ChatHeader.tsx` — ChatView renders this
3. `components/NoActiveThreadState.tsx` — empty state
4. `components/chat/ProviderStatusBanner.tsx` — banner inside chat
5. `components/chat/ThreadErrorBanner.tsx` — error banner
6. `components/chat/ComposerBannerStack.tsx` — banner stack
7. `components/ChatView.logic.ts` — helper logic

## What to write
`cart/t3code/components/ChatView.tsx`

## Rules
- Use `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `TextArea`, `Terminal`).
- Use `@reactjit/runtime/hooks/useAssistant` for assistant state.
- Import types from `../types.ts`.
- The host already has `useT3Store` in `../store.ts` — read it to know what state is available.
- Replace browser APIs:
  - `localStorage` → `__store_get` / `__store_set` (or just use it, shims are installed)
  - `window.addEventListener` → okay to use, shims handle it
  - `fetch` → `__http_get` / `__http_post`
  - `URL.createObjectURL` / `Image` → SKIP (no blob URLs in reactjit)
  - DOM `div` / `span` → `Box` / `Text`
  - Tailwind `className` → inline `style` objects
- Keep EVERY hook from the original that isn't server-specific:
  - `useLocalDispatchState` — keep it
  - `useThreadPlanCatalog` — keep it (adapt to local store)
  - Optimistic messages — keep it
  - Plan sidebar state — keep it
  - Checkpoint reversion — keep it
  - Image expansion state — keep it
  - Pull request dialog state — keep it
  - Terminal launch context — keep it
  - Attachment preview handoff — SKIP (no blob URLs)
- Remove server-specific code:
  - `useStore` from zustand → use `useT3Store` from `../store.ts`
  - `useQuery` / React Query → skip or use local state
  - `useNavigate` from TanStack Router → skip or use local state
  - `readEnvironmentApi` → skip (no server RPC)
  - `retainThreadDetailSubscription` → skip
  - WebSocket / RPC calls → skip
  - `window.desktopBridge` → skip
- Export `ChatViewProps` and `default function ChatView`.
- The component should receive props from the parent shell (see `cart/t3code/index.tsx` for what it passes).
- Dark theme, monospace fonts throughout.

## Checklist before finishing
- [ ] Header with thread title, project badge, terminal toggle button
- [ ] Provider status banner
- [ ] Thread error banner  
- [ ] Composer banner stack (version mismatch, environment unavailable)
- [ ] MessagesTimeline integration
- [ ] Scroll-to-bottom button
- [ ] Working timer
- [ ] No active thread state
- [ ] Plan sidebar integration (state + toggle)
- [ ] All hooks from original adapted, not removed
