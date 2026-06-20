// IntersectionRail — the per-junction control card (INTERSECTIONS-0619, req_1480).
//
// Junctions are DERIVED (roadData.deriveJunctions); the one thing a human authors
// at one is its CONTROL TYPE. Click a junction badge on the canvas and this card
// opens: it names the crossing roads, lists the arms, and offers the three types
// (uncontrolled / 4-way stop / signals). Picking one regenerates the signage —
// stop signs or lights on each arm, plus street-name signs printing the roads.

import { Box, Pressable, Text } from '@reactjit/primitives';
import { RailLabel } from './railAtoms';
import {
  INTERSECTION_CONTROL_LABEL, junctionRoadNames,
  type AuthorJunction, type IntersectionControl,
} from './intersections';

const TYPES: IntersectionControl[] = ['allWayStop', 'signals', 'uncontrolled'];
const SIDE_LABEL: Record<string, string> = { N: 'N', E: 'E', S: 'S', W: 'W' };

export function IntersectionRail(props: {
  junction: AuthorJunction;
  control: IntersectionControl;
  onControl: (c: IntersectionControl) => void;
  onClose: () => void;
  /** roadId → effective (collinear-group) name; falls back to the leg's own. */
  nameOf?: (roadId: string, fallback?: string) => string | undefined;
}) {
  const j = props.junction;
  const legName = (roadId: string, fallback?: string) => (props.nameOf ? props.nameOf(roadId, fallback) : fallback);
  const names = junctionRoadNames(j, props.nameOf);
  const title = names.length ? names.join(' & ') : 'Intersection';

  return (
    <Box style={{ gap: 7, width: 184, padding: 9, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1320f2' }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <RailLabel text="INTERSECTION" />
        <Box style={{ flexGrow: 1 }} />
        <Pressable onPress={props.onClose} style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={10} color="#94a3b8" style={{ fontWeight: 800 }}>×</Text>
        </Pressable>
      </Box>
      <Text fontSize={11} color="#f8fafc" style={{ fontWeight: 700 }}>{title}</Text>
      <Text fontSize={8} color="#64748b">{`${j.legs.length} arm${j.legs.length === 1 ? '' : 's'}`}</Text>

      {/* the arms: compass side + the road that meets it (names the signage) */}
      <Box style={{ gap: 2 }}>
        {j.legs.map((leg) => (
          <Box key={leg.side} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Box style={{ width: 16, alignItems: 'center', borderRadius: 3, backgroundColor: '#162133' }}>
              <Text fontSize={8} color="#7dd3fc" style={{ fontWeight: 800 }}>{SIDE_LABEL[leg.side] ?? leg.side}</Text>
            </Box>
            <Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{legName(leg.roadId, leg.roadName)?.trim() || '(unnamed road)'}</Text>
          </Box>
        ))}
      </Box>

      <RailLabel text="CONTROL" />
      <Box style={{ gap: 4 }}>
        {TYPES.map((t) => {
          const active = props.control === t;
          const tint = t === 'signals' ? '#22c55e' : t === 'allWayStop' ? '#ef4444' : '#94a3b8';
          return (
            <Pressable
              key={t}
              onPress={() => props.onControl(t)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, borderRadius: 4, borderWidth: 1, borderColor: active ? tint : '#27364a', backgroundColor: active ? `${tint}22` : '#0f1a2e' }}
            >
              <Box style={{ width: 9, height: 9, borderRadius: 99, borderWidth: 2, borderColor: tint, backgroundColor: active ? tint : 'transparent' }} />
              <Text fontSize={10} color={active ? '#f8fafc' : '#94a3b8'} style={{ fontWeight: active ? 700 : 400 }}>{INTERSECTION_CONTROL_LABEL[t]}</Text>
            </Pressable>
          );
        })}
      </Box>
      <Text fontSize={7} color="#64748b">signs auto-place at the corners · drag any to nudge</Text>
    </Box>
  );
}
