import { C, accentFor } from '../workspace.cls';
import { useStackedRows } from './rowLayout';

/** One fact: a label and its value.
 *
 *  Inline it sits on the shared column grid — 82px label, value flexed to the
 *  panel's one right edge, the reserved reset column keeping that edge aligned
 *  with the writable rows above it.
 *
 *  Stacked (narrow panel, req_4774) the label takes its own line and the value
 *  WRAPS underneath at full width, because a fact like
 *  "49 B · preserved, never interpreted" is a sentence, and squeezing a
 *  sentence into 60px of a shared line is how the panel got called unusable. */
function FactRow(props: {
  label: string;
  value: string;
  endColumn: boolean;
  /** A fact that is a WARNING is still a fact — it belongs on this row grammar
   *  tinted, not in a bespoke row somebody wrote to get a colour (req_4775). */
  tone?: 'normal' | 'warning' | 'danger' | 'success';
}) {
  const tinted = props.tone && props.tone !== 'normal'
    ? { color: accentFor(props.tone === 'danger' ? 'error' : props.tone) }
    : undefined;
  if (useStackedRows()) {
    return (
      <C.HW_RowStacked>
        <C.HW_FormLabelStacked>{props.label}</C.HW_FormLabelStacked>
        <C.HW_RowStackedControls>
          <C.HW_ReadValueStacked style={tinted}>{props.value}</C.HW_ReadValueStacked>
          {props.endColumn ? <C.HW_OvResetIdle /> : null}
        </C.HW_RowStackedControls>
      </C.HW_RowStacked>
    );
  }
  return (
    <C.HW_ReadRow>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      <C.HW_Spacer />
      <C.HW_ReadValue style={tinted}>{props.value}</C.HW_ReadValue>
      {/* Reserved reset-column spacer (req_2626 II / req_2627): read-only rows sit on
          the SAME column grid as OverrideField/PieceBody rows, whose end column is
          always occupied (HW_OvReset or HW_OvResetIdle) — without it these values
          landed endBtn+gap px right of every override value's edge. */}
      {props.endColumn ? <C.HW_OvResetIdle /> : null}
    </C.HW_ReadRow>
  );
}

export { FactRow };

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
        <FactRow key={label} label={label ?? ''} value={value ?? ''} endColumn />
      ))}
    </C.HW_Section>
  );
}
