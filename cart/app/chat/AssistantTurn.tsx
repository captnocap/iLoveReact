// One turn render. The transcript stacks these top-to-bottom.
//
// Concept-art delta between side and full:
//   - 'side' hides the `▸ LIFT` affordance and the surface command
//     preview (limited horizontal real estate)
//   - 'full' shows both
// `showLift` flows down from <AssistantChat>; the surface card itself
// reads `showCommand` from the same prop.
//
// Pending-state animation: while `turn.pending` is true, the body +
// surface area renders inside a pixelate Filter at oscillating
// intensity. When `pending` flips false the filter tweens to 0 over
// ~400ms so the final card "materializes" out of the scramble.

import { useEffect, useRef, useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import { Box, Filter } from '@reactjit/runtime/primitives';
import type { AssistantTurn as AssistantTurnT } from './types';
import { AssistantSurface } from './AssistantSurface';

const PEND_BASE = 0.7;
const PEND_AMP  = 0.18;
const PEND_OSC_MS = 600;       // full sin period
const REVEAL_MS = 400;

function PendingFilter({
  pending,
  children,
}: {
  pending: boolean;
  children: any;
}) {
  // 'pending' = oscillate. 'revealing' = tween down. 'done' = passthrough.
  const [phase, setPhase] = useState<'pending' | 'revealing' | 'done'>(
    pending ? 'pending' : 'done',
  );
  const [intensity, setIntensity] = useState(pending ? PEND_BASE : 0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const sched = (fn: () => void) => {
      const g: any = globalThis;
      raf = g.requestAnimationFrame ? g.requestAnimationFrame(fn) : (setTimeout(fn, 16) as any);
    };
    const cancel = () => {
      const g: any = globalThis;
      if (g.cancelAnimationFrame) g.cancelAnimationFrame(raf);
      else clearTimeout(raf as any);
    };

    if (pending) {
      setPhase('pending');
      startRef.current = Date.now();
      const tick = () => {
        if (!alive) return;
        const t = Date.now() - startRef.current;
        const i = PEND_BASE + Math.sin((t / PEND_OSC_MS) * Math.PI * 2) * PEND_AMP;
        setIntensity(i);
        sched(tick);
      };
      sched(tick);
    } else if (phase === 'pending' || phase === 'revealing') {
      setPhase('revealing');
      const start = Date.now();
      const startVal = intensity > 0 ? intensity : PEND_BASE;
      const tick = () => {
        if (!alive) return;
        const e = Date.now() - start;
        const p = Math.min(1, e / REVEAL_MS);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        setIntensity(startVal * (1 - eased));
        if (p < 1) {
          sched(tick);
        } else {
          setPhase('done');
        }
      };
      sched(tick);
    }
    return () => { alive = false; cancel(); };
  }, [pending]);

  if (phase === 'done') return children;

  // Render a small skeleton placeholder underneath the filter while
  // pending, swap to real children during the reveal so the actual
  // content emerges from the scramble.
  return (
    <Filter shader="pixelate" intensity={intensity}>
      {phase === 'pending' ? (
        <Box style={{ flexDirection: 'column', gap: 8, paddingTop: 4, paddingBottom: 4 }}>
          <Box style={{ width: 220, height: 14, backgroundColor: 'theme:bg2' }} />
          <Box style={{ width: 320, height: 10, backgroundColor: 'theme:bg2' }} />
          <Box style={{ width: 180, height: 10, backgroundColor: 'theme:bg2' }} />
          <Box style={{ width: 96,  height: 22, backgroundColor: 'theme:accent' }} />
        </Box>
      ) : children}
    </Filter>
  );
}

export function AssistantTurn({
  turn,
  showLift,
}: {
  turn: Exclude<AssistantTurnT, { author: 'parallel' }>;
  showLift: boolean;
}) {
  if (turn.author === 'user') {
    return (
      <S.AppChatTurn>
        <S.AppChatTurnMetaRow>
          <S.AppChatTurnAuthor>
            <S.AppChatTurnAuthorText>YOU</S.AppChatTurnAuthorText>
          </S.AppChatTurnAuthor>
          <S.AppChatTurnTime>{turn.timestamp}</S.AppChatTurnTime>
        </S.AppChatTurnMetaRow>
        <S.AppChatYouTurn>
          <S.AppChatYouTurnCaret>{'>'}</S.AppChatYouTurnCaret>
          <S.AppChatYouTurnText>{turn.body}</S.AppChatYouTurnText>
        </S.AppChatYouTurn>
      </S.AppChatTurn>
    );
  }

  // assistant turn
  const hasSurface = !!turn.surface;
  // Intent surfaces replace the body — the raw `[<Title>...</Title>]`
  // text the model emitted is just markup we already parsed and rendered
  // as a card. Showing it again as prose alongside the card is noise.
  const isIntent = turn.surface?.kind === 'intent';
  const pending = !!turn.pending;
  return (
    <S.AppChatTurn>
      <S.AppChatTurnMetaRow>
        <S.AppChatTurnAuthor>
          <S.AppChatTurnAuthorText>ASST</S.AppChatTurnAuthorText>
        </S.AppChatTurnAuthor>
        <S.AppChatTurnTime>{turn.timestamp}</S.AppChatTurnTime>
        {hasSurface ? (
          <S.AppChatTurnTag>
            <S.AppChatTurnTagText>SURFACE</S.AppChatTurnTagText>
          </S.AppChatTurnTag>
        ) : null}
        {showLift && turn.lift ? (
          <S.AppChatTurnLift>{'> LIFT'}</S.AppChatTurnLift>
        ) : null}
      </S.AppChatTurnMetaRow>
      <PendingFilter pending={pending}>
        <Box style={{ flexDirection: 'column', gap: 6 }}>
          {turn.body && !isIntent ? (
            <S.AppChatTurnBody>{turn.body}</S.AppChatTurnBody>
          ) : null}
          {turn.surface ? (
            <AssistantSurface surface={turn.surface} showCommand={showLift} />
          ) : null}
        </Box>
      </PendingFilter>
    </S.AppChatTurn>
  );
}
