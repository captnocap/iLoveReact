import { C, accentFor } from '../workspace.cls';

export default function ReadOnlySection(props: {
  title: string;
  color: string;
  rows: string[][];
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(props.color) }} />
        <C.HW_SectionTitle style={{ color: accentFor(props.color) }}>{props.title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{props.rows.length}</C.HW_KeyText>
      </C.HW_SectionHead>
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
