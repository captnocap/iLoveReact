# Agent Assignment: Chat Sub-Components

## Task
Read the source files below and write FOUR files. Do NOT simplify. Port every sub-component fully.

## Source files to read (in /tmp/t3code/apps/web/src/)
1. `components/chat/MessagesTimeline.tsx` + `components/chat/MessagesTimeline.logic.ts`
2. `components/chat/ChatHeader.tsx`
3. `components/PlanSidebar.tsx`
4. `components/DiffPanel.tsx` + `components/DiffPanelShell.tsx`
5. `components/BranchToolbar.tsx` + `components/BranchToolbar.logic.ts`

## What to write
1. `cart/t3code/components/MessagesTimeline.tsx` — expand the existing file (currently 313 lines, target 1000+)
2. `cart/t3code/components/ChatHeader.tsx` — NEW file (target 300+ lines)
3. `cart/t3code/components/PlanSidebar.tsx` — NEW file (target 400+ lines)
4. `cart/t3code/components/DiffPanel.tsx` — NEW file (target 300+ lines)

## Rules
- Use `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`).
- Import types from `../types.ts`.
- The host already has `useT3Store` in `../store.ts`.
- Replace DOM → primitives, Tailwind → inline styles.
- Keep ALL features from original:

### MessagesTimeline
- User message row with revert button, timestamp, bubble styling
- Assistant message row with completion divider, diff stats, "View diff" button
- Working row with animated dots and live timer
- Tool call rows
- Reasoning rows (collapsible)
- Scroll-to-bottom behavior
- Empty state

### ChatHeader
- Thread title
- Model badge (instance + model name)
- Phase/status badge (idle/streaming/failed)
- Terminal toggle button
- Branch toolbar (branch name, environment picker if multiple)
- Git status indicator

### PlanSidebar
- Plan title + description
- Step list with checkboxes
- Step status (pending/done/skipped)
- Accept/Reject plan buttons
- Scrollable plan content

### DiffPanel
- File list with change stats
- Diff stat labels (+added, -removed, ~modified)
- File path display
- "View diff" affordance per file
- Scrollable file list

## Checklist before finishing
- [ ] MessagesTimeline: all row types rendered correctly
- [ ] ChatHeader: all badges and toolbars present
- [ ] PlanSidebar: full plan display with step list
- [ ] DiffPanel: file list with diff stats
