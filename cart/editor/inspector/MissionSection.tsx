// MissionSection — inspector section for mission wiring (triggers/points).
// Extracted verbatim from the workspace mock (one component per file).
import { C, accentFor } from '../workspace.cls';

export default function MissionSection(props: {
  rows: string[][];
  triggerCount: number;
  pointCount: number;
  onCommand: (id: string, source: string) => void;
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('success') }} />
        <C.HW_SectionTitle style={{ color: accentFor('success') }}>MISSION</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>applicable</C.HW_KeyText>
      </C.HW_SectionHead>
      {props.rows.map(([label, value]) => (
        <C.HW_ReadRow key={label}>
          <C.HW_FormLabel>{label}</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_ReadValue>{value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={() => props.onCommand('add-trigger', 'inspector')}><C.HW_FormValue>triggers - {props.triggerCount}</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => props.onCommand('mission-point', 'inspector')}><C.HW_FormValue>points - {props.pointCount}</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_Section>
  );
}
