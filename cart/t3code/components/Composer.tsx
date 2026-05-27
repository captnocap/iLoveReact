import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Box, Col, Row, Text, Pressable, ScrollView, TextArea,
} from '@reactjit/runtime/primitives';
import type {
  Thread,
  SessionPhase,
  ProviderInstance,
  ModelSelection,
  RuntimeMode,
  InteractionMode,
  TerminalContextSelection,
  TerminalContextDraft,
  ProposedPlan,
  PendingApproval,
  PendingUserInput,
  PendingUserInputDraftAnswer,
  ComposerImageAttachment,
  ComposerCommandItem,
  ProviderSkill,
  ContextWindowSnapshot,
} from '../types';

// ── constants ────────────────────────────────────────────────────────────────

const RUNTIME_MODE_LABELS: Record<RuntimeMode, { label: string; description: string }> = {
  'approval-required': { label: 'Supervised', description: 'Ask before commands and file changes.' },
  'auto-accept-edits': { label: 'Auto-accept edits', description: 'Auto-approve edits, ask before other actions.' },
  'full-access': { label: 'Full access', description: 'Allow commands and edits without prompts.' },
};

const RUNTIME_MODE_OPTIONS: RuntimeMode[] = ['approval-required', 'auto-accept-edits', 'full-access'];

const MAX_IMAGE_ATTACHMENTS = 8;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const IMAGE_SIZE_LIMIT_LABEL = '20MB';

const C = {
  primary: '#3b82f6',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#f59e0b',
  muted: '#6b7280',
  bgMuted: '#1a1a1f',
  bgSurface: '#141418',
  border: '#27272e',
  text: '#e8e8e8',
  textMuted: '#8a8a95',
  white: '#ffffff',
  blueGlow: 'rgba(59,130,246,0.12)',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function basenameOfPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function randomUUID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectComposerTrigger(text: string, cursor: number): { kind: 'path' | 'slash-command' | 'skill'; query: string; rangeStart: number; rangeEnd: number } | null {
  const before = text.slice(0, cursor);
  // Path trigger: @word
  const pathMatch = before.match(/@([^\s@]*)$/);
  if (pathMatch) {
    return { kind: 'path', query: pathMatch[1] ?? '', rangeStart: cursor - pathMatch[0].length, rangeEnd: cursor };
  }
  // Slash trigger: /word
  const slashMatch = before.match(/\/([^\s/]*)$/);
  if (slashMatch && (slashMatch.index === 0 || before[slashMatch.index! - 1] === ' ' || before[slashMatch.index! - 1] === '\n')) {
    return { kind: 'slash-command', query: slashMatch[1] ?? '', rangeStart: cursor - slashMatch[0].length, rangeEnd: cursor };
  }
  // Skill trigger: $word
  const skillMatch = before.match(/\$([^\s$]*)$/);
  if (skillMatch) {
    return { kind: 'skill', query: skillMatch[1] ?? '', rangeStart: cursor - skillMatch[0].length, rangeEnd: cursor };
  }
  return null;
}

function replaceTextRange(text: string, start: number, end: number, replacement: string): { text: string; cursor: number } {
  const safeStart = clamp(start, 0, text.length);
  const safeEnd = clamp(end, safeStart, text.length);
  const next = text.slice(0, safeStart) + replacement + text.slice(safeEnd);
  return { text: next, cursor: safeStart + replacement.length };
}

function extendReplacementRangeForTrailingSpace(text: string, rangeEnd: number, replacement: string): number {
  if (!replacement.endsWith(' ')) return rangeEnd;
  return text[rangeEnd] === ' ' ? rangeEnd + 1 : rangeEnd;
}

function searchSlashCommandItems(items: Extract<ComposerCommandItem, { type: 'slash-command' | 'provider-slash-command' }>[], query: string): typeof items {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
}

function searchProviderSkills(skills: ProviderSkill[], query: string): ProviderSkill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q));
}

function formatProviderSkillDisplayName(skill: ProviderSkill): string {
  return skill.name;
}

function derivePendingUserInputProgress(
  questions: PendingUserInputQuestion[],
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
) {
  const normalizedIndex = questions.length === 0 ? 0 : clamp(questionIndex, 0, questions.length - 1);
  const activeQuestion = questions[normalizedIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const selectedOptionLabels = Array.from(new Set((activeDraft?.selectedOptionLabels ?? []).filter((l): l is string => typeof l === 'string')));
  const customAnswer = activeDraft?.customAnswer ?? '';
  const resolvedAnswer = customAnswer.trim() || selectedOptionLabels[0] || null;
  const answeredCount = questions.reduce((count, q) => {
    const d = draftAnswers[q.id];
    const hasAnswer = (d?.customAnswer?.trim().length ?? 0) > 0 || (d?.selectedOptionLabels?.length ?? 0) > 0;
    return hasAnswer ? count + 1 : count;
  }, 0);
  return {
    questionIndex: normalizedIndex,
    activeQuestion,
    selectedOptionLabels,
    customAnswer,
    resolvedAnswer,
    isLastQuestion: questions.length === 0 ? true : normalizedIndex >= questions.length - 1,
    isComplete: answeredCount >= questions.length,
    canAdvance: Boolean(resolvedAnswer),
    answeredCount,
  };
}

// ── sub-components ───────────────────────────────────────────────────────────

function ContextWindowMeter({ usage }: { usage: ContextWindowSnapshot }) {
  const pct = clamp((usage.used / usage.limit) * 100, 0, 100);
  return (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <Box
        style={{
          width: 48,
          height: 6,
          borderRadius: 3,
          backgroundColor: C.border,
          overflow: 'hidden',
        }}
      >
        <Box
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: pct > 90 ? C.danger : pct > 70 ? C.warning : C.success,
          }}
        />
      </Box>
      <Text style={{ fontSize: 10, color: C.textMuted }}>
        {usage.used}/{usage.limit}
      </Text>
    </Row>
  );
}

