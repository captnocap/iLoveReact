// inspector/EditCell.tsx — the Model Focus panel's boxed-cell edit primitive
// (req_4392). THE BOX IS THE AFFORDANCE: derived facts render as plain text,
// anything writable renders as one of these boxed cells. No edit icons, no
// edit modes.
//
// Interaction contract (Model Focus Handoff):
//   · click turns the cell into an in-place input (focus border + caret);
//     Enter commits, Esc cancels, blur commits
//   · a horizontal drag on a numeric cell SCRUBS the value; the commit lands
//     once on release so the journal records one op, not a smear of them
//   · an overridden value reads bright (theme:text); a default value reads
//     gold (theme:valNum); the reserved ↺ reset column is dimmed at default
//
// Column grid (req_2626 II): rows keep the fixed 82px label column and the
// ALWAYS-reserved 18px reset end column so every row shares one right edge.
import { useRef, useState } from 'react';
import { Box, Pressable, Row, Text, TextInput } from '@reactjit/runtime/primitives';
import { C, accentFor } from '../workspace.cls';
import { REGIONS } from '../shell/regions';

const CELL_HEIGHT = 20;
/** Pointer travel below this is a click (edit); at or past it, a scrub. */
const SCRUB_START_PX = 3;
/** ↺ tint when the row already sits at its default. */
const RESET_IDLE_COLOR = '#3a4a58';

const cellBoxStyle = (editing: boolean, flex: boolean, width?: number) => ({
  height: CELL_HEIGHT,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  borderRadius: 2,
  borderWidth: 1,
  borderColor: editing ? accentFor('primary') : accentFor('controlBorder'),
  backgroundColor: accentFor('controlBg'),
  ...(flex ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width: width ?? 64 }),
});

export function fmtCellNumber(value: number, decimals = 2): string {
  const nearZero = Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value;
  return nearZero.toFixed(decimals);
}

/** One writable numeric cell. Click to type, drag horizontally to scrub. */
export function NumberCell(props: {
  value: number;
  onCommit: (value: number) => void;
  /** Differs from its default → bright text (the mock's #edf5f7). */
  overridden?: boolean;
  /** Value change per pixel of horizontal scrub travel. */
  scrubStep?: number;
  format?: (value: number) => string;
  /** Fixed width; omit for an equal flex share of the row (xyz triples). */
  width?: number;
  flex?: boolean;
  tooltip?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const gesture = useRef<null | { startX: number; startValue: number; scrubbing: boolean }>(null);
  const format = props.format ?? ((value: number) => fmtCellNumber(value));
  const scrubStep = props.scrubStep ?? 0.01;
  const flex = props.flex ?? !props.width;

  const commitDraft = () => {
    setEditing(false);
    const parsed = Number(draft.trim().replace(/[^0-9eE+.-]/g, ''));
    if (Number.isFinite(parsed) && parsed !== props.value) props.onCommit(parsed);
  };
  const pointerX = (event: any): number => {
    const x = Number(event?.x);
    if (Number.isFinite(x)) return x;
    const hostX = Number((globalThis as any).getMouseX?.());
    return Number.isFinite(hostX) ? hostX : 0;
  };

  if (editing) {
    return (
      <Box style={cellBoxStyle(true, flex, props.width)}>
        <TextInput
          value={draft}
          onChange={setDraft}
          autoFocus
          onKeyDown={(event: any) => {
            if (event?.key === 'Enter') commitDraft();
            if (event?.key === 'Escape') setEditing(false);
          }}
          onBlur={commitDraft}
          style={{
            width: '100%', height: CELL_HEIGHT - 2, paddingLeft: 4, paddingRight: 4,
            backgroundColor: 'transparent', color: accentFor('text'),
            fontSize: 10, fontFamily: 'monospace', fontWeight: 800, textAlign: 'center',
          }}
        />
      </Box>
    );
  }

  const shown = scrubPreview ?? props.value;
  return (
    <Pressable
      tooltip={props.tooltip}
      style={cellBoxStyle(false, flex, props.width)}
      onMouseDown={(event: any) => {
        gesture.current = { startX: pointerX(event), startValue: props.value, scrubbing: false };
      }}
      onMouseMove={(event: any) => {
        const active = gesture.current;
        if (!active) return;
        const travel = pointerX(event) - active.startX;
        if (!active.scrubbing && Math.abs(travel) < SCRUB_START_PX) return;
        active.scrubbing = true;
        setScrubPreview(active.startValue + travel * scrubStep);
      }}
      onMouseUp={(event: any) => {
        const active = gesture.current;
        gesture.current = null;
        setScrubPreview(null);
        if (!active) return;
        if (!active.scrubbing) {
          setDraft(format(props.value));
          setEditing(true);
          return;
        }
        const landed = active.startValue + (pointerX(event) - active.startX) * scrubStep;
        if (landed !== props.value) props.onCommit(landed);
      }}
    >
      <Text noWrap numberOfLines={1} style={{
        fontSize: 10, fontFamily: 'monospace', fontWeight: 800,
        color: accentFor(props.overridden ? 'text' : 'valNum'),
      }}>{format(shown)}</Text>
    </Pressable>
  );
}

/** A read-only boxed value — same optics as a writable cell for facts that sit
 *  in a cell grid (kept rare: derived facts normally render as plain text). */
export function FactCell(props: { value: string; flex?: boolean; width?: number }) {
  return (
    <Box style={cellBoxStyle(false, props.flex ?? !props.width, props.width)}>
      <Text noWrap numberOfLines={1} style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 800, color: accentFor('valNum') }}>{props.value}</Text>
    </Box>
  );
}

