// RoadRail — the road card of the painter rail (ROADSTROKE-0610, PAINTER-0610).
//
// Roads are authored as STROKES (roadData.ts): the Paint tool lays centerline
// points on the canvas, this card picks the cross-section profile — lanes per
// side (a side at 0 = one-way; direction chevrons render on the canvas), the
// locked 2-tile sidewalk ring — and commits/cancels the draft. The Select tool
// picks a committed road; the list shows every stroke with its profile chip and
// a delete. Tools live in the universal ToolCard (PainterRail); re-stamping
// (the tile compile) lives in PaintCanvas; this card is pure controls.

import { Box, Pressable, ScrollView, Text } from '@reactjit/primitives';
import { MiniStepper, RailLabel } from './railAtoms';
import { clampProfile, isOneWay, profileLabel, ROAD_SPEED_PRESETS, roadWidthTiles, type RoadProfile, type RoadStroke } from './roadData';
import type { Tool } from './PaintCanvas';

export function RoadRail(props: {
  tool: Tool;
  profile: RoadProfile;
  onProfile: (patch: Partial<RoadProfile>) => void;
  /** non-null = the steppers are LIVE-editing this selected road, not the draft */
  editingLabel: string | null;
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
  /** per-lane flow arrows (FLOWARROWS-0610): glyphs pointing actual travel */
  arrows: boolean;
  onArrows: (on: boolean) => void;
}) {
  const p = clampProfile(props.profile);
  const drawing = props.tool === 'brush'; // eraser clicks delete strokes, they don't draft
  const drafting = props.draftCount > 0;

  return (
    <Box style={{ flexGrow: 1, gap: 8 }}>
      <RailLabel text="PROFILE" />
      {props.editingLabel ? (
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#f8fafc', backgroundColor: '#1e293b' }}>
          <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#f59e0b' }} />
          <Text fontSize={8} color="#f8fafc" style={{ fontWeight: 700 }}>{`editing ${props.editingLabel} (live)`}</Text>
        </Box>
      ) : null}
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
      {/* speed limit (ROADSPEED-0610): preset chips + a fine stepper. The
          STROKE carries it (tiles are shared kinds) — selecting a road
          live-edits that road, like the lane steppers. */}
      <Box style={{ flexDirection: 'row', gap: 4 }}>
        {(Object.entries(ROAD_SPEED_PRESETS) as Array<[string, number]>).map(([name, kph]) => {
          const active = p.speedLimitKph === kph;
          return (
            <Pressable
              key={name}
              onPress={() => props.onProfile({ speedLimitKph: kph })}
              style={{ flexGrow: 1, alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: active ? '#facc15' : '#334155', backgroundColor: active ? '#2b2410' : '#0f1a2e' }}
            >
              <Text fontSize={9} color={active ? '#facc15' : '#94a3b8'}>{`${name} ${kph}`}</Text>
            </Pressable>
          );
        })}
      </Box>
      <MiniStepper
        label="speed limit (km/h)"
        value={String(p.speedLimitKph ?? '')}
        onDec={() => props.onProfile({ speedLimitKph: (p.speedLimitKph ?? 50) - 5 })}
        onInc={() => props.onProfile({ speedLimitKph: (p.speedLimitKph ?? 50) + 5 })}
      />
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
          {'cyan □ = connect point (clicks snap)\ngreen wire = east/south flow · red = west/north'}
        </Text>
      ) : null}
      <Pressable
        onPress={() => props.onArrows(!props.arrows)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6, borderRadius: 4, borderWidth: 1, borderColor: props.arrows ? '#86efac' : '#334155', backgroundColor: '#0f1a2e' }}
      >
        <Box style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: props.arrows ? '#86efac' : '#334155' }} />
        <Text fontSize={9} color={props.arrows ? '#e2e8f0' : '#64748b'}>flow arrows (per lane)</Text>
      </Pressable>

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
