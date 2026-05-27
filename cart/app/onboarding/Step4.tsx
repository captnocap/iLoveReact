import { useEffect, useRef, useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import { useBreakpoint } from '@reactjit/runtime/classifier';
import { SnakeSpinner } from '../gallery/components/grid-spinners/GridSpinners';
import { useAnimationTimeline } from '../anim';
import { useOnboarding } from './state.tsx';

const DEFAULT_CONFIG_PATH = '~/.app/config';

// Carryover branching message — must match Step3's exit copy so the hand-off
// looks continuous. Step3 picks based on `traits.length > 0`; we re-derive
// the same gate here so direct nav (chrome cubes) lands consistently too.
const CARRY_MSG_NO_SELECTION  = "We get it, onboardings suck.";
const CARRY_MSG_HAS_SELECTION = "Somehow we already knew that about you...";

// Carryover timeline (when arriving from Step3's exit transition).
const T_HOLD_END         = 500;
const T_CARRY_FADE_END   = 1400;
const T_MAIN_IN_END      = 1950;
const T_MAIN_SLIDE_END   = 2450;
const T_INPUT_IN_END     = 3050;
const T_BTN_IN_END       = 3450;

const SKIP_OFFSET = T_CARRY_FADE_END;
const SLIDE_UP_PX = 60;

// Exit timeline (forward click → step 4). Mirrors Step2/Step3 exit shape.
const EXIT_TOTAL_MS    = 1900;
const EXIT_MENU_OUT    = [0,    380];
const EXIT_SPINNER_IN  = [190,  665];
const EXIT_MESSAGE_IN  = [570, 1235];

const EXIT_MESSAGE = "Got it.";

export default function Step4() {
  const onb = useOnboarding();
  const bp = useBreakpoint();
  // At sm the path input fills the parent column instead of holding its
  // 360px desktop width; otherwise it overflows narrow viewports.
  const inputWidth = bp === 'sm' ? '100%' : 360;
  const traits = Array.isArray(onb.traits) ? onb.traits : [];
  // Carryover gate: a non-null providerKind means the user actually flowed
  // through Step3 to get here. Direct nav via chrome cubes skips carryover.
  const hasCarry = !!onb.providerKind;
  const carryMessage = traits.length > 0 ? CARRY_MSG_HAS_SELECTION : CARRY_MSG_NO_SELECTION;

  const tl = useAnimationTimeline({ skip: !hasCarry, skipOffsetMs: SKIP_OFFSET });

  const carryOp   = hasCarry ? tl.fadeOut(T_HOLD_END, T_CARRY_FADE_END) : 0;
  const mainOp    = tl.range(T_CARRY_FADE_END, T_MAIN_IN_END);
  const slideP    = tl.range(T_MAIN_IN_END, T_MAIN_SLIDE_END);
  const inputOp   = tl.range(T_MAIN_SLIDE_END, T_INPUT_IN_END);
  const btnOp     = tl.range(T_INPUT_IN_END, T_BTN_IN_END);

  const persistedPath = typeof onb.configPath === 'string' ? onb.configPath : '';
  const [path, setPath] = useState(persistedPath);
  const handlePathChange = (...args) => {
    const first = args[0];
    if (typeof first === 'string') setPath(first);
    else if (first && typeof first === 'object' && typeof first.text === 'string') setPath(first.text);
  };
  const safePath = typeof path === 'string' ? path : '';
  const trimmedPath = safePath.trim();
  const hasInput = trimmedPath.length > 0;

  const pathRef = useRef(safePath);
  pathRef.current = safePath;
  const onbRef = useRef(onb);
  onbRef.current = onb;

  const [exitStartT, setExitStartT] = useState(null);
  const exitStartTRef = useRef(null);
  exitStartTRef.current = exitStartT;

  useEffect(() => {
    if (exitStartT == null) return;
    const id = setTimeout(() => {
      try { onbRef.current.setStep(4); } catch {}
    }, EXIT_TOTAL_MS);
    return () => clearTimeout(id);
  }, [exitStartT]);

  function forward() {
    if (exitStartTRef.current != null) return;
    const live = pathRef.current.trim();
    const finalPath = live.length > 0 ? live : DEFAULT_CONFIG_PATH;
    try { onbRef.current.setConfigPath(finalPath); } catch {}
    setExitStartT(tl.tRef.current);
  }

  function takeMeBack() {
    if (exitStartTRef.current != null) return;
    try { onbRef.current.setStep(2); } catch {}
  }

  const forwardLabel = hasInput ? 'Next' : 'Use default';

  const exitMenuOut    = exitStartT != null ? tl.range(exitStartT + EXIT_MENU_OUT[0],   exitStartT + EXIT_MENU_OUT[1])   : 0;
  const exitSpinnerIn  = exitStartT != null ? tl.range(exitStartT + EXIT_SPINNER_IN[0], exitStartT + EXIT_SPINNER_IN[1]) : 0;
  const exitMessageIn  = exitStartT != null ? tl.range(exitStartT + EXIT_MESSAGE_IN[0], exitStartT + EXIT_MESSAGE_IN[1]) : 0;
  const menuOpacityMul = 1 - exitMenuOut;

  return (
    <S.AppStepFrame>
      {/* Carryover Step3 message (centered) */}
      {hasCarry && carryOp > 0.001 && (
        <S.AppStepCenter style={{ paddingLeft: 24, paddingRight: 24, opacity: carryOp }}>
          <S.AppExitMessage>{carryMessage}</S.AppExitMessage>
        </S.AppStepCenter>
      )}

      {/* Carryover spinner (bottom-right) */}
      {hasCarry && carryOp > 0.001 && (
        <S.AppStepBottomRight style={{ opacity: carryOp }}>
          <SnakeSpinner />
        </S.AppStepBottomRight>
      )}

      {/* Main: prompt + path input */}
      <S.AppStepCenterCol
        style={{
          gap: 28,
          paddingLeft: 24, paddingRight: 24,
          opacity: mainOp * menuOpacityMul,
          marginTop: -slideP * SLIDE_UP_PX,
        }}
      >
        <S.AppPromptText>Where would you like to store your config files?</S.AppPromptText>

        <S.AppStepDimmable style={{ opacity: inputOp, marginTop: (1 - inputOp) * 12 }}>
          <S.AppNameInput
            value={safePath}
            onChange={handlePathChange}
            onSubmit={forward}
            placeholder={DEFAULT_CONFIG_PATH}
            style={{ width: inputWidth }}
          />
        </S.AppStepDimmable>
      </S.AppStepCenterCol>

      {/* Take me back (bottom-left) */}
      <S.AppStepBottomLeft style={{ opacity: btnOp * menuOpacityMul }}>
        <S.ButtonOutline onPress={takeMeBack}>
          <S.ButtonOutlineLabel>Take me back!</S.ButtonOutlineLabel>
        </S.ButtonOutline>
      </S.AppStepBottomLeft>

      {/* Forward (bottom-right) — "Use default" until typed, then "Next". */}
      <S.AppStepBottomRight style={{ opacity: btnOp * menuOpacityMul }}>
        {hasInput ? (
          <S.Button onPress={forward}>
            <S.ButtonLabel>{forwardLabel}</S.ButtonLabel>
          </S.Button>
        ) : (
          <S.ButtonOutline onPress={forward}>
            <S.ButtonOutlineLabel>{forwardLabel}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        )}
      </S.AppStepBottomRight>

      {/* Exit message (centered) — bridges into Step5 carryover. */}
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