function ModelPicker({
  providers,
  selection,
  onChange,
}: {
  providers: ProviderInstance[];
  selection: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = useMemo(() => {
    return providers.find((p) => p.id === selection?.instanceId) ?? providers[0] ?? null;
  }, [providers, selection]);

  return (
    <Box>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Row
          style={{
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: C.bgMuted,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.text }}>
            {active ? `${active.label} · ${active.model}` : 'Select model'}
          </Text>
          <Text style={{ fontSize: 10, color: C.textMuted }}>▼</Text>
        </Row>
      </Pressable>

      {open && (
        <Box
          style={{
            position: 'absolute',
            bottom: 28,
            left: 0,
            minWidth: 220,
            maxHeight: 260,
            backgroundColor: C.bgSurface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            zIndex: 50,
          }}
        >
          <ScrollView>
            <Col style={{ paddingVertical: 4 }}>
              {providers.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    onChange({ instanceId: p.id, model: p.model });
                    setOpen(false);
                  }}
                >
                  <Row
                    style={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      gap: 8,
                      backgroundColor:
                        active?.id === p.id ? C.blueGlow : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: C.text }}>{p.label}</Text>
                    <Text style={{ fontSize: 11, color: C.textMuted }}>{p.model}</Text>
                  </Row>
                </Pressable>
              ))}
            </Col>
          </ScrollView>
        </Box>
      )}
    </Box>
  );
}

function RuntimeModePicker({
  mode,
  onChange,
}: {
  mode: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const config = RUNTIME_MODE_LABELS[mode];
  return (
    <Box>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Row
          style={{
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: C.bgMuted,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 12, color: C.textMuted }}>{config.label}</Text>
          <Text style={{ fontSize: 10, color: C.textMuted }}>▼</Text>
        </Row>
      </Pressable>

      {open && (
        <Box
          style={{
            position: 'absolute',
            bottom: 28,
            left: 0,
            minWidth: 200,
            backgroundColor: C.bgSurface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            zIndex: 50,
          }}
        >
          <Col style={{ paddingVertical: 4 }}>
            {RUNTIME_MODE_OPTIONS.map((m) => {
              const opt = RUNTIME_MODE_LABELS[m];
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                >
                  <Row
                    style={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      backgroundColor: mode === m ? C.blueGlow : 'transparent',
                    }}
                  >
                    <Col style={{ gap: 2 }}>
                      <Text style={{ fontSize: 12, color: C.text }}>{opt.label}</Text>
                      <Text style={{ fontSize: 11, color: C.textMuted }}>{opt.description}</Text>
                    </Col>
                    {mode === m && <Text style={{ fontSize: 12, color: C.primary }}>✓</Text>}
                  </Row>
                </Pressable>
              );
            })}
          </Col>
        </Box>
      )}
    </Box>
  );
}

function InteractionModeButton({
  mode,
  onToggle,
}: {
  mode: InteractionMode;
  onToggle: () => void;
}) {
  return (
    <Pressable onPress={onToggle}>
      <Box
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          backgroundColor: C.bgMuted,
          borderRadius: 6,
        }}
      >
        <Text style={{ fontSize: 12, color: C.textMuted }}>
          {mode === 'plan' ? 'Plan' : 'Build'}
        </Text>
      </Box>
    </Pressable>
  );
}

function PlanSidebarButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable onPress={onToggle}>
      <Box
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          backgroundColor: open ? C.blueGlow : C.bgMuted,
          borderRadius: 6,
        }}
      >
        <Text style={{ fontSize: 12, color: open ? C.primary : C.textMuted }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function TraitPicker({
  provider,
  onPromptChange,
}: {
  provider: string;
  onPromptChange: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const traits = useMemo(() => {
    if (provider === 'claude_code') {
      return [
        { label: 'Concise', prompt: 'Be concise. ' },
        { label: 'Thorough', prompt: 'Be thorough and explain your reasoning. ' },
        { label: 'Fix only', prompt: 'Only fix the specific issue mentioned. ' },
      ];
    }
    return [
      { label: 'Concise', prompt: 'Be concise. ' },
      { label: 'Verbose', prompt: 'Be verbose and detailed. ' },
    ];
  }, [provider]);

  return (
    <Box>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Row
          style={{
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: C.bgMuted,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 12, color: C.textMuted }}>Traits</Text>
          <Text style={{ fontSize: 10, color: C.textMuted }}>▼</Text>
        </Row>
      </Pressable>
      {open && (
        <Box
          style={{
            position: 'absolute',
            bottom: 28,
            left: 0,
            minWidth: 160,
            backgroundColor: C.bgSurface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            zIndex: 50,
          }}
        >
          <Col style={{ paddingVertical: 4 }}>
            {traits.map((t) => (
              <Pressable
                key={t.label}
                onPress={() => {
                  onPromptChange(t.prompt);
                  setOpen(false);
                }}
              >
                <Row
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ fontSize: 12, color: C.text }}>{t.label}</Text>
                </Row>
              </Pressable>
            ))}
          </Col>
        </Box>
      )}
    </Box>
  );
}

function CompactControlsMenu({
  activePlan,
  interactionMode,
  planSidebarLabel,
  planSidebarOpen,
  runtimeMode,
  showInteractionModeToggle,
  onToggleInteractionMode,
  onTogglePlanSidebar,
  onRuntimeModeChange,
}: {
  activePlan: boolean;
  interactionMode: InteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Box
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            backgroundColor: C.bgMuted,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 12, color: C.textMuted }}>⋯</Text>
        </Box>
      </Pressable>
      {open && (
        <Box
          style={{
            position: 'absolute',
            bottom: 28,
            left: 0,
            minWidth: 200,
            backgroundColor: C.bgSurface,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            zIndex: 50,
          }}
        >
          <Col style={{ paddingVertical: 4 }}>
            {showInteractionModeToggle && (
              <>
                <Text style={{ fontSize: 11, color: C.textMuted, paddingHorizontal: 10, paddingVertical: 4 }}>
                  Mode
                </Text>
                <Pressable onPress={() => { onToggleInteractionMode(); setOpen(false); }}>
                  <Row style={{ paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: C.text }}>Chat</Text>
                    {interactionMode === 'build' && <Text style={{ fontSize: 12, color: C.primary }}>✓</Text>}
                  </Row>
                </Pressable>
                <Pressable onPress={() => { onToggleInteractionMode(); setOpen(false); }}>
                  <Row style={{ paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: C.text }}>Plan</Text>
                    {interactionMode === 'plan' && <Text style={{ fontSize: 12, color: C.primary }}>✓</Text>}
                  </Row>
                </Pressable>
              </>
            )}
            <Text style={{ fontSize: 11, color: C.textMuted, paddingHorizontal: 10, paddingVertical: 4 }}>
              Access
            </Text>
            {RUNTIME_MODE_OPTIONS.map((m) => (
              <Pressable key={m} onPress={() => { onRuntimeModeChange(m); setOpen(false); }}>
                <Row style={{ paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: C.text }}>{RUNTIME_MODE_LABELS[m].label}</Text>
                  {runtimeMode === m && <Text style={{ fontSize: 12, color: C.primary }}>✓</Text>}
                </Row>
              </Pressable>
            ))}
            {activePlan && (
              <Pressable onPress={() => { onTogglePlanSidebar(); setOpen(false); }}>
                <Row style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                  <Text style={{ fontSize: 12, color: C.text }}>
                    {planSidebarOpen ? `Hide ${planSidebarLabel.toLowerCase()} sidebar` : `Show ${planSidebarLabel.toLowerCase()} sidebar`}
                  </Text>
                </Row>
              </Pressable>
            )}
          </Col>
        </Box>
      )}
    </Box>
  );
}

