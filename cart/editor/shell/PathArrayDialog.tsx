import { useEffect, useState } from 'react';
import { Box, Col, Row, Text, TextInput, Pressable, ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import {
  PATH_ARRAY_TUNING,
  appendPathArrayPoint,
  arcPathArrayPoints,
  defaultPathArrayParams,
  sanitizePathArrayParams,
  type PathArrayAxis,
  type PathArrayParams,
  type PathArrayPoint,
} from '../data/pathArray';
import { U_PER_TILE } from '../data/hmscAssetCatalog';

const PANEL = '#17181b';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const ACCENT = '#6ea8fe';
const BTN_BG = '#1f2126';
const MONO = 'ui-monospace';

function SmallButton({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ minWidth: 42, height: 25, paddingLeft: 8, paddingRight: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: active ? '#24446d' : BTN_BG, borderWidth: 1, borderColor: active ? ACCENT : BORDER }}
    >
      <Text style={{ color: active ? '#eaf2ff' : TEXT, fontSize: 10, fontFamily: MONO, fontWeight: 700 }}>{label}</Text>
    </Pressable>
  );
}

function ValueRow({ label, value, suffix, coarse, fine, onChange }: {
  label: string;
  value: number;
  suffix: string;
  coarse: number;
  fine: number;
  onChange: (value: number) => void;
}) {
  const format = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return (
    <Row style={{ alignItems: 'center', gap: 5, minHeight: 28 }}>
      <Text style={{ width: 82, color: TEXT, fontSize: 11 }}>{label}</Text>
      <SmallButton label={`−${coarse}`} onPress={() => onChange(value - coarse)} />
      <SmallButton label="−" onPress={() => onChange(value - fine)} />
      <Box style={{ minWidth: 76, height: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: '#101216', borderWidth: 1, borderColor: BORDER }}>
        <Text style={{ color: ACCENT, fontSize: 11, fontFamily: MONO, fontWeight: 800 }}>{format}{suffix}</Text>
      </Box>
      <SmallButton label="+" onPress={() => onChange(value + fine)} />
      <SmallButton label={`+${coarse}`} onPress={() => onChange(value + coarse)} />
    </Row>
  );
}

function CoordinateInput({ axis, value, fixed = false, onChange }: { axis: 'X' | 'Y' | 'Z'; value: number; fixed?: boolean; onChange: (value: number) => void }) {
  const format = (number: number) => Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  const [draft, setDraft] = useState(format(value));
  useEffect(() => setDraft(format(value)), [value]);
  return (
    <Row style={{ alignItems: 'center', gap: 3 }}>
      <Text style={{ color: DIM, fontSize: 9, fontFamily: MONO }}>{axis}</Text>
      <TextInput
        value={fixed ? '0' : draft}
        onChange={(next: string) => {
          if (fixed) return;
          setDraft(next);
          const parsed = Number(next);
          if (next.trim() && Number.isFinite(parsed)) onChange(parsed);
        }}
        style={{ width: 58, height: 23, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderColor: fixed ? '#24272e' : BORDER, backgroundColor: fixed ? '#111318' : '#0d1015', color: fixed ? '#667080' : TEXT, fontSize: 10, fontFamily: MONO }}
      />
    </Row>
  );
}

const AXES: { axis: PathArrayAxis; label: string }[] = [
  { axis: 0, label: '+X' },
  { axis: 1, label: '−X' },
  { axis: 2, label: '+Z' },
  { axis: 3, label: '−Z' },
];

