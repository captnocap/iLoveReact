// Trace — score after the music.
//
// Per docs/03-sequencer-plan-trace.md: the trace is what actually happened
// during a run, replayed against the plan. Not a log dump — a structural
// review surface where you can see which passes fired, which cells were
// dropped, where the playhead stalled, and what the agent narrated.
//
// This file is a placeholder. The real review surface lands when runs
// produce trace records. For now: an empty-state showing what *would*
// be shown, anchored to the persisted user/goal context.

import { Col, Row } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useUser, useLatestGoal } from '../data';

export default function TracePage() {
  const user = useUser();
  const goal = useLatestGoal();
  const name = user.data?.displayName ?? '';
  const goalText = goal.data[0]?.statement ?? null;

  return (
    <S.Page style={{ flexDirection: 'column', padding: 24, gap: 24 }}>
      <Row style={{ alignItems: 'baseline', gap: 12 }}>
        <S.Title>Trace</S.Title>
        <S.Caption>score after the music</S.Caption>
      </Row>

      <S.Card style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Col style={{ gap: 8, alignItems: 'center' }}>
          <S.Heading>No runs yet</S.Heading>
          <S.Caption>
            {name ? `${name}, sweep the sequencer to commit a plan.` : 'Sweep the sequencer to commit a plan.'}
          </S.Caption>
          {goalText ? (
            <S.TinyDim style={{ marginTop: 12 }}>
              {`Pinned goal: ${goalText}`}
            </S.TinyDim>
          ) : null}
        </Col>
      </S.Card>
    </S.Page>
  );
}
