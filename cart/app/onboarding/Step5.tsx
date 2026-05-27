import { useEffect, useRef, useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import { useBreakpoint } from '@reactjit/runtime/classifier';
import { SnakeSpinner } from '../gallery/components/grid-spinners/GridSpinners';
import { useAnimationTimeline } from '../anim';
import { useOnboarding } from './state.tsx';

const STEP4_BRIDGE_MESSAGE = 'Got it.';

// Carryover timeline (when arriving from Step4's exit transition).
const T_HOLD_END        = 500;
const T_BRIDGE_FADE_END = 1400;
const T_MAIN_IN_END     = 1950;
const T_MAIN_SLIDE_END  = 2450;
const T_INPUT_IN_END    = 3050;

const SKIP_OFFSET = T_BRIDGE_FADE_END;
const SLIDE_UP_PX = 60;

// "Take me back" appears at the same time the prompt + input land.
const T_BACK_IN_END = T_INPUT_IN_END;

// Forward buttons fade in when the user types their first character.
const FORWARD_FADE_MS = 350;

// Exit timeline (Finish / I-don't-know click → markComplete).
const EXIT_TOTAL_MS    = 1900;
const EXIT_MENU_OUT    = [0,    380];
const EXIT_SPINNER_IN  = [190,  665];
const EXIT_MESSAGE_IN  = [570, 1235];

const EXIT_MESSAGE = 'Welcome aboard.';

// Popover description for the "goal" hyperlink.
const GOAL_TOOLTIP =
  "A goal is a clear outcome you're after — concrete enough that you'd know when it's done. " +
  "It can be small (\"draft my résumé\") or sweeping (\"learn to play a song\"). " +
  "We'll use it to shape suggestions; you can always change it later.";

export default function Step5() {
  const onb = useOnboarding();
  const bp = useBreakpoint();
  // At sm the goal input fills the parent column instead of holding its
  // 480px desktop width.
  const inputWidth = bp === 'sm' ? '100%' : 480;
  // Carryover gate: a non-empty configPath means the user actually flowed
  // through Step4. Direct nav via chrome cubes skips carryover.
  const hasCarry = typeof onb.configPath === 'string' && onb.configPath.length > 0;

  const tl = useAnimationTimeline({ skip: !hasCarry, skipOffsetMs: SKIP_OFFSET });

  const bridgeOp = hasCarry ? tl.fadeOut(T_HOLD_END, T_BRIDGE_FADE_END) : 0;
  const mainOp   = tl.range(T_BRIDGE_FADE_END, T_MAIN_IN_END);
  const slideP   = tl.range(T_MAIN_IN_END, T_MAIN_SLIDE_END);
  const inputOp  = tl.range(T_MAIN_SLIDE_END, T_INPUT_IN_END);
  const backOp   = tl.range(T_MAIN_SLIDE_END, T_BACK_IN_END);

  const persistedGoal = typeof onb.goal === 'string' ? onb.goal : '';
  const [goal, setGoal] = useState(persistedGoal);
  const handleGoalChange = (...args) => {
    const first = args[0];
    if (typeof first === 'string') setGoal(first);
    else if (first && typeof first === 'object' && typeof first.text === 'string') setGoal(first.text);
  };
  const safeGoal = typeof goal === 'string' ? goal : '';
  const trimmedGoal = safeGoal.trim();
  const hasInput = trimmedGoal.length > 0;

  const goalRef = useRef(safeGoal);
  goalRef.current = safeGoal;
  const onbRef = useRef(onb);
  onbRef.current = onb;

  // The forward button cluster appears at the moment the user lands their
  // first character — captured timeline-time so the fade is independent of
  // entry-timeline phases. Reset to null if the user empties the input.
  const [forwardAtT, setForwardAtT] = useState(null);
  useEffect(() => {
    if (hasInput && forwardAtT == null) {
      setForwardAtT(tl.tRef.current);
    } else if (!hasInput && forwardAtT != null) {
      setForwardAtT(null);
    }
  }, [hasInput, forwardAtT]);

  const forwardOp = forwardAtT != null
    ? tl.range(forwardAtT, forwardAtT + FORWARD_FADE_MS)
    : 0;

  const [exitStartT, setExitStartT] = useState(null);
  const exitStartTRef = useRef(null);
  exitStartTRef.current = exitStartT;

  useEffect(() => {
    if (exitStartT == null) return;
    const id = setTimeout(() => {
      try { onbRef.current.markComplete(); } catch {}
    }, EXIT_TOTAL_MS);
    return () => clearTimeout(id);
  }, [exitStartT]);

  function finish() {
    if (exitStartTRef.current != null) return;
    const live = goalRef.current.trim();
    if (!live.length) return;
    try { onbRef.current.setGoal(live); } catch {}
    setExitStartT(tl.tRef.current);
  }

  function dontKnow() {
    if (exitStartTRef.current != null) return;
    try { onbRef.current.setGoal(''); } catch {}
    setExitStartT(tl.tRef.current);
  }

  function takeMeBack() {
    if (exitStartTRef.current != null) return;
    try { onbRef.current.setStep(3); } catch {}
  }

  const exitMenuOut    = exitStartT != null ? tl.range(exitStartT + EXIT_MENU_OUT[0],   exitStartT + EXIT_MENU_OUT[1])   : 0;
  const exitSpinnerIn  = exitStartT != null ? tl.range(exitStartT + EXIT_SPINNER_IN[0], exitStartT + EXIT_SPINNER_IN[1]) : 0;
  const exitMessageIn  = exitStartT != null ? tl.range(exitStartT + EXIT_MESSAGE_IN[0], exitStartT + EXIT_MESSAGE_IN[1]) : 0;
  const menuOpacityMul = 1 - exitMenuOut;

  return (
    <S.AppStepFrame>
      {/* Carryover Step4 bridge "Got it." (centered) */}
      {hasCarry && bridgeOp > 0.001 && (
        <S.AppStepCenter style={{ opacity: bridgeOp }}>
          <S.AppGreet>{STEP4_BRIDGE_MESSAGE}</S.AppGreet>
        </S.AppStepCenter>
      )}

      {/* Carryover spinner (bottom-right) */}
      {hasCarry && bridgeOp > 0.001 && (
        <S.AppStepBottomRight style={{ opacity: bridgeOp }}>
          <SnakeSpinner />
        </S.AppStepBottomRight>
      )}

      {/* Main: prompt + goal input */}
      <S.AppStepCenterCol
        style={{
          gap: 28,
          paddingLeft: 24, paddingRight: 24,
          opacity: mainOp * menuOpacityMul,
          marginTop: -slideP * SLIDE_UP_PX,
        }}
      >
        <S.AppPromptRow>
          <S.AppPromptText>What is your first </S.AppPromptText>
          <Tooltip label={GOAL_TOOLTIP} side="top" delayMs={200}>
            <S.AppPromptLink>
              <S.AppPromptLinkText>goal</S.AppPromptLinkText>
            </S.AppPromptLink>
          </Tooltip>
          <S.AppPromptText>?</S.AppPromptText>
        </S.AppPromptRow>

        <S.AppStepDimmable style={{ opacity: inputOp, marginTop: (1 - inputOp) * 12 }}>
          <S.AppNameInput
            value={safeGoal}
            onChange={handleGoalChange}
            onSubmit={finish}
            placeholder=""
            style={{ width: inputWidth }}
          />
        </S.AppStepDimmable>
      </S.AppStepCenterCol>

      {/* Take me back (bottom-left) */}
      <S.AppStepBottomLeft style={{ opacity: backOp * menuOpacityMul }}>
        <S.ButtonOutline onPress={takeMeBack}>
          <S.ButtonOutlineLabel>Take me back!</S.ButtonOutlineLabel>
        </S.ButtonOutline>
      </S.AppStepBottomLeft>

      {/* Forward cluster (bottom-right) — both buttons land together once the
          user types their first character. "I don't know" submits an empty
          goal; "Finish" commits the typed value. Both run the same exit. */}
      {forwardAtT != null ? (
        <S.AppStepBottomRightRow style={{ opacity: forwardOp * menuOpacityMul, marginTop: (1 - forwardOp) * 8 }}>
          <S.ButtonOutline onPress={dontKnow}>
            <S.ButtonOutlineLabel>I don't know</S.ButtonOutlineLabel>
          </S.ButtonOutline>
          <S.Button onPress={finish}>
            <S.ButtonLabel>Finish</S.ButtonLabel>
          </S.Button>
        </S.AppStepBottomRightRow>
      ) : null}

      {/* Exit message (centered) */}
      {exitStartT != null ? (
        <S.AppStepCenter
          style={{
            paddingLeft: 24, paddingRight: 24,
            opacity: exitMessageIn,
            marginTop: (1 - exitMessageIn) * 8,
          }}
        >
          <S.AppGreet>{EXIT_MESSAGE}</S.AppGreet>
        </S.AppStepCenter>
      ) : null}

      {/* Exit spinner (bottom-right) */}
      {exitStartT != null ? (
        <S.AppStepBottomRight style={{ opacity: exitSpinnerIn }}>
          {exitSpinnerIn > 0.001 ? <SnakeSpinner /> : null}
        </S.AppStepBottomRight>
      ) : null}
    </S.AppStepFrame>
  );
}