/** The dashed "assign…" enum cell — an unassigned value invites, never reads
 *  as a fact ("none · none" is banned by the handoff). */
export function AssignCell(props: { label?: string; onPress: () => void; tooltip?: string }) {
  return (
    <Pressable
      tooltip={props.tooltip}
      onPress={props.onPress}
      style={{
        height: CELL_HEIGHT, paddingLeft: 8, paddingRight: 8,
        alignItems: 'center', justifyContent: 'center',
        borderRadius: 2, borderWidth: 1, borderDashOn: 3, borderDashOff: 3,
        borderColor: accentFor('controlBorder'), backgroundColor: 'transparent',
      }}
      hoverStyle={{ borderColor: accentFor('primary') }}
    >
      <Text noWrap style={{ fontSize: 10, fontFamily: 'monospace', color: accentFor('textDim') }}>{props.label ?? 'assign…'}</Text>
    </Pressable>
  );
}

/** The reserved reset end column: always 18px so every row shares one right
 *  edge; interactive + visible only when the row is off its default. */
export function ResetCol(props: { overridden: boolean; onReset: () => void; tooltip?: string }) {
  if (!props.overridden) {
    return (
      <Box style={{ width: REGIONS.grid.endBtn, height: REGIONS.grid.endBtn, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 11, color: RESET_IDLE_COLOR }}>↺</Text>
      </Box>
    );
  }
  return (
    <Pressable
      tooltip={props.tooltip ?? 'Reset to default'}
      onPress={props.onReset}
      style={{ width: REGIONS.grid.endBtn, height: REGIONS.grid.endBtn, alignItems: 'center', justifyContent: 'center', borderRadius: 2 }}
      hoverStyle={{ backgroundColor: accentFor('surfaceHover') }}
    >
      <Text style={{ fontSize: 11, color: accentFor('textDim') }}>↺</Text>
    </Pressable>
  );
}

/** One grid row: 82px label · content · reserved reset column. */
export function CellRow(props: {
  label: string;
  children: any;
  overridden?: boolean;
  onReset?: () => void;
  resetTooltip?: string;
}) {
  return (
    <Row style={{ minHeight: REGIONS.grid.rowHeight + 3, alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, width: '100%' }}>
      <C.HW_FormLabel>{props.label}</C.HW_FormLabel>
      {props.children}
      {props.onReset
        ? <ResetCol overridden={props.overridden ?? false} onReset={props.onReset} tooltip={props.resetTooltip} />
        : <Box style={{ width: REGIONS.grid.endBtn, height: REGIONS.grid.endBtn }} />}
    </Row>
  );
}

/** The xyz triple: three equal flex cells sharing the row's content span. */
export function TripleCells(props: {
  values: readonly [number, number, number];
  onCommit: (axis: 0 | 1 | 2, value: number) => void;
  overridden?: boolean;
  scrubStep?: number;
  format?: (value: number) => string;
}) {
  return (
    <Row style={{ flexGrow: 1, minWidth: 0, gap: 4 }}>
      {([0, 1, 2] as const).map((axis) => (
        <NumberCell
          key={axis}
          flex
          value={props.values[axis]}
          overridden={props.overridden}
          scrubStep={props.scrubStep}
          format={props.format}
          onCommit={(value) => props.onCommit(axis, value)}
        />
      ))}
    </Row>
  );
}