export default function PathArrayDialog({ sourceLabel, sourcePartCount, sourceSpanU, onCancel, onApply }: {
  sourceLabel: string;
  sourcePartCount: number;
  sourceSpanU: { xU: number; zU: number };
  onCancel: () => void;
  onApply: (params: PathArrayParams) => void;
}) {
  const [params, setParams] = useState<PathArrayParams>(defaultPathArrayParams);
  const [finalScale, setFinalScale] = useState(48);
  const patch = (next: Partial<PathArrayParams>) => setParams((current) => sanitizePathArrayParams({ ...current, ...next }));
  const generated = (params.bays - 1) * sourcePartCount;
  const sourceLengthU = Math.max(0.0001, params.axis < 2 ? sourceSpanU.xU : sourceSpanU.zU);
  const points = params.points;
  const finalRiseU = points?.[points.length - 1]?.yU ?? params.riseU;
  const setPoint = (index: number, next: Partial<PathArrayPoint>) => {
    if (!points || index === 0) return;
    patch({ points: points.map((point, pointIndex) => pointIndex === index ? { ...point, ...next } : point) });
  };
  const enterPointMode = () => patch({ points: arcPathArrayPoints(params, sourceLengthU) });
  const leavePointMode = () => setParams((current) => {
    const { points: _points, ...arc } = current;
    return sanitizePathArrayParams(arc);
  });

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.66)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 440, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="Route" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: 700 }}>Path Array</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>

        <Col style={{ gap: 3, padding: 9, borderRadius: 7, backgroundColor: '#101216', borderWidth: 1, borderColor: BORDER }}>
          <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{sourceLabel}</Text>
          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>
            Source stays as bay 1 · {params.bays - 1} generated bay{params.bays === 2 ? '' : 's'} · {generated} new editable part{generated === 1 ? '' : 's'}
          </Text>
        </Col>

        <Row style={{ alignItems: 'center', gap: 5, minHeight: 28 }}>
          <Text style={{ width: 82, color: TEXT, fontSize: 11 }}>Forward</Text>
          {AXES.map((item) => <SmallButton key={item.axis} label={item.label} active={params.axis === item.axis} onPress={() => patch({ axis: item.axis })} />)}
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>Y is up</Text>
        </Row>

        <Row style={{ alignItems: 'center', gap: 5, minHeight: 28 }}>
          <Text style={{ width: 82, color: TEXT, fontSize: 11 }}>Path</Text>
          <SmallButton label="Arc" active={!points} onPress={leavePointMode} />
          <SmallButton label="3D points" active={Boolean(points)} onPress={enterPointMode} />
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>source X {sourceSpanU.xU.toFixed(2)}u · Z {sourceSpanU.zU.toFixed(2)}u</Text>
        </Row>

        {!points ? (
          <>
            <ValueRow label="Bays" value={params.bays} suffix="" coarse={4} fine={1} onChange={(bays) => patch({ bays })} />
            <ValueRow label="Turn" value={params.turnDegrees} suffix="°" coarse={15} fine={PATH_ARRAY_TUNING.turnStepDegrees} onChange={(turnDegrees) => patch({ turnDegrees })} />
            <ValueRow label="Rise" value={params.riseU} suffix=" u" coarse={U_PER_TILE} fine={PATH_ARRAY_TUNING.riseStepU} onChange={(riseU) => patch({ riseU })} />

            <Row style={{ alignItems: 'center', gap: 5, minHeight: 28 }}>
              <Text style={{ width: 82, color: TEXT, fontSize: 11 }}>Grade</Text>
              <SmallButton label="Eased" active={params.profile === 'eased'} onPress={() => patch({ profile: 'eased' })} />
              <SmallButton label="Linear" active={params.profile === 'linear'} onPress={() => patch({ profile: 'linear' })} />
              <Box style={{ flexGrow: 1 }} />
              <Text style={{ color: DIM, fontSize: 10 }}>Eased joins level</Text>
            </Row>
          </>
        ) : (
          <Col style={{ gap: 6 }}>
            <Row style={{ alignItems: 'center' }}>
              <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>XYZ OFFSETS FROM SOURCE END · ONE ROW PER BAY BOUNDARY</Text>
              <Box style={{ flexGrow: 1 }} />
              <SmallButton label="from arc" onPress={enterPointMode} />
            </Row>
            <ScrollView style={{ height: Math.min(174, points.length * 29) }} contentContainerStyle={{ flexDirection: 'column' }}>
              {points.map((point, index) => (
                <Row key={index} style={{ height: 29, alignItems: 'center', gap: 6, paddingLeft: 5, paddingRight: 5, backgroundColor: index % 2 === 0 ? '#11141a' : '#0e1116', borderBottomWidth: 1, borderColor: '#20242c' }}>
                  <Text style={{ width: 24, color: index === 0 ? ACCENT : DIM, fontSize: 10, fontFamily: MONO, fontWeight: 800 }}>P{index}</Text>
                  <CoordinateInput axis="X" value={point.xU} fixed={index === 0} onChange={(xU) => setPoint(index, { xU })} />
                  <CoordinateInput axis="Y" value={point.yU} fixed={index === 0} onChange={(yU) => setPoint(index, { yU })} />
                  <CoordinateInput axis="Z" value={point.zU} fixed={index === 0} onChange={(zU) => setPoint(index, { zU })} />
                  <Box style={{ flexGrow: 1 }} />
                  {index > 0 && points.length > 2 ? (
                    <Pressable onPress={() => patch({ points: points.filter((_, pointIndex) => pointIndex !== index) })} style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }} tooltip="Remove this path boundary">
                      <Icon name="Trash2" size={11} color="#8b6464" />
                    </Pressable>
                  ) : null}
                </Row>
              ))}
            </ScrollView>
            <Row style={{ justifyContent: 'flex-end' }}>
              <SmallButton label="+ run" onPress={() => patch({ points: appendPathArrayPoint(points, params.axis, sourceLengthU) })} />
            </Row>
          </Col>
        )}

        <Row style={{ alignItems: 'center', gap: 5, minHeight: 28 }}>
          <Text style={{ width: 82, color: TEXT, fontSize: 11 }}>Final scale</Text>
          {[1, 16, 48].map((scale) => <SmallButton key={scale} label={`×${scale}`} active={finalScale === scale} onPress={() => setFinalScale(scale)} />)}
          <Box style={{ flexGrow: 1 }} />
        </Row>
        <Row style={{ justifyContent: 'flex-end' }}>
          <Text style={{ color: ACCENT, fontSize: 10, fontFamily: MONO, fontWeight: 800 }}>
            source X {((sourceSpanU.xU / U_PER_TILE) * finalScale).toFixed(2)} m · Z {((sourceSpanU.zU / U_PER_TILE) * finalScale).toFixed(2)} m · rise {((finalRiseU / U_PER_TILE) * finalScale).toFixed(2)} m
          </Text>
        </Row>

        <Text style={{ color: DIM, fontSize: 10, lineHeight: 15 }}>
          {points
            ? 'P0 is pinned to the source end. Each next XYZ coordinate is a shared ring in 3D authoring space; adjacent rows define one run, so you shape the bridge without selecting mesh edges.'
            : `Path dimensions stay in authoring space: ${U_PER_TILE} u = 1 model tile before final scaling. Positive turn bends right, negative bends left, and cross-rings stay upright.`} The × scale row is a world-size readout only; it does not enlarge the mesh or make the camera fight it.
        </Text>

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => onApply(sanitizePathArrayParams(params))} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, backgroundColor: ACCENT }}>
            <Text style={{ color: '#0d0e10', fontSize: 12, fontWeight: 800 }}>Build Path</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