// ── pending approval ─────────────────────────────────────────────────────────

function PendingApprovalPanel({
  approval,
  pendingCount,
}: {
  approval: PendingApproval;
  pendingCount: number;
}) {
  const summary =
    approval.requestKind === 'command'
      ? 'Command approval requested'
      : approval.requestKind === 'file-read'
      ? 'File-read approval requested'
      : 'File-change approval requested';

  return (
    <Row
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 1.5,
          color: C.warning,
        }}
      >
        PENDING APPROVAL
      </Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: C.text }}>{summary}</Text>
      {pendingCount > 1 && (
        <Text style={{ fontSize: 11, color: C.textMuted }}>1/{pendingCount}</Text>
      )}
      {approval.detail && (
        <Text style={{ fontSize: 12, color: C.textMuted, width: '100%' }}>{approval.detail}</Text>
      )}
    </Row>
  );
}

function PendingApprovalActions({
  requestId,
  onRespond,
}: {
  requestId: string;
  onRespond: (requestId: string, decision: 'accept' | 'reject') => void;
}) {
  return (
    <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
      <Pressable onPress={() => onRespond(requestId, 'reject')}>
        <Box
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: C.bgSurface,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.text }}>Reject</Text>
        </Box>
      </Pressable>
      <Pressable onPress={() => onRespond(requestId, 'accept')}>
        <Box
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: C.primary,
            borderRadius: 6,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.white }}>Accept</Text>
        </Box>
      </Pressable>
    </Row>
  );
}

// ── pending user input ───────────────────────────────────────────────────────

function PendingUserInputPanel({
  pendingUserInputs,
  draftAnswers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onPreviousQuestion,
  isResponding,
}: {
  pendingUserInputs: PendingUserInput[];
  draftAnswers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onPreviousQuestion: () => void;
  isResponding: boolean;
}) {
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <PendingUserInputCard
      prompt={activePrompt}
      isResponding={isResponding}
      draftAnswers={draftAnswers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onPreviousQuestion={onPreviousQuestion}
    />
  );
}

function PendingUserInputCard({
  prompt,
  isResponding,
  draftAnswers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onPreviousQuestion,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  draftAnswers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
  onPreviousQuestion: () => void;
}) {
  const progress = useMemo(
    () => derivePendingUserInputProgress(prompt.questions, draftAnswers, questionIndex),
    [prompt.questions, draftAnswers, questionIndex],
  );
  const activeQuestion = progress.activeQuestion;
  if (!activeQuestion) return null;

  return (
    <Col style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        {prompt.questions.length > 1 && (
          <Box
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              backgroundColor: C.bgMuted,
              borderRadius: 4,
            }}
          >
            <Text style={{ fontSize: 10, color: C.textMuted }}>
              {progress.questionIndex + 1}/{prompt.questions.length}
            </Text>
          </Box>
        )}
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: C.textMuted }}>
          {activeQuestion.header}
        </Text>
      </Row>
      <Text style={{ fontSize: 13, color: C.text }}>{activeQuestion.question}</Text>
      {activeQuestion.multiSelect && (
        <Text style={{ fontSize: 11, color: C.textMuted }}>Select one or more options.</Text>
      )}
      <Col style={{ gap: 4 }}>
        {activeQuestion.options.map((option, index) => {
          const isSelected = progress.selectedOptionLabels.includes(option.label);
          return (
            <Pressable
              key={`${activeQuestion.id}:${option.label}`}
              onPress={() => {
                if (isResponding) return;
                onToggleOption(activeQuestion.id, option.label);
                if (!activeQuestion.multiSelect) {
                  setTimeout(() => onAdvance(), 200);
                }
              }}
            >
              <Row
                style={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: isSelected ? C.primary : C.border,
                  backgroundColor: isSelected ? C.blueGlow : C.bgSurface,
                  opacity: isResponding ? 0.5 : 1,
                }}
              >
                <Row style={{ alignItems: 'center', gap: 8 }}>
                  {index < 9 && (
                    <Box
                      style={{
                        width: 18,
                        height: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 4,
                        backgroundColor: isSelected ? 'rgba(59,130,246,0.2)' : C.bgMuted,
                      }}
                    >
                      <Text style={{ fontSize: 10, color: isSelected ? C.primary : C.textMuted }}>
                        {index + 1}
                      </Text>
                    </Box>
                  )}
                  <Text style={{ fontSize: 13, color: C.text }}>{option.label}</Text>
                  {option.description && option.description !== option.label && (
                    <Text style={{ fontSize: 11, color: C.textMuted }}>{option.description}</Text>
                  )}
                </Row>
                {isSelected && <Text style={{ fontSize: 12, color: C.primary }}>✓</Text>}
              </Row>
            </Pressable>
          );
        })}
      </Col>
      <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
        {progress.questionIndex > 0 && (
          <Pressable onPress={onPreviousQuestion}>
            <Box
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                backgroundColor: C.bgSurface,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 12, color: C.text }}>Previous</Text>
            </Box>
          </Pressable>
        )}
        <Pressable
          onPress={onAdvance}
          disabled={
            isResponding ||
            (progress.isLastQuestion ? !progress.isComplete : !progress.canAdvance)
          }
        >
          <Box
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              backgroundColor:
                isResponding || (progress.isLastQuestion ? !progress.isComplete : !progress.canAdvance)
                  ? C.bgMuted
                  : C.primary,
              borderRadius: 20,
              opacity:
                isResponding || (progress.isLastQuestion ? !progress.isComplete : !progress.canAdvance)
                  ? 0.5
                  : 1,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.white }}>
              {isResponding
                ? 'Submitting...'
                : progress.isLastQuestion
                ? progress.questionIndex > 0
                  ? 'Submit answers'
                  : 'Submit answer'
                : 'Next'}
            </Text>
          </Box>
        </Pressable>
      </Row>
    </Col>
  );
}

