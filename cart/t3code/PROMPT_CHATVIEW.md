# Worker: ChatView + MessagesTimeline

Read `/tmp/t3code/apps/web/src/components/ChatView.tsx`, `/tmp/t3code/apps/web/src/components/ChatView.logic.ts`, `/tmp/t3code/apps/web/src/components/chat/MessagesTimeline.tsx`, `/tmp/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts`, `/tmp/t3code/apps/web/src/components/ChatMarkdown.tsx`, `/tmp/t3code/apps/web/src/components/chat/ChatHeader.tsx`, `/tmp/t3code/apps/web/src/components/chat/ThreadErrorBanner.tsx`, `/tmp/t3code/apps/web/src/components/NoActiveThreadState.tsx`, and `/tmp/t3code/apps/web/src/session-logic.ts`.

Write these files:
- `cart/t3code/components/ChatView.tsx`
- `cart/t3code/components/MessagesTimeline.tsx`

Use primitives from `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`). Import types from `../types.ts`.

ChatView props:
```ts
interface ChatViewProps {
  thread: Thread | null; isWorking: boolean; phase: SessionPhase;
  error: string | null; onSend: (text: string) => void;
  onRevertTurn: (turnId: TurnId) => void; onOpenDiff: (turnId: TurnId, filePath?: string) => void;
  showTerminal: boolean; onToggleTerminal: () => void;
  turnDiffSummaries: TurnDiffSummary[]; terminalShortcutLabel?: string;
}
```

MessagesTimeline props:
```ts
interface MessagesTimelineProps {
  messages: ChatMessage[]; isWorking: boolean; activeTurnId: TurnId | null;
  onRevertUserMessage: (messageId: MessageId) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  turnDiffSummaries: TurnDiffSummary[];
}
```

Port all behavior 1:1 including: working timer, completion summaries, diff stat labels, turn dividers, scroll-to-bottom, empty state.
