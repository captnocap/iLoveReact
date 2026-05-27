import { useState, useCallback, memo } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import type { ProposedPlan, PlanStep } from '../types';

// ── step status icon ───────────────────────────────────────────────────────

function StepStatusIcon({ status }: { status: PlanStep['status'] }) {
  if (status === 'done') {
    return (
      <Box
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#16653430',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text fontSize={10} color="#22c55e">
          ✓
        </Text>
      </Box>
    );
  }

  if (status === 'skipped') {
    return (
      <Box
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#33333330',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text fontSize={10} color="#666">
          −
        </Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#444',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        style={{
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: '#555',
        }}
      />
    </Box>
  );
}

function stepRowBackground(status: PlanStep['status']): string {
  switch (status) {
    case 'done':
      return '#16653408';
    case 'skipped':
      return '#33333308';
    default:
      return 'transparent';
  }
}

function stepTextColor(status: PlanStep['status']): string {
  switch (status) {
    case 'done':
      return '#666';
    case 'skipped':
      return '#555';
    default:
      return '#aaa';
  }
}

function stepTextDecoration(status: PlanStep['status']): 'line-through' | 'none' {
  return status === 'done' ? 'line-through' : 'none';
}

// ── step row ───────────────────────────────────────────────────────────────

const StepRow = memo(function StepRow({ step }: { step: PlanStep }) {
  return (
    <Row
      style={{
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: stepRowBackground(step.status),
      }}
    >
      <Box style={{ marginTop: 2 }}>
        <StepStatusIcon status={step.status} />
      </Box>
      <Text
        fontSize={13}
        color={stepTextColor(step.status)}
        style={{
          flexShrink: 1,
          lineHeight: 18,
          textDecorationLine: stepTextDecoration(step.status),
        }}
      >
        {step.description}
      </Text>
    </Row>
  );
});

// ── full plan collapsible section ──────────────────────────────────────────

const FullPlanSection = memo(function FullPlanSection({
  planMarkdown,
}: {
  planMarkdown: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Col style={{ gap: 6 }}>
      <Pressable onPress={() => setExpanded((v) => !v)}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text fontSize={10} color="#555">
            {expanded ? '▼' : '▶'}
          </Text>
          <Text
            fontSize={10}
            color="#555"
            style={{
              textTransform: 'uppercase',
              letterSpacing: 2,
              fontWeight: 'bold',
            }}
          >
            Full Plan
          </Text>
        </Row>
      </Pressable>
      {expanded && (
        <Box
          style={{
            padding: 10,
            backgroundColor: '#16161a',
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#2a2a30',
          }}
        >
          <Text
            fontSize={11}
            color="#888"
            style={{ whiteSpace: 'pre-wrap', lineHeight: 16 }}
          >
            {planMarkdown}
          </Text>
        </Box>
      )}
    </Col>
  );
});

// ── plan header ────────────────────────────────────────────────────────────

const PlanHeader = memo(function PlanHeader({
  label,
  onClose,
  planMarkdown,
}: {
  label: string;
  onClose?: () => void;
  planMarkdown?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleCopy = useCallback(() => {
    if (!planMarkdown) return;
    try {
      const h = globalThis as any;
      if (typeof h.__clipboard_set === 'function') {
        h.__clipboard_set(planMarkdown);
      }
    } catch {
      /* ignore */
    }
    setMenuOpen(false);
  }, [planMarkdown]);

  return (
    <Row
      style={{
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: '#1f1f23',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Box
          style={{
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: '#1e3a8a20',
          }}
        >
          <Text
            fontSize={10}
            color="#3b82f6"
            style={{
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {label}
          </Text>
        </Box>
      </Row>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        {planMarkdown && (
          <Box style={{ position: 'relative' }}>
            <Pressable onPress={() => setMenuOpen((v) => !v)}>
              <Box
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 4,
                  borderRadius: 4,
                }}
              >
                <Text fontSize={12} color="#888">
                  ⋯
                </Text>
              </Box>
            </Pressable>
            {menuOpen && (
              <Col
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 0,
                  backgroundColor: '#1a1a1e',
                  borderWidth: 1,
                  borderColor: '#333',
                  borderRadius: 4,
                  padding: 4,
                  gap: 2,
                  zIndex: 10,
                  minWidth: 140,
                }}
              >
                <Pressable onPress={handleCopy}>
                  <Box
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 4,
                    }}
                  >
                    <Text fontSize={10} color="#aaa">
                      Copy to clipboard
                    </Text>
                  </Box>
                </Pressable>
              </Col>
            )}
          </Box>
        )}
        {onClose && (
          <Pressable onPress={onClose}>
            <Box
              style={{
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderRadius: 4,
              }}
            >
              <Text fontSize={12} color="#888">
                ✕
              </Text>
            </Box>
          </Pressable>
        )}
      </Row>
    </Row>
  );
});