// ── plan follow-up banner ────────────────────────────────────────────────────

function PlanFollowUpBanner({ planTitle }: { planTitle: string | null }) {
  return (
    <Row style={{ paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: C.primary }}>
        PLAN READY
      </Text>
      <Text style={{ fontSize: 13, color: C.text }}>
        {planTitle ?? 'A plan has been proposed for this thread.'}
      </Text>
    </Row>
  );
}

// ── composer command menu ────────────────────────────────────────────────────

function ComposerCommandMenu({
  items,
  activeItemId,
  onHighlightedItemChange,
  onSelect,
  isLoading,
  emptyStateText,
}: {
  items: ComposerCommandItem[];
  activeItemId: string | null;
  onHighlightedItemChange: (id: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
  isLoading: boolean;
  emptyStateText: string;
}) {
  if (items.length === 0 && !isLoading) {
    return (
      <Box
        style={{
          padding: 12,
          backgroundColor: C.bgSurface,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={{ fontSize: 12, color: C.textMuted }}>{emptyStateText}</Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        maxHeight: 240,
        backgroundColor: C.bgSurface,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      <ScrollView>
        <Col style={{ paddingVertical: 4 }}>
          {isLoading && (
            <Row style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, color: C.textMuted }}>Loading…</Text>
            </Row>
          )}
          {items.map((item) => {
            const isActive = item.id === activeItemId;
            return (
              <Pressable
                key={item.id}
                onPress={() => onSelect(item)}
                onHoverEnter={() => onHighlightedItemChange(item.id)}
              >
                <Row
                  style={{
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    backgroundColor: isActive ? C.blueGlow : 'transparent',
                  }}
                >
                  <Col style={{ gap: 2 }}>
                    <Text style={{ fontSize: 13, color: C.text }}>{item.label}</Text>
                    <Text style={{ fontSize: 11, color: C.textMuted }}>{item.description}</Text>
                  </Col>
                  {isActive && <Text style={{ fontSize: 12, color: C.primary }}>↵</Text>}
                </Row>
              </Pressable>
            );
          })}
        </Col>
      </ScrollView>
    </Box>
  );
}

// ── image attachments ────────────────────────────────────────────────────────

function ImageAttachmentGrid({
  images,
  onRemove,
  onExpand,
}: {
  images: ComposerImageAttachment[];
  onRemove: (id: string) => void;
  onExpand?: (id: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <Row style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      {images.map((image) => (
        <Box
          key={image.id}
          style={{
            width: 64,
            height: 64,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.bgSurface,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {image.dataUrl ? (
            <Pressable onPress={() => onExpand?.(image.id)}>
              <Box
                style={{
                  width: 64,
                  height: 64,
                  backgroundImage: image.dataUrl,
                  backgroundSize: 'cover',
                }}
              />
            </Pressable>
          ) : (
            <Box
              style={{
                width: 64,
                height: 64,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
              }}
            >
              <Text style={{ fontSize: 10, color: C.textMuted, textAlign: 'center' }}>
                {image.name}
              </Text>
            </Box>
          )}
          <Pressable onPress={() => onRemove(image.id)}>
            <Box
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 18,
                height: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.6)',
                borderRadius: 4,
              }}
            >
              <Text style={{ fontSize: 10, color: C.white }}>✕</Text>
            </Box>
          </Pressable>
        </Box>
      ))}
    </Row>
  );
}

// ── terminal context chips ───────────────────────────────────────────────────

function TerminalContextChips({
  contexts,
  onRemove,
}: {
  contexts: TerminalContextDraft[];
  onRemove?: (id: string) => void;
}) {
  if (contexts.length === 0) return null;
  return (
    <Row style={{ flexWrap: 'wrap', gap: 6 }}>
      {contexts.map((ctx) => (
        <Pressable key={ctx.id} onPress={() => onRemove?.(ctx.id)}>
          <Row
            style={{
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: C.bgMuted,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Text style={{ fontSize: 11, color: C.textMuted }}>
              {ctx.terminalLabel} [{ctx.lineStart}:{ctx.lineEnd}]
            </Text>
            {onRemove && (
              <Text style={{ fontSize: 10, color: C.textMuted }}>✕</Text>
            )}
          </Row>
        </Pressable>
      ))}
    </Row>
  );
}

// ── primary actions (send / stop / implement / refine / next / prev) ─────────

function ComposerPrimaryActions({
  pendingAction,
  isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: {
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}) {
  if (pendingAction) {
    return (
      <Row style={{ alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {pendingAction.questionIndex > 0 && (
          <Pressable onPress={onPreviousPendingQuestion}>
            <Box
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: C.bgSurface,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ fontSize: 12, color: C.text }}>Previous</Text>
            </Box>
          </Pressable>
        )}
        <Pressable
          onPress={() => {}}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          <Box
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              backgroundColor:
                isEnvironmentUnavailable ||
                pendingAction.isResponding ||
                (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
                  ? C.bgMuted
                  : C.primary,
              borderRadius: 20,
              opacity:
                isEnvironmentUnavailable ||
                pendingAction.isResponding ||
                (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
                  ? 0.5
                  : 1,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.white }}>
              {pendingAction.isResponding
                ? 'Submitting...'
                : pendingAction.isLastQuestion
                ? pendingAction.questionIndex > 0
                  ? 'Submit answers'
                  : 'Submit answer'
                : 'Next'}
            </Text>
          </Box>
        </Pressable>
      </Row>
    );
  }

  if (isRunning) {
    return (
      <Pressable onPress={onInterrupt}>
        <Box
          style={{
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            backgroundColor: C.danger,
          }}
        >
          <Box style={{ width: 10, height: 10, backgroundColor: C.white, borderRadius: 2 }} />
        </Box>
      </Pressable>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Pressable disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}>
          <Box
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              backgroundColor: C.primary,
              borderRadius: 20,
              opacity: isSendBusy || isConnecting || isEnvironmentUnavailable ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.white }}>
              {isConnecting || isSendBusy ? 'Sending…' : 'Refine'}
            </Text>
          </Box>
        </Pressable>
      );
    }
    return (
      <Row style={{ alignItems: 'center', gap: 0 }}>
        <Pressable disabled={isSendBusy || isConnecting || isEnvironmentUnavailable}>
          <Box
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              backgroundColor: C.primary,
              borderTopLeftRadius: 20,
              borderBottomLeftRadius: 20,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              opacity: isSendBusy || isConnecting || isEnvironmentUnavailable ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.white }}>
              {isConnecting || isSendBusy ? 'Sending…' : 'Implement'}
            </Text>
          </Box>
        </Pressable>
        <Pressable onPress={onImplementPlanInNewThread}>
          <Box
            style={{
              paddingHorizontal: 8,
              paddingVertical: 6,
              backgroundColor: C.primary,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              borderTopRightRadius: 20,
              borderBottomRightRadius: 20,
              borderLeftWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              opacity: isSendBusy || isConnecting || isEnvironmentUnavailable ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 10, color: C.white }}>▼</Text>
          </Box>
        </Pressable>
      </Row>
    );
  }

  return (
    <Pressable
      disabled={isSendBusy || isConnecting || isEnvironmentUnavailable || !hasSendableContent}
    >
      <Box
        style={{
          width: 32,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          backgroundColor: C.primary,
          opacity: isSendBusy || isConnecting || isEnvironmentUnavailable || !hasSendableContent ? 0.3 : 1,
        }}
      >
        {isConnecting || isSendBusy ? (
          <Text style={{ fontSize: 12, color: C.white }}>⟳</Text>
        ) : isPreparingWorktree ? (
          <Text style={{ fontSize: 10, color: C.white }}>…</Text>
        ) : (
          <Text style={{ fontSize: 14, color: C.white }}>↑</Text>
        )}
      </Box>
    </Pressable>
  );
}

