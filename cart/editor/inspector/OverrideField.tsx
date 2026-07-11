// inspector/OverrideField.tsx — one editor-owned per-instance override control
// (req_2563 Phase 3), drawn in the shared cls vocabulary.
//
// A num field is a [−] value [+] stepper; a bool field is an On/Off toggle. When
// the piece carries no override for this path the field shows its BASE dimmed
// ("inherits the kind default"); once set it shows the live value + a ↺ reset
// chip that clears the override back to inherit.
//
// Column grid (req_2626 II): every dimension here comes from REGIONS.grid via
// workspace.cls — fixed label column (HW_FormLabel), fixed stepper/value/toggle
// columns (HW_OvBtn/HW_OvVal/HW_OvToggle), and the reset END column is ALWAYS
// reserved (HW_OvReset or HW_OvResetIdle) so every row shares one right edge.
import { C } from '../workspace.cls';
import type { OverridableProp } from './overridables';

export default function OverrideField(props: {
  prop: OverridableProp;
  value: number | boolean | undefined;
  onSet: (path: string, value: number | boolean) => void;
  onClear: (path: string) => void;
}) {
  const { prop } = props;
  const set = props.value !== undefined;

  if (prop.ctl === 'bool') {
    const eff = (set ? props.value : prop.base) as boolean;
    const Toggle = set && eff ? C.HW_OvToggleOn : C.HW_OvToggle;
    const Txt = set && eff ? C.HW_OvToggleTextOn : C.HW_OvToggleText;
    return (
      <C.HW_ReadRow>
        <C.HW_FormLabel>{prop.label}</C.HW_FormLabel>
        <C.HW_Spacer />
        <Toggle onPress={() => props.onSet(prop.path, !eff)}>
          <Txt>{eff ? 'On' : 'Off'}</Txt>
        </Toggle>
        {set
          ? <C.HW_OvReset tooltip="reset to the piece kind's default" onPress={() => props.onClear(prop.path)}><C.HW_OvResetText>↺</C.HW_OvResetText></C.HW_OvReset>
          : <C.HW_OvResetIdle />}
      </C.HW_ReadRow>
    );
  }

  const step = prop.step ?? 1;
  const min = prop.min ?? 0;
  const max = prop.max ?? 999;
  const eff = (set ? props.value : prop.base) as number;
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const fmt = (v: number) => (step < 1 ? v.toFixed(2) : String(Math.round(v)));
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{prop.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <C.HW_OvBtn onPress={() => props.onSet(prop.path, clamp(eff - step))}><C.HW_OvBtnText>−</C.HW_OvBtnText></C.HW_OvBtn>
      {set ? <C.HW_OvVal>{fmt(eff)}</C.HW_OvVal> : <C.HW_OvValIdle>{fmt(prop.base)}</C.HW_OvValIdle>}
      <C.HW_OvBtn onPress={() => props.onSet(prop.path, clamp(eff + step))}><C.HW_OvBtnText>+</C.HW_OvBtnText></C.HW_OvBtn>
      {set
        ? <C.HW_OvReset tooltip="reset to the piece kind's default" onPress={() => props.onClear(prop.path)}><C.HW_OvResetText>↺</C.HW_OvResetText></C.HW_OvReset>
        : <C.HW_OvResetIdle />}
    </C.HW_ReadRow>
  );
}
