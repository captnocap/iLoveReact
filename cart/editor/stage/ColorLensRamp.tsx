import { C } from '../workspace.cls';
import { rampBarCss, rampForge } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

const STEP_OPTIONS = [5, 7, 9];

export default function ColorLensRamp(props: {
  current: OklchColor;
  steps: number;
  onPick: (color: OklchColor) => void;
  onSetSteps: (steps: number) => void;
}) {
  const ramp = rampForge(props.current, props.steps);
  return (
    <C.HW_LensBody>
      <C.HW_RampBar style={{ background: rampBarCss(props.current) }} />
      <C.HW_RampStepsRow>
        {ramp.map((step, index) => (
          <C.HW_RampStep key={index} onPress={() => props.onPick(step.color)} style={{ backgroundColor: step.css }} />
        ))}
      </C.HW_RampStepsRow>
      <C.HW_RampControlRow>
        <C.HW_KeyText>STEPS</C.HW_KeyText>
        <C.HW_RampStepsTrack>
          {STEP_OPTIONS.map((count) => {
            const Btn = count === props.steps ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
            const Label = count === props.steps ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
            return <Btn key={count} onPress={() => props.onSetSteps(count)}><Label>{count}</Label></Btn>;
          })}
        </C.HW_RampStepsTrack>
        <C.HW_Spacer />
      </C.HW_RampControlRow>
    </C.HW_LensBody>
  );
}