// ── props ────────────────────────────────────────────────────────────────────

export interface ComposerProps {
  thread: Thread | null;
  phase: SessionPhase;
  ready: boolean;
  providers: ProviderInstance[];
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onApprove: (requestId: string, decision: 'accept' | 'reject') => void;
  onRespondUserInput: (requestId: string, answers: Record<string, string | string[]>) => void;
  onModelChange: (selection: ModelSelection) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onInteractionModeChange: (mode: InteractionMode) => void;
  onTogglePlanSidebar: () => void;
  planSidebarOpen: boolean;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: string[];
  terminalContexts: TerminalContextDraft[];
  onAddTerminalContext: (ctx: TerminalContextSelection) => void;
  onRemoveTerminalContext: (id: string) => void;
  contextWindow?: ContextWindowSnapshot;
  hasActionableProposedPlan: boolean;
  proposedPlan: ProposedPlan | null;
  onAcceptPlan: () => void;
  onRejectPlan: () => void;
  onImplementPlanInNewThread: () => void;
  environmentUnavailable?: EnvironmentUnavailableState | null;
  isPreparingWorktree?: boolean;
  isSendBusy?: boolean;
  isConnecting?: boolean;
  showPlanFollowUpPrompt?: boolean;
  activePlan?: { turnId?: string } | null;
  sidebarProposedPlan?: { turnId?: string } | null;
  planSidebarLabel?: string;
  skills?: ProviderSkill[];
  providerSlashCommands?: { name: string; description?: string }[];
}

// ── main component ───────────────────────────────────────────────────────────

