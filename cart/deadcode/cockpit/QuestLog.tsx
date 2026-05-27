// QuestLog — right-side panel mirror of the raid column.
// Quest state:  0=none 1=pending 2=active 3=done 4=failed
// Step state:   0=unused 1=pending 2=active 3=verify_pending
//               4=verify_passed 5=planner_confirmed 6=done 7=rejected

import { C } from './style.cls';

function StepPip(props: any) {
  const s = props.state;
  return (
    <C.QuestStepRow>
      <C.QuestStepOrd>{props.ord}</C.QuestStepOrd>
      {s === 1 && <C.QuestStepPipPending />}
      {s === 2 && <C.QuestStepPipActive />}
      {s === 3 && <C.QuestStepPipVerifyPending />}
      {s === 4 && <C.QuestStepPipVerifyPassed />}
      {s === 5 && <C.QuestStepPipPlannerConfirmed />}
      {s === 6 && <C.QuestStepPipDone />}
      {s === 7 && <C.QuestStepPipRejected />}
      <C.QuestStepText>{props.text}</C.QuestStepText>
    </C.QuestStepRow>
  );
}

// State icon — single glyph pinned absolutely to the card's top-right corner.
// Direct child of QuestCard so position:absolute anchors to the card, not the
// inner title row.
function QuestStateIcon(props: any) {
  const s = props.state;
  if (s === 1) return <C.QuestStateIconPending>◌</C.QuestStateIconPending>;
  if (s === 2) return <C.QuestStateIconActive>●</C.QuestStateIconActive>;
  if (s === 3) return <C.QuestStateIconDone>✓</C.QuestStateIconDone>;
  if (s === 4) return <C.QuestStateIconFailed>✕</C.QuestStateIconFailed>;
  return null;
}

export function QuestCard(props: any) {
  const isExpanded = props.expanded === 1;
  const doneCount = props.doneCount;
  const totalSteps = props.totalSteps;
  const progressRem = totalSteps - doneCount;
  const partyCount = props.partyCount;

  const steps: Array<{ ord: string; state: number; text: string }> = [];
  for (let i = 0; i < 12; i++) {
    const st = props['s' + i + '_state'];
    if (st > 0) {
      steps.push({ ord: String(i + 1), state: st, text: props['s' + i + '_text'] });
    }
  }

  return (
    <C.QuestCard onPress={props.onPress} hoverable={1}>
      {isExpanded ? <C.QuestCardBorderActive /> : <C.QuestCardBorderIdle />}

      <C.QuestTitleRow>
        <C.QuestTitle>{props.title}</C.QuestTitle>
      </C.QuestTitleRow>
      <QuestStateIcon state={props.state} />

      <C.QuestMetaRow>
        <C.QuestMetaText>{`${doneCount} / ${totalSteps} steps`}</C.QuestMetaText>
        <C.QuestPartyRow>
          {partyCount >= 1 && <C.QuestPartyDot />}
          {partyCount >= 2 && <C.QuestPartyDot />}
          {partyCount >= 3 && <C.QuestPartyDot />}
        </C.QuestPartyRow>
      </C.QuestMetaRow>

      <C.QuestProgressBar>
        <C.QuestProgressFill style={{ flexGrow: doneCount, flexBasis: 0 }} />
        <C.QuestProgressGap style={{ flexGrow: progressRem, flexBasis: 0 }} />
      </C.QuestProgressBar>

      {isExpanded && (
        <C.QuestStepList>
          {steps.map((s, i) => <StepPip key={i} ord={s.ord} state={s.state} text={s.text} />)}
        </C.QuestStepList>
      )}
    </C.QuestCard>
  );
}
