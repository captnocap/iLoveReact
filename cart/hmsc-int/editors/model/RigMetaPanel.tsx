// editors/model/RigMetaPanel.tsx — the active LAYER's rig METADATA, in workspace
// column 3 under the UV unwrap (USER req_1053: "under the UV unwrapping is a
// perfect place to store the metadata of the layer… our layer component is not
// built for this extra data"). The OUTLINER (a reused paint LayerStrip) holds only
// name/visibility; a part also carries a PIVOT + named JOINTS (req_1025/req_1052),
// so the textual metadata lives HERE while the viewport gizmo does the spatial
// PLACEMENT. Names are the BINDING KEYS — `<lib>.<model>.pivot` and
// `<lib>.<model>.joint.<name>` (e.g. tires.offroad_left.pivot → trucks.tundra
// .joint.back_left). Reads + writes the SHARED studio store, so it never diverges
// from the column-4 viewport. See ../MESH_EDITOR_PLAYBOOK.md Part 6.

import { useEffect, useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { GAME_CHROME } from '../../game';
import { addMount, clearPivot, hasPivot, jointTravelDegrees, pivotOf, removeMount, renameMount, setPivot, updateMount, type EditMesh, type MountPoint, type V3 } from './editMesh';
import { useStudioModel } from './studioModel';
import { STUDIO } from './Studio';

const T = GAME_CHROME.tokens.color;
const AXIS_COLOR = ['#e0584e', '#5ec26a', '#4aa3ff'];

const BTN = { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' } as const;
const FIELD = { height: 22, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' } as const;

const u = (m: number) => (m * STUDIO.unitsPerTile).toFixed(1); // meters → modeling units
const fmtPos = (p: V3) => `${u(p[0])}, ${u(p[1])}, ${u(p[2])}`;

function dominantAxis(ax?: V3): 0 | 1 | 2 {
  const a = ax ?? [0, 1, 0];
  return Math.abs(a[0]) >= Math.abs(a[1]) && Math.abs(a[0]) >= Math.abs(a[2]) ? 0 : Math.abs(a[1]) >= Math.abs(a[2]) ? 1 : 2;
}

function Stepper(props: { value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const set = (n: number) => props.onChange(Math.max(props.min, Math.min(props.max, Math.round(n))));
  return (
    <Row style={{ gap: 4, alignItems: 'center' }}>
      <Pressable onPress={() => set(props.value - props.step)} style={BTN}><Text fontSize={12} color={T.text}>−</Text></Pressable>
      <Text fontSize={11} color={T.ink} style={{ width: 34, textAlign: 'center', fontFamily: 'monospace' }}>{props.value}°</Text>
      <Pressable onPress={() => set(props.value + props.step)} style={BTN}><Text fontSize={12} color={T.text}>+</Text></Pressable>
    </Row>
  );
}

// One joint row: name (the binding key, committed on blur/submit), type, axis, and
// rotation limit (the constraint the joint imposes on its child). Local name state
// so a key-changing rename only commits once, on blur — not per keystroke.
function JointRow(props: { mount: MountPoint; onRename: (next: string) => void; onPatch: (p: Partial<Omit<MountPoint, 'name'>>) => void; onRemove: () => void }) {
  const mt = props.mount;
  const [name, setName] = useState(mt.name);
  useEffect(() => { setName(mt.name); }, [mt.name]); // resync if it changed elsewhere (e.g. auto-suffix)
  const dom = dominantAxis(mt.axis);
  const full = !!mt.limit?.full;
  const min = mt.limit?.min ?? -90;
  const max = mt.limit?.max ?? 90;
  return (
    <Col style={{ gap: 6, padding: 8, borderRadius: 7, backgroundColor: '#0b1320cc', borderWidth: 1, borderColor: '#27364a' }}>
      <Row style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
        <Box style={{ flexGrow: 1 }}>
          <TextInput value={name} onChangeText={setName} onSubmitEditing={() => props.onRename(name)} onBlur={() => props.onRename(name)} style={FIELD} />
        </Box>
        <Pressable onPress={props.onRemove} style={BTN}><Text fontSize={10} color="#e0918a">✕</Text></Pressable>
      </Row>
      {/* No type field (req_1057): joints bind by their NAME, so 'generic' covers
          all the bases — the type vocabulary is a dormant, future-only concept. */}
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Text fontSize={10} color={T.dim} style={{ width: 30, fontFamily: 'monospace' }}>axis</Text>
        <Row style={{ gap: 4 }}>
          {(['X', 'Y', 'Z'] as const).map((lbl, i) => {
            const on = dom === i;
            return <Pressable key={lbl} onPress={() => props.onPatch({ axis: (i === 0 ? [1, 0, 0] : i === 1 ? [0, 1, 0] : [0, 0, 1]) as V3 })} style={{ ...BTN, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderColor: on ? AXIS_COLOR[i] : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{lbl}</Text></Pressable>;
          })}
        </Row>
      </Row>
      <Row style={{ gap: 6, alignItems: 'center' }}>
        <Text fontSize={10} color={T.dim} style={{ width: 30, fontFamily: 'monospace' }}>spin</Text>
        <Pressable onPress={() => props.onPatch({ limit: full ? { min, max } : { full: true } })} style={{ ...BTN, backgroundColor: full ? '#1c3a2a' : '#13233aee', borderColor: full ? '#2f7a4f' : '#2c4a6a' }}>
          <Text fontSize={10} color={full ? '#7fd6a0' : T.dim} style={{ fontFamily: 'monospace' }}>{full ? 'full ✓' : 'full'}</Text>
        </Pressable>
        {!full ? (
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Stepper value={min} min={-180} max={0} step={5} onChange={(n) => props.onPatch({ limit: { min: n, max } })} />
            <Stepper value={max} min={0} max={180} step={5} onChange={(n) => props.onPatch({ limit: { min, max: n } })} />
          </Row>
        ) : null}
      </Row>
      <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>
        {full ? 'spins free' : `${Math.max(0, max - min)}° travel`} · at {fmtPos(mt.position)} u
      </Text>
    </Col>
  );
}

export function StudioRigPanel() {
  const model = useStudioModel();
  const part = model.activePart;
  if (!part) {
    return (
      <Box style={{ padding: 12, borderRadius: 8, backgroundColor: '#0b1320aa', borderWidth: 1, borderColor: '#27364a' }}>
        <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace' }}>select a part to edit its pivot + joints</Text>
      </Box>
    );
  }
  const edit = (next: EditMesh) => model.updatePartMesh(part.id, next);
  const joints = part.mesh.mounts ?? [];
  const pivot = pivotOf(part.mesh);
  const usedNames = new Set(joints.map((j) => j.name));
  const nextJointName = () => { for (let i = 1; ; i += 1) { const n = `joint_${i}`; if (!usedNames.has(n)) return n; } };

  return (
    <Col style={{ gap: 8, width: '100%' }}>
      {/* PIVOT — OPT-IN (req_1054): only a part that ROTATES gets one; a car body is
          joints-only. Show the row + remove when present, else a "+ pivot" button. */}
      {hasPivot(part.mesh) ? (
        <Col style={{ gap: 3, padding: 8, borderRadius: 7, backgroundColor: '#1a120bcc', borderWidth: 1, borderColor: '#5a3a1f' }}>
          <Row style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
            <Row style={{ gap: 6, alignItems: 'center' }}>
              <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff8a3d' }} />
              <Text fontSize={11} color="#ffb37d" style={{ fontFamily: 'monospace', fontWeight: '800' }}>pivot</Text>
              <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>· .pivot</Text>
            </Row>
            <Pressable onPress={() => edit(clearPivot(part.mesh))} style={BTN}><Text fontSize={10} color="#e0918a">✕</Text></Pressable>
          </Row>
          <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>rotation origin · at {fmtPos(pivot)} u · place it with the gizmo</Text>
        </Col>
      ) : (
        <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>no pivot — this part doesn't rotate</Text>
          <Pressable onPress={() => edit(setPivot(part.mesh, [pivot[0], pivot[1], pivot[2]]))} style={{ ...BTN, borderColor: '#a8632c' }}><Text fontSize={10} color="#ffb37d" style={{ fontFamily: 'monospace' }}>+ pivot</Text></Pressable>
        </Row>
      )}

      {/* JOINTS — named attach points (sockets) the part offers to children. */}
      <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <Text fontSize={10} color={T.text} style={{ fontFamily: 'monospace', fontWeight: '800' }}>joints · {joints.length}</Text>
        <Pressable
          onPress={() => { const name = nextJointName(); edit(addMount(part.mesh, { name, kind: 'socket', position: [pivot[0], pivot[1], pivot[2]], axis: [0, 1, 0], limit: { min: -90, max: 90 } })); }}
          style={BTN}
        >
          <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>+ joint</Text>
        </Pressable>
      </Row>
      {joints.length === 0 ? (
        <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace' }}>no joints — add one, then drag it onto the model with the gizmo</Text>
      ) : (
        joints.map((mt) => (
          <JointRow
            key={mt.name}
            mount={mt}
            onRename={(next) => edit(renameMount(part.mesh, mt.name, next))}
            onPatch={(p) => edit(updateMount(part.mesh, mt.name, p))}
            onRemove={() => edit(removeMount(part.mesh, mt.name))}
          />
        ))
      )}
    </Col>
  );
}