export default function Composer(props: ComposerProps) {
  const {
    thread,
    phase,
    ready,
    providers,
    onSend,
    onInterrupt,
    onApprove,
    onRespondUserInput,
    onModelChange,
    onRuntimeModeChange,
    onInteractionModeChange,
    onTogglePlanSidebar,
    planSidebarOpen,
    pendingApprovals,
    pendingUserInputs,
    respondingRequestIds,
    terminalContexts,
    onRemoveTerminalContext,
    contextWindow,
    hasActionableProposedPlan,
    proposedPlan,
    onAcceptPlan,
    onRejectPlan,
    onImplementPlanInNewThread,
    environmentUnavailable,
    isPreparingWorktree,
    isSendBusy,
    isConnecting,
    showPlanFollowUpPrompt,
    activePlan,
    sidebarProposedPlan,
    planSidebarLabel = 'Tasks',
    skills = [],
    providerSlashCommands = [],
  } = props;

  const [prompt, setPrompt] = useState('');
  const [composerCursor, setComposerCursor] = useState(0);
  const [composerTrigger, setComposerTrigger] = useState<{
    kind: 'path' | 'slash-command' | 'skill';
    query: string;
    rangeStart: number;
    rangeEnd: number;
  } | null>(null);
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [images, setImages] = useState<ComposerImageAttachment[]>([]);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isFooterCompact, setIsFooterCompact] = useState(false);
  const textareaRef = useRef<{ focus: () => void } | null>(null);
  const composerFormRef = useRef<any>(null);
  const promptRef = useRef(prompt);

  // Sync prompt ref
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  // Composer menu items
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === 'path') {
      // In a full port this queries workspace entries via __fs_list_json.
      // We return a static set of common paths for now.
      const query = composerTrigger.query.toLowerCase();
      const commonPaths = [
        { path: 'package.json', kind: 'file' as const },
        { path: 'tsconfig.json', kind: 'file' as const },
        { path: 'src', kind: 'directory' as const },
        { path: 'README.md', kind: 'file' as const },
        { path: '.gitignore', kind: 'file' as const },
      ];
      return commonPaths
        .filter((entry) => entry.path.toLowerCase().includes(query))
        .map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: 'path' as const,
          path: entry.path,
          pathKind: entry.kind,
          label: basenameOfPath(entry.path),
          description: entry.kind === 'directory' ? 'Folder' : 'File',
        }));
    }
    if (composerTrigger.kind === 'slash-command') {
      const builtIn: Extract<ComposerCommandItem, { type: 'slash-command' }>[] = [
        { id: 'slash:model', type: 'slash-command', command: 'model', label: '/model', description: 'Switch response model for this thread' },
        { id: 'slash:plan', type: 'slash-command', command: 'plan', label: '/plan', description: 'Switch this thread into plan mode' },
        { id: 'slash:default', type: 'slash-command', command: 'default', label: '/default', description: 'Switch this thread back to normal build mode' },
      ];
      const providerItems: Extract<ComposerCommandItem, { type: 'provider-slash-command' }>[] = providerSlashCommands.map((cmd) => ({
        id: `provider-slash:${cmd.name}`,
        type: 'provider-slash-command',
        provider: thread?.modelSelection.instanceId ?? '',
        command: cmd,
        label: `/${cmd.name}`,
        description: cmd.description ?? 'Run provider command',
      }));
      return searchSlashCommandItems([...builtIn, ...providerItems], composerTrigger.query);
    }
    if (composerTrigger.kind === 'skill') {
      return searchProviderSkills(skills, composerTrigger.query).map((skill) => ({
        id: `skill:${skill.name}`,
        type: 'skill' as const,
        provider: thread?.modelSelection.instanceId ?? '',
        skill,
        label: formatProviderSkillDisplayName(skill),
        description: skill.shortDescription ?? skill.description ?? (skill.scope ? `${skill.scope} skill` : 'Run provider skill'),
      }));
    }
    return [];
  }, [composerTrigger, skills, providerSlashCommands, thread?.modelSelection.instanceId]);

  const composerMenuOpen = Boolean(composerTrigger);
  const activeComposerMenuItem = useMemo(() => {
    if (!composerHighlightedItemId) return composerMenuItems[0] ?? null;
    return composerMenuItems.find((item) => item.id === composerHighlightedItemId) ?? composerMenuItems[0] ?? null;
  }, [composerHighlightedItemId, composerMenuItems]);

  // Derived state
  const isRunning = phase === 'streaming';
  const activePendingApproval = pendingApprovals[0] ?? null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const hasComposerHeader =
    activePendingApproval !== null ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && proposedPlan !== null);

  const currentModelSelection = useMemo<ModelSelection>(() => {
    if (thread) return thread.modelSelection;
    const first = providers.find((p) => p.enabled);
    return first ? { instanceId: first.id, model: first.model } : { instanceId: '', model: '' };
  }, [thread, providers]);

  const currentRuntimeMode = thread?.runtimeMode ?? 'approval-required';
  const currentInteractionMode = thread?.interactionMode ?? 'build';

  const showPlanSidebarToggle = Boolean(activePlan || sidebarProposedPlan || planSidebarOpen);
  const showInteractionModeToggle = true;

  // Pending user input state
  const [pendingDraftAnswers, setPendingDraftAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [activePendingQuestionIndex, setActivePendingQuestionIndex] = useState(0);

  const pendingProgress = useMemo(() => {
    if (!activePendingUserInput) return null;
    return derivePendingUserInputProgress(
      activePendingUserInput.questions,
      pendingDraftAnswers,
      activePendingQuestionIndex,
    );
  }, [activePendingUserInput, pendingDraftAnswers, activePendingQuestionIndex]);

  const pendingPrimaryAction = useMemo(() => {
    if (!pendingProgress) return null;
    return {
      questionIndex: pendingProgress.questionIndex,
      isLastQuestion: pendingProgress.isLastQuestion,
      canAdvance: pendingProgress.canAdvance,
      isResponding: activePendingUserInput ? respondingRequestIds.includes(activePendingUserInput.requestId) : false,
      isComplete: pendingProgress.isComplete,
    };
  }, [pendingProgress, activePendingUserInput, respondingRequestIds]);

  // Send state
  const composerSendState = useMemo(() => {
    const hasText = prompt.trim().length > 0;
    const hasImages = images.length > 0;
    const hasTerminalContexts = terminalContexts.length > 0;
    return {
      hasSendableContent: hasText || hasImages || hasTerminalContexts,
      hasText,
      hasImages,
      hasTerminalContexts,
    };
  }, [prompt, images, terminalContexts]);

  const canSend = ready && !isRunning && composerSendState.hasSendableContent;

  // Prompt change handler
  const handlePromptChange = useCallback(
    (nextPrompt: string) => {
      setPrompt(nextPrompt);
      const trigger = detectComposerTrigger(nextPrompt, nextPrompt.length);
      setComposerTrigger(trigger);
      if (!trigger) {
        setComposerHighlightedItemId(null);
      }
    },
    [],
  );

  // Apply menu selection
  const applyMenuSelection = useCallback(
    (item: ComposerCommandItem) => {
      if (!composerTrigger) return;
      const replacement =
        item.type === 'path'
          ? `@${item.path} `
          : item.type === 'slash-command'
          ? ''
          : item.type === 'provider-slash-command'
          ? `/${item.command.name} `
          : item.type === 'skill'
          ? `$${item.skill.name} `
          : '';
      const rangeEnd = extendReplacementRangeForTrailingSpace(
        promptRef.current,
        composerTrigger.rangeEnd,
        replacement,
      );
      const result = replaceTextRange(promptRef.current, composerTrigger.rangeStart, rangeEnd, replacement);
      setPrompt(result.text);
      promptRef.current = result.text;
      setComposerCursor(result.cursor);
      setComposerTrigger(detectComposerTrigger(result.text, result.cursor));
      setComposerHighlightedItemId(null);

      if (item.type === 'slash-command' && item.command === 'model') {
        // In a full port this would open the model picker
      } else if (item.type === 'slash-command' && (item.command === 'plan' || item.command === 'default')) {
        onInteractionModeChange(item.command === 'plan' ? 'plan' : 'build');
      }
    },
    [composerTrigger, onInteractionModeChange],
  );

  // Keyboard handler for command menu
  const handleCommandKey = useCallback(
    (key: string, shift: boolean) => {
      if (key === 'Tab' && shift) {
        onInteractionModeChange(currentInteractionMode === 'build' ? 'plan' : 'build');
        return true;
      }
      if (composerMenuOpen) {
        if (key === 'ArrowDown') {
          const idx = composerMenuItems.findIndex((i) => i.id === composerHighlightedItemId);
          const next = composerMenuItems[(idx + 1) % composerMenuItems.length];
          if (next) setComposerHighlightedItemId(next.id);
          return true;
        }
        if (key === 'ArrowUp') {
          const idx = composerMenuItems.findIndex((i) => i.id === composerHighlightedItemId);
          const next = composerMenuItems[(idx - 1 + composerMenuItems.length) % composerMenuItems.length];
          if (next) setComposerHighlightedItemId(next.id);
          return true;
        }
        if ((key === 'Enter' || key === 'Tab') && activeComposerMenuItem) {
          applyMenuSelection(activeComposerMenuItem);
          return true;
        }
      }
      if (key === 'Enter' && !shift) {
        handleSubmit();
        return true;
      }
      return false;
    },
    [
      composerMenuOpen,
      composerMenuItems,
      composerHighlightedItemId,
      activeComposerMenuItem,
      applyMenuSelection,
      onInteractionModeChange,
      currentInteractionMode,
    ],
  );

  // Submit
  const handleSubmit = useCallback(() => {
    if (isRunning) {
      onInterrupt();
      return;
    }
    if (pendingPrimaryAction) {
      if (pendingPrimaryAction.isLastQuestion && pendingPrimaryAction.isComplete && activePendingUserInput) {
        const answers: Record<string, string | string[]> = {};
        for (const q of activePendingUserInput.questions) {
          const draft = pendingDraftAnswers[q.id];
          const custom = draft?.customAnswer?.trim();
          if (custom) {
            answers[q.id] = custom;
          } else if (draft?.selectedOptionLabels?.length) {
            answers[q.id] = q.multiSelect ? draft.selectedOptionLabels : draft.selectedOptionLabels[0];
          }
        }
        onRespondUserInput(activePendingUserInput.requestId, answers);
        setPendingDraftAnswers({});
        setActivePendingQuestionIndex(0);
      } else if (pendingPrimaryAction.canAdvance) {
        setActivePendingQuestionIndex((i) => i + 1);
      }
      return;
    }
    if (!canSend) return;
    onSend(prompt.trim());
    setPrompt('');
    setComposerTrigger(null);
    setComposerHighlightedItemId(null);
  }, [
    isRunning,
    pendingPrimaryAction,
    activePendingUserInput,
    pendingDraftAnswers,
    canSend,
    onSend,
    onInterrupt,
    onRespondUserInput,
    prompt,
  ]);

  // Handle pending user input option toggle
  const handleToggleOption = useCallback((questionId: string, optionLabel: string) => {
    setPendingDraftAnswers((prev) => {
      const draft = prev[questionId];
      const question = activePendingUserInput?.questions.find((q) => q.id === questionId);
      if (!question) return prev;
      if (question.multiSelect) {
        const labels = new Set(draft?.selectedOptionLabels ?? []);
        if (labels.has(optionLabel)) {
          labels.delete(optionLabel);
        } else {
          labels.add(optionLabel);
        }
        return {
          ...prev,
          [questionId]: { selectedOptionLabels: Array.from(labels), customAnswer: '' },
        };
      }
      return {
        ...prev,
        [questionId]: { selectedOptionLabels: [optionLabel], customAnswer: '' },
      };
    });
  }, [activePendingUserInput]);

  // Handle pending user input advance
  const handleAdvance = useCallback(() => {
    if (!pendingProgress) return;
    if (pendingProgress.isLastQuestion && pendingProgress.isComplete && activePendingUserInput) {
      const answers: Record<string, string | string[]> = {};
      for (const q of activePendingUserInput.questions) {
        const draft = pendingDraftAnswers[q.id];
        const custom = draft?.customAnswer?.trim();
        if (custom) {
          answers[q.id] = custom;
        } else if (draft?.selectedOptionLabels?.length) {
          answers[q.id] = q.multiSelect ? draft.selectedOptionLabels : draft.selectedOptionLabels[0];
        }
      }
      onRespondUserInput(activePendingUserInput.requestId, answers);
      setPendingDraftAnswers({});
      setActivePendingQuestionIndex(0);
    } else if (pendingProgress.canAdvance) {
      setActivePendingQuestionIndex((i) => i + 1);
    }
  }, [pendingProgress, activePendingUserInput, pendingDraftAnswers, onRespondUserInput]);

  // Handle previous question
  const handlePreviousQuestion = useCallback(() => {
    setActivePendingQuestionIndex((i) => Math.max(0, i - 1));
  }, []);

  // Image attachments
  const handleAddImages = useCallback((files: { name: string; type: string; size: number; dataUrl?: string }[]) => {
    const nextImages: ComposerImageAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        error = `Unsupported file type for '${file.name}'. Please attach image files only.`;
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        error = `'${file.name}' exceeds the ${IMAGE_SIZE_LIMIT_LABEL} attachment limit.`;
        continue;
      }
      if (images.length + nextImages.length >= MAX_IMAGE_ATTACHMENTS) {
        error = `You can attach up to ${MAX_IMAGE_ATTACHMENTS} images per message.`;
        break;
      }
      nextImages.push({
        id: randomUUID(),
        name: file.name || 'image',
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl: file.dataUrl,
      });
    }
    if (nextImages.length > 0) {
      setImages((prev) => [...prev, ...nextImages]);
    }
    if (error) {
      // In a full port this surfaces via thread error banner
      console.warn(error);
    }
  }, [images.length]);

  const handleRemoveImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  // Terminal context insertion
  const handleAddTerminalContext = useCallback((selection: TerminalContextSelection) => {
    const draft: TerminalContextDraft = {
      ...selection,
      id: randomUUID(),
    };
    // Insert placeholder text into prompt
    const placeholder = `[terminal:${draft.terminalLabel}]`;
    const result = replaceTextRange(promptRef.current, composerCursor, composerCursor, placeholder);
    setPrompt(result.text);
    promptRef.current = result.text;
    setComposerCursor(result.cursor);
    // Notify parent
    props.onAddTerminalContext?.(selection);
  }, [composerCursor, props]);

  // Footer compactness (simplified — no ResizeObserver)
  useEffect(() => {
    const checkCompact = () => {
      const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
      setIsFooterCompact(width < 640);
    };
    checkCompact();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkCompact);
      return () => window.removeEventListener('resize', checkCompact);
    }
  }, []);

  // Reset composer state on thread change
  useEffect(() => {
    setPrompt('');
    setComposerCursor(0);
    setComposerTrigger(null);
    setComposerHighlightedItemId(null);
    setImages([]);
    setPendingDraftAnswers({});
    setActivePendingQuestionIndex(0);
  }, [thread?.id]);

  // Placeholder text
  const placeholderText = useMemo(() => {
    if (activePendingApproval) {
      return activePendingApproval.detail ?? 'Resolve this approval request to continue';
    }
    if (pendingProgress) {
      return 'Type your own answer, or leave this blank to use the selected option';
    }
    if (showPlanFollowUpPrompt && proposedPlan) {
      return 'Add feedback to refine the plan, or leave this blank to implement it';
    }
    if (environmentUnavailable) {
      return `${environmentUnavailable.label} is ${environmentUnavailable.connectionState === 'connecting' ? 'connecting' : 'disconnected'}`;
    }
    if (phase === 'failed') {
      return 'Ask for follow-up changes or attach images';
    }
    return 'Ask anything, @tag files/folders, $use skills, or / for commands';
  }, [activePendingApproval, pendingProgress, showPlanFollowUpPrompt, proposedPlan, environmentUnavailable, phase]);

  const isComposerDisabled =
    isConnecting ||
    activePendingApproval !== null ||
    (environmentUnavailable !== null && pendingProgress === null);

  // Plan sidebar label
  const planLabel = planSidebarLabel;

  return (
    <Col
      style={{
        gap: 0,
        borderTopWidth: 1,
        borderColor: C.border,
        backgroundColor: C.bgSurface,
      }}
    >
      {/* Header panels */}
      {activePendingApproval && (
        <Box style={{ borderBottomWidth: 1, borderColor: C.border }}>
          <PendingApprovalPanel
            approval={activePendingApproval}
            pendingCount={pendingApprovals.length}
          />
          <Box style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <PendingApprovalActions
              requestId={activePendingApproval.requestId}
              onRespond={onApprove}
            />
          </Box>
        </Box>
      )}

      {pendingUserInputs.length > 0 && !activePendingApproval && (
        <Box style={{ borderBottomWidth: 1, borderColor: C.border }}>
          <PendingUserInputPanel
            pendingUserInputs={pendingUserInputs}
            draftAnswers={pendingDraftAnswers}
            questionIndex={activePendingQuestionIndex}
            onToggleOption={handleToggleOption}
            onAdvance={handleAdvance}
            onPreviousQuestion={handlePreviousQuestion}
            isResponding={activePendingUserInput ? respondingRequestIds.includes(activePendingUserInput.requestId) : false}
          />
        </Box>
      )}

      {showPlanFollowUpPrompt && proposedPlan && !activePendingApproval && pendingUserInputs.length === 0 && (
        <Box style={{ borderBottomWidth: 1, borderColor: C.border }}>
          <PlanFollowUpBanner planTitle={proposedPlan.title} />
        </Box>
      )}

      {/* Composer body */}
      <Col style={{ padding: 12, gap: 8 }}>
        {/* Command menu overlay */}
        {composerMenuOpen && !activePendingApproval && pendingUserInputs.length === 0 && (
          <Box style={{ marginBottom: 4 }}>
            <ComposerCommandMenu
              items={composerMenuItems}
              activeItemId={activeComposerMenuItem?.id ?? null}
              onHighlightedItemChange={setComposerHighlightedItemId}
              onSelect={applyMenuSelection}
              isLoading={false}
              emptyStateText={
                composerTrigger?.kind === 'skill'
                  ? 'No skills found. Try / to browse provider commands.'
                  : composerTrigger?.kind === 'path'
                  ? 'No matching files or folders.'
                  : 'No matching command.'
              }
            />
          </Box>
        )}

        {/* Image attachments */}
        <ImageAttachmentGrid
          images={images}
          onRemove={handleRemoveImage}
        />

        {/* Terminal context chips */}
        <TerminalContextChips
          contexts={terminalContexts}
          onRemove={onRemoveTerminalContext}
        />

        {/* Text area */}
        <TextArea
          value={
            activePendingApproval
              ? ''
              : pendingProgress
              ? pendingProgress.customAnswer
              : prompt
          }
          onChange={(next) => {
            if (pendingProgress && activePendingUserInput) {
              setPendingDraftAnswers((prev) => ({
                ...prev,
                [activePendingUserInput.questions[pendingProgress.questionIndex].id]: {
                  ...prev[activePendingUserInput.questions[pendingProgress.questionIndex].id],
                  customAnswer: next,
                },
              }));
            } else {
              handlePromptChange(next);
            }
          }}
          placeholder={placeholderText}
          style={{
            minHeight: 64,
            maxHeight: 200,
            padding: 10,
            fontSize: 13,
            color: C.text,
            backgroundColor: C.bgMuted,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: isComposerFocused ? 'rgba(59,130,246,0.4)' : C.border,
          }}
          onSubmit={handleSubmit}
          onFocus={() => setIsComposerFocused(true)}
          onBlur={() => setIsComposerFocused(false)}
          onKeyDown={(e: { key: string; shiftKey: boolean; preventDefault: () => void }) => {
            const handled = handleCommandKey(e.key, e.shiftKey);
            if (handled) e.preventDefault();
          }}
          disabled={isComposerDisabled}
        />

        {/* Footer toolbar */}
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Row style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <ModelPicker
              providers={providers.filter((p) => p.enabled)}
              selection={currentModelSelection}
              onChange={onModelChange}
            />
            {isFooterCompact ? (
              <CompactControlsMenu
                activePlan={showPlanSidebarToggle}
                interactionMode={currentInteractionMode}
                planSidebarLabel={planLabel}
                planSidebarOpen={planSidebarOpen}
                runtimeMode={currentRuntimeMode}
                showInteractionModeToggle={showInteractionModeToggle}
                onToggleInteractionMode={() =>
                  onInteractionModeChange(currentInteractionMode === 'build' ? 'plan' : 'build')
                }
                onTogglePlanSidebar={onTogglePlanSidebar}
                onRuntimeModeChange={onRuntimeModeChange}
              />
            ) : (
              <>
                <TraitPicker
                  provider={thread?.modelSelection.instanceId ?? ''}
                  onPromptChange={(prefix) => {
                    setPrompt((prev) => prefix + prev);
                  }}
                />
                <InteractionModeButton
                  mode={currentInteractionMode}
                  onToggle={() =>
                    onInteractionModeChange(currentInteractionMode === 'build' ? 'plan' : 'build')
                  }
                />
                <RuntimeModePicker mode={currentRuntimeMode} onChange={onRuntimeModeChange} />
                <PlanSidebarButton
                  open={planSidebarOpen}
                  onToggle={onTogglePlanSidebar}
                  label={planLabel}
                />
              </>
            )}
            {contextWindow && <ContextWindowMeter usage={contextWindow} />}
          </Row>

          <Row style={{ alignItems: 'center', gap: 8 }}>
            {isPreparingWorktree && (
              <Text style={{ fontSize: 11, color: C.textMuted }}>Preparing worktree…</Text>
            )}
            <ComposerPrimaryActions
              pendingAction={pendingPrimaryAction}
              isRunning={phase === 'streaming'}
              showPlanFollowUpPrompt={pendingUserInputs.length === 0 && Boolean(showPlanFollowUpPrompt)}
              promptHasText={prompt.trim().length > 0}
              isSendBusy={isSendBusy ?? false}
              isConnecting={isConnecting ?? false}
              isEnvironmentUnavailable={environmentUnavailable !== null}
              isPreparingWorktree={isPreparingWorktree ?? false}
              hasSendableContent={composerSendState.hasSendableContent}
              onPreviousPendingQuestion={handlePreviousQuestion}
              onInterrupt={onInterrupt}
              onImplementPlanInNewThread={onImplementPlanInNewThread}
            />
          </Row>
        </Row>
      </Col>
    </Col>
  );
}
