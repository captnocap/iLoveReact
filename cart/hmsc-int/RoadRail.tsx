// RoadRail — the left rail for the ROAD layer (ROADSTROKE-0610).
//
// Roads are authored as STROKES (roadData.ts): the brush tool lays centerline
// points on the canvas, this rail picks the cross-section profile — lanes per
// side (a side at 0 = one-way; direction chevrons render on the canvas), the
// locked 2-tile sidewalk ring — and commits/cancels the draft. The pointer
// tool selects a committed road; the list shows every stroke with its profile
// chip and a delete. Re-stamping (the tile compile) lives in PaintCanvas; this
// rail is pure controls.

import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { MiniStepper, RailLabel, ToolBtn } from './railAtoms';
import { clampProfile, isOneWay, profileLabel, roadWidthTiles, type RoadProfile, type RoadStroke } from './roadData';
import type { Tool } from './PaintCanvas';

export function RoadRail(props: {
  tool: Tool;
  onTool: (t: Tool) => void;
  profile: RoadProfile;
  onProfile: (patch: Partial<RoadProfile>) => void;
  draftCount: number;
  onFinish: () => void;
  onCancel: () => void;
  onUndoPoint: () => void;
  roads: RoadStroke[];
  selId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  /** the wire view: dotted centerlines + per-lane wires + endpoint squares */
  wires: boolean;
  onWires: (on: boolean) => void;
}) {
  const p = clampProfile(props.profile);
  const drawing = props.tool !== 'pointer';
  const drafting = props.draftCount > 0;

  return (
    <Box style={{ flexGrow: 1, gap: 8 }}>
      <Box style={{ flexDirection: 'row', gap: 4 }}>
        <ToolBtn icon="MousePointer" active={!drawing} onPress={() => props.onTool('pointer')} />
        <ToolBtn icon="Brush" active={drawing} onPress={() => props.onTool('brush')} />
      </Box>

      <RailLabel text="PROFILE" />
      <MiniStepper
        label="lanes → (with draw)"
        value={String(p.lanesF)}
        onDec={() => props.onProfile({ lanesF: Math.max(0, p.lanesF - 1) })}
        onInc={() => props.onProfile({ lanesF: Math.min(3, p.lanesF + 1) })}
      />
      <MiniStepper
        label="lanes ← (opposing)"
        value={String(p.lanesB)}
        onDec={() => props.onProfile({ lanesB: Math.max(0, p.lanesB - 1) })}
        onInc={() => props.onProfile({ lanesB: Math.min(3, p.lanesB + 1) })}
      />
      <Pressable
        onPress={() => props.onProfile({ sidewalks: !p.sidewalks })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: p.sidewalks ? '#86efac' : '#334155', backgroundColor: '#0f1a2e' }}
      >
        <Box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.sidewalks ? '#86efac' : '#334155' }} />
        <Text fontSize={9} color={p.sidewalks ? '#e2e8f0' : '#64748b'}>sidewalks (2-tile ring)</Text>
      </Pressable>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text fontSize={9} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{profileLabel(p)}</Text>
        {isOneWay(p) ? <Text fontSize={8} color="#f59e0b" style={{ fontWeight: 700 }}>ONE-WAY</Text> : null}
      </Box>
      <Text fontSize={7} color="#64748b" style={{ fontFamily: 'monospace' }}>
        {`a lane is 3 tiles · total ${roadWidthTiles(p)} tiles wide`}
      </Text>

      <Pressable
        onPress={() => props.onWires(!props.wires)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: props.wires ? '#22d3ee' : '#334155', backgroundColor: '#0f1a2e' }}
      >
        <Box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: props.wires ? '#22d3ee' : '#334155' }} />
        <Text fontSize={9} color={props.wires ? '#e2e8f0' : '#64748b'}>wires (centerline + lanes)</Text>
      </Pressable>
      {props.wires ? (
        <Text fontSize={7} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {'cyan □ = connect point (clicks snap)\ngreen wire = with draw · red = opposing'}
        </Text>
      ) : null}

      {drawing ? (
        <Box style={{ gap: 4 }}>
          <RailLabel text="DRAW" />
          <Text fontSize={8} color="#94a3b8">
            {drafting ? `${props.draftCount} point${props.draftCount === 1 ? '' : 's'} — click to extend` : 'click the canvas to start a centerline'}
          </Text>
          {drafting ? (
            <Box style={{ gap: 4 }}>
              <Pressable
                onPress={props.draftCount >= 2 ? props.onFinish : undefined}
                style={{ alignItems: 'center', paddingTop: 5, paddingBottom: 5, borderRadius: 4, borderWidth: 1, borderColor: props.draftCount >= 2 ? '#86efac' : '#334155', backgroundColor: props.draftCount >= 2 ? '#12331f' : '#0f1a2e' }}
              >
                <Text fontSize={10} color={props.draftCount >= 2 ? '#86efac' : '#475569'} style={{ fontWeight: 700 }}>STAMP ROAD (Enter)</Text>
              </Pressable>
              <Box style={{ flexDirection: 'row', gap: 4 }}>
                <Pressable onPress={props.onUndoPoint} style={{ flexGrow: 1, alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
                  <Text fontSize={9} color="#94a3b8">undo point</Text>
                </Pressable>
                <Pressable onPress={props.onCancel} style={{ flexGrow: 1, alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#1f0f12' }}>
                  <Text fontSize={9} color="#fca5a5">cancel (Esc)</Text>
                </Pressable>
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : null}

      <RailLabel text={`ROADS (${props.roads.length})`} />
      <ScrollView style={{ flexGrow: 1 }}>
        <Box style={{ gap: 3 }}>
          {props.roads.length === 0 ? (
            <Text fontSize={8} color="#475569">none yet — pick the brush and click a centerline</Text>
          ) : null}
          {props.roads.map((r, i) => {
            const sel = r.id === props.selId;
            return (
              <Pressable
                key={r.id}
                onPress={() => props.onSelect(sel ? null : r.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 6, paddingRight: 4, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: sel ? '#f8fafc' : '#27364a', backgroundColor: sel ? '#1e293b' : '#0f1a2e' }}
              >
                <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isOneWay(r.profile) ? '#f59e0b' : '#fbbf24' }} />
                <Text fontSize={9} color={sel ? '#f8fafc' : '#cbd5e1'} style={{ fontFamily: 'monospace' }}>{`Road ${i + 1}`}</Text>
                <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{profileLabel(r.profile)}</Text>
                <Box style={{ flexGrow: 1 }} />
                <Pressable onPress={() => props.onDelete(r.id)} style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#7f1d1d', backgroundColor: '#1f0f12' }}>
                  <Text fontSize={10} color="#fca5a5" style={{ fontWeight: 800 }}>×</Text>
                </Pressable>
              </Pressable>
            );
          })}
        </Box>
      </ScrollView>
    </Box>
  );
}
