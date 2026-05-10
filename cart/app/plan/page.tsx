// /plan — the planning surface.
//
// Layout:
//   • Rail (HUD) — replaces "01 ASSISTANT" with "02 PLANNING"
//     (PlanChatRail). The transcript and active-target indicator live
//     there; this page does NOT render its own chat panel.
//   • Main area — full-width plan document.
//   • Bottom dock — staged @target comments + send-batch button.
//   • InputStrip (shell) — claimed by this page on mount. Routing:
//     with an active anchor draft, submit stages a comment; otherwise
//     it goes to the planner.
//
// Chat turns + active draft live in plan/chatStore.ts so the rail
// and this page read the same state without prop drilling.

import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { claimInput, releaseInputClaim, useHudInsets } from '../shell';
import { PlanDocument } from './PlanDocument';
import { CommentDock } from './CommentDock';
import { makeSamplePlan } from './samplePlan';
import { appendRev, headRev, initPlanFile, newPlanId, savePlan } from './storage';
import { consumePendingIntent, subscribe as subscribePending } from './state';
import { applyCommentBatch } from './workerStub';
import {
  appendTurn as appendChatTurn,
  clearTurns as clearChatTurns,
  getDraft, setDraft, useDraft,
} from './chatStore';
import type { Comment, PlanFile } from './types';

const CLAIM_ID = 'plan-page';

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function PlanPage() {
  const insets = useHudInsets();

  const [file, setFile] = useState<PlanFile>(() => {
    const seed = consumePendingIntent();
    const plan = makeSamplePlan(seed || undefined);
    plan.id = newPlanId();
    plan.name = seed ? `Plan — ${seed.slice(0, 60)}` : plan.name;
    return initPlanFile(plan);
  });
  const head = headRev(file)!;

  const [comments, setComments] = useState<Comment[]>([]);
  const draft = useDraft();
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);

  // /plan slash arriving while page is open: reset to a fresh plan.
  useEffect(() => subscribePending(() => {
    const seed = consumePendingIntent();
    if (!seed) return;
    const plan = makeSamplePlan(seed);
    plan.id = newPlanId();
    plan.name = `Plan — ${seed.slice(0, 60)}`;
    setFile(initPlanFile(plan));
    setComments([]);
    setDraft(null);
    clearChatTurns();
  }), []);

  // Re-claim on draft change so the InputStrip's placeholder + SEND
  // button label always reflect what the next submit will actually do.
  useEffect(() => {
    claimInput({
      id: CLAIM_ID,
      placeholder: draft
        ? `Comment on @${draft.label}…`
        : 'Talk to the planner…',
      sendLabel: draft ? 'STAGE COMMENT' : 'ASK PLANNER',
      onSubmit: (text: string) => {
        const body = text.trim();
        if (!body) return;
        const d = getDraft();
        if (d) {
          setComments((prev) => prev.concat([{
            id: genId('c'),
            ref: d.ref,
            refLabel: d.label,
            body,
            status: 'queued',
            createdAt: Date.now(),
          }]));
          setDraft(null);
          return;
        }
        appendChatTurn({ id: genId('u'), author: 'user', body, ts: Date.now() });
        appendChatTurn({
          id: genId('a'),
          author: 'planner',
          body: '(planner not wired yet — this would call the worker; see workerStub.ts)',
          ts: Date.now(),
        });
      },
      onCancel: () => setDraft(null),
    });
  }, [draft]);

  // Release the claim only on unmount; re-claims above keep the slot.
  useEffect(() => () => releaseInputClaim(CLAIM_ID), []);

  const pendingByRef = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const c of comments) {
      if (c.status !== 'queued') continue;
      out[c.ref] = (out[c.ref] || 0) + 1;
    }
    if (draft) out[draft.ref] = (out[draft.ref] || 0) + 1;
    return out;
  }, [comments, draft]);

  const onTarget = (ref: string, label: string): void => setDraft({ ref, label });
  const onCancelDraft = (): void => setDraft(null);
  const onRemoveComment = (id: string): void => setComments((prev) => prev.filter((c) => c.id !== id));
  const onClear = (): void => setComments((prev) => prev.filter((c) => c.status !== 'queued'));

  const onSendBatch = async (): Promise<void> => {
    const queued = comments.filter((c) => c.status === 'queued');
    if (queued.length === 0) return;
    setSending(true);
    try {
      const nextPlan = await applyCommentBatch(head.plan, queued);
      setFile((prev) => appendRev(prev, nextPlan, queued));
      setComments((prev) =>
        prev.map((c) => (c.status === 'queued' ? { ...c, status: 'addressed' } : c))
            .filter((c) => c.status === 'addressed')
            .slice(-20),
      );
      setSaved(false);
    } finally {
      setSending(false);
    }
  };

  const onSave = (): void => {
    const ok = savePlan(file);
    if (ok) setSaved(true);
  };

  const plannerActive = draft === null;

  return (
    <Col style={{ width: '100%', flexGrow: 1, paddingBottom: insets.bottom }}>
      <Col style={{ flexGrow: 1, minHeight: 0 }}>
        <Row style={{
          paddingTop: 12, paddingBottom: 12, paddingLeft: 24, paddingRight: 24,
          borderBottomWidth: 1, borderBottomColor: 'theme:rule',
          alignItems: 'center', gap: 12,
        }}>
          <Col style={{ flexGrow: 1, gap: 2 }}>
            <Text size={20} bold color="theme:ink">{file.name}</Text>
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Text size={12} color="theme:inkDim">{`rev ${head.rev}`}</Text>
              {file.revs.length > 1 ? (
                <Text size={12} color="theme:inkDim">{`· ${file.revs.length} revs`}</Text>
              ) : null}
              <Text size={12} color="theme:inkDim">{`· planId ${file.planId}`}</Text>
            </Row>
          </Col>
          <Pressable
            onPress={onSave}
            style={{
              paddingTop: 8, paddingBottom: 8, paddingLeft: 14, paddingRight: 14,
              borderRadius: 4, borderWidth: 1, borderColor: 'theme:rule',
              backgroundColor: saved ? 'theme:bg2' : 'theme:accent',
            }}
          >
            <Text size={14} bold color={saved ? 'theme:ink' : 'theme:paper'}>
              {saved ? 'Saved' : 'Save to plans'}
            </Text>
          </Pressable>
        </Row>
        <Box style={{ flexGrow: 1, minHeight: 0 }}>
          <PlanDocument plan={head.plan} pendingByRef={pendingByRef} onTarget={onTarget} />
        </Box>
      </Col>

      <CommentDock
        comments={comments}
        draftRef={draft?.ref ?? null}
        draftRefLabel={draft?.label ?? null}
        active={!plannerActive}
        onCancelDraft={onCancelDraft}
        onRemoveComment={onRemoveComment}
        onClear={onClear}
        onSendBatch={onSendBatch}
        sending={sending}
      />
    </Col>
  );
}
