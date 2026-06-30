import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';

export default function PresetSection(props: {
  title: string;
  color: string;
  active: string;
  options: string[];
  open: boolean;
  rows: string[][];
  onPreset: () => void;
  onOption: (preset: string) => void;
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(props.color) }} />
        <C.HW_SectionTitle style={{ color: accentFor(props.color) }}>{props.title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>editable</C.HW_KeyText>
      </C.HW_SectionHead>
      <C.HW_SelectRow>
        <C.HW_FormLabel>preset</C.HW_FormLabel>
        <C.HW_SelectControl onPress={props.onPreset}>
          <C.HW_FormValue>{props.active}</C.HW_FormValue>
          <C.HW_Spacer />
          <Icon name={props.open ? 'ChevronUp' : 'ChevronDown'} size={12} color={accentFor('textDim')} />
        </C.HW_SelectControl>
      </C.HW_SelectRow>
      {props.open ? (
        <C.HW_SelectMenu>
          {props.options.map((preset) => (
            <C.HW_SelectOption key={preset} onPress={() => props.onOption(preset)}>
              <C.HW_FormValue>{preset}</C.HW_FormValue>
              <C.HW_Spacer />
              {preset === props.active ? <Icon name="Check" size={12} color={accentFor('primary')} /> : null}
            </C.HW_SelectOption>
          ))}
        </C.HW_SelectMenu>
      ) : null}
      {props.rows.map(([label, value]) => (
        <C.HW_ReadRow key={label}>
          <C.HW_FormLabel>{label}</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_ReadValue>{value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
    </C.HW_Section>
  );
}
