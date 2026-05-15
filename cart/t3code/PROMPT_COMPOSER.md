# Worker: Composer

Read `/tmp/t3code/apps/web/src/components/chat/ChatComposer.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerPrimaryActions.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerBannerStack.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`, `/tmp/t3code/apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx`, `/tmp/t3code/apps/web/src/components/chat/ContextWindowMeter.tsx`, `/tmp/t3code/apps/web/src/components/chat/ModelPickerSidebar.tsx`, `/tmp/t3code/apps/web/src/components/chat/ProviderModelPicker.tsx`, `/tmp/t3code/apps/web/src/components/chat/CompactComposerControlsMenu.tsx`, `/tmp/t3code/apps/web/src/components/chat/TraitsPicker.tsx`, `/tmp/t3code/apps/web/src/components/chat/ProposedPlanCard.tsx`, `/tmp/t3code/apps/web/src/components/ComposerPromptEditor.tsx`, and `/tmp/t3code/apps/web/src/composer-logic.ts`.

Write `cart/t3code/components/Composer.tsx`.

Use primitives from `@reactjit/runtime/primitives` (`Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `TextInput`, `TextArea`). Import types from `../types.ts`.

Props:
```ts
interface ComposerProps {
  thread: Thread | null; phase: SessionPhase; ready: boolean;
  providers: ProviderInstance[]; onSend: (text: string) => void;
  onApprove: (requestId: string, decision: 'accept' | 'reject') => void;
  onRespondUserInput: (requestId: string, answers: Record<string, string>) => void;
  onModelChange: (selection: ModelSelection) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onInteractionModeChange: (mode: InteractionMode) => void;
  onTogglePlanSidebar: () => void; planSidebarOpen: boolean;
  pendingApprovals: PendingApproval[]; pendingUserInputs: PendingUserInput[];
  terminalContexts: TerminalContextSelection[]; onAddTerminalContext: (ctx: TerminalContextSelection) => void;
  contextWindow?: { used: number; limit: number };
  hasActionableProposedPlan: boolean; proposedPlan: ProposedPlan | null;
  onAcceptPlan: () => void; onRejectPlan: () => void;
}
```

Include inline types for `PendingApproval` and `PendingUserInput` if not in `../types.ts`.

Port 1:1: model picker dropdown, runtime mode toggle (supervised/auto-accept/full), plan mode toggle, send button, pending approval buttons, user input panel, terminal context chips, proposed plan card, context window meter.
