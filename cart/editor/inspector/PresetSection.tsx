import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { FactRow } from './ReadOnlySection';
import { useStackedRows } from './rowLayout';

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
  const stacked = useStackedRows();
  const control = (
    <C.HW_SelectControl onPress={props.onPreset}>
      <C.HW_FormValue>{props.active}</C.HW_FormValue>
      <C.HW_Spacer />
      <Icon name={props.open ? 'ChevronUp' : 'ChevronDown'} size={12} color={accentFor('textDim')} />
    </C.HW_SelectControl>
  );
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(props.color) }} />
        <C.HW_SectionTitle style={{ color: accentFor(props.color) }}>{props.title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>editable</C.HW_KeyText>
      </C.HW_SectionHead>
      {stacked ? (
        <C.HW_RowStacked>
          <C.HW_FormLabelStacked>preset</C.HW_FormLabelStacked>
          <C.HW_RowStackedControls>{control}</C.HW_RowStackedControls>
        </C.HW_RowStacked>
      ) : (
        <C.HW_SelectRow>
          <C.HW_FormLabel>preset</C.HW_FormLabel>
          {control}
        </C.HW_SelectRow>
      )}
      {props.open ? (
        // The open menu hangs under the control, so it indents past the label
        // column inline and spans the row when the label is on its own line.
        <C.HW_SelectMenu style={stacked ? { marginLeft: 12 } : undefined}>
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
        <FactRow key={label} label={label ?? ''} value={value ?? ''} endColumn={false} />
      ))}
    </C.HW_Section>
  );
}