// ── props ──────────────────────────────────────────────────────────────────

export interface PlanSidebarProps {
  plan: ProposedPlan | null;
  onAccept?: () => void;
  onReject?: () => void;
  onClose?: () => void;
  label?: string;
}

// ── main component ─────────────────────────────────────────────────────────

export const PlanSidebar = memo(function PlanSidebar({
  plan,
  onAccept,
  onReject,
  onClose,
  label = 'Plan',
}: PlanSidebarProps) {
  const planMarkdown = plan
    ? `${plan.title}\n\n${plan.description}\n\n${plan.steps
        .map((s, i) => `${i + 1}. [${s.status}] ${s.description}`)
        .join('\n')}`
    : null;

  return (
    <Col
      style={{
        width: 340,
        flexShrink: 0,
        borderLeftWidth: 1,
        borderColor: '#1f1f23',
        backgroundColor: '#0e0e10',
        height: '100%',
      }}
    >
      <PlanHeader
        label={label}
        onClose={onClose}
        planMarkdown={planMarkdown}
      />

      <ScrollView showScrollbar style={{ flexGrow: 1, width: '100%' }}>
        <Col style={{ padding: 12, gap: 12 }}>
          {plan && (
            <>
              {/* Plan title */}
              <Text
                fontSize={14}
                color="#e8e8e8"
                style={{ fontWeight: 'bold' }}
              >
                {plan.title}
              </Text>

              {/* Plan description */}
              {plan.description && (
                <Text
                  fontSize={12}
                  color="#888"
                  style={{ lineHeight: 18, whiteSpace: 'pre-wrap' }}
                >
                  {plan.description}
                </Text>
              )}

              {/* Step list */}
              {plan.steps.length > 0 && (
                <Col style={{ gap: 6 }}>
                  <Text
                    fontSize={10}
                    color="#555"
                    style={{
                      textTransform: 'uppercase',
                      letterSpacing: 2,
                      fontWeight: 'bold',
                      marginBottom: 4,
                    }}
                  >
                    Steps
                  </Text>
                  {plan.steps.map((step) => (
                    <StepRow key={step.id} step={step} />
                  ))}
                </Col>
              )}

              {/* Full plan markdown (collapsible) */}
              {planMarkdown && (
                <FullPlanSection planMarkdown={planMarkdown} />
              )}

              {/* Accept / Reject actions */}
              {plan.status === 'pending' && (
                <Row style={{ gap: 8, marginTop: 8 }}>
                  <Pressable onPress={onAccept}>
                    <Box
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        backgroundColor: '#166534',
                        borderRadius: 4,
                      }}
                    >
                      <Text fontSize={11} color="#ffffff">
                        Accept
                      </Text>
                    </Box>
                  </Pressable>
                  <Pressable onPress={onReject}>
                    <Box
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        backgroundColor: '#7f1d1d',
                        borderRadius: 4,
                      }}
                    >
                      <Text fontSize={11} color="#ffffff">
                        Reject
                      </Text>
                    </Box>
                  </Pressable>
                </Row>
              )}
            </>
          )}

          {/* Empty state */}
          {!plan && (
            <Col
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 48,
                gap: 6,
              }}
            >
              <Text fontSize={13} color="#444">
                No active plan yet.
              </Text>
              <Text fontSize={11} color="#333">
                Plans will appear here when generated.
              </Text>
            </Col>
          )}
        </Col>
      </ScrollView>
    </Col>
  );
});
