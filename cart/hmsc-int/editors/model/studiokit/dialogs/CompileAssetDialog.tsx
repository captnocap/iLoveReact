// editors/model/studio/dialogs/CompileAssetDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import type { PropDescriptorInput } from '../../cookedAsset';
import { LCField, LCStepper } from './dialogControls';


// ── Compile Asset dialog (req_1122, Part 7 — the asset compiler) ──────────────
// Turn a Studio model into a typed game asset. The FIRST question is the KIND (the
// asset's MEANING — the user's "first menu asks what the shape is becoming"); the
// kind drives a kind-specific descriptor. Prop is live; the other kinds land in
// Phase 7b–7d. The cook MEASURES footprint/height from the mesh (derive, don't
// store twice), so the descriptor here is only the gameplay meaning.

const COMPILE_KINDS: { kind: 'prop' | 'item' | 'vehiclePart' | 'clothing'; label: string; ready: boolean }[] = [
  { kind: 'prop', label: 'Prop', ready: true },
  { kind: 'item', label: 'Item', ready: false },
  { kind: 'vehiclePart', label: 'Vehicle part', ready: false },
  { kind: 'clothing', label: 'Clothing', ready: false },
];

// A prop's NATURE — the three real shapes in the prop stack (game/kinds/props.ts):
//   • static  = a fixed obstacle: solid, points at the 'wall' donor (blocks sight,
//               gives cover).
//   • foliage = walk-through scenery: non-solid, points at 'bush' (conceals).
//   • physics = a KICKABLE dynamic body (a barrel/can/ball — the KICKPROP system):
//               solid, carries `dynamics` (a sphere body + bounce); the player
//               kicks it around. The body radius is MEASURED at cook time.
// This maps the user's mental model (static / hollow / physics) onto the table's
// granular fields, instead of asking about solid + tileKind separately.
type PropNature = 'static' | 'foliage' | 'physics';
const COMPILE_NATURES: { nature: PropNature; label: string; hint: string }[] = [
  { nature: 'static', label: 'Static', hint: 'fixed — blocks movement & sight, gives cover' },
  { nature: 'foliage', label: 'Foliage', hint: 'walk-through — conceals you (a bush)' },
  { nature: 'physics', label: 'Physics', hint: 'kickable body — you knock it around (a barrel/can/ball)' },
];

// THE PIECE TYPE (req_1684/1698): what build piece this cooked model PRESENTS as.
// 'Prop' is free scenery; the others tag a `pieceKind` so the model lists UNDER that
// family in a placed piece's "swap it out" pick (catalogPickOptions) — so you can
// replace a placed Wall with your custom wall — and carry that family's snap + cover.
// The asset stays kind:'prop' (the uniform mesh substrate); this is its presentation.
type PiecePlacement = 'free' | 'wall' | 'door' | 'railing' | 'fence' | 'floor' | 'stairs' | 'trim';
const COMPILE_PLACEMENTS: { placement: PiecePlacement; label: string; hint: string; build?: PropDescriptorInput['buildPlacement'] }[] = [
  { placement: 'free', label: 'Prop', hint: 'free scenery — place anywhere' },
  { placement: 'wall', label: 'Wall', hint: 'lists under walls — swap a placed wall to this · full cover, blocks sight', build: { pieceKind: 'wall', snap: 'edge', cover: 'full', blocksSight: true } },
  { placement: 'door', label: 'Door', hint: 'a functional two-state door — the "Door Leaf" part opens/closes (E); connects rooms · lists under walls', build: { pieceKind: 'wall', snap: 'edge', cover: 'full', blocksSight: true, portal: true } },
  { placement: 'railing', label: 'Railing', hint: 'edge-snaps onto stairs/balcony · low cover', build: { pieceKind: 'railing', snap: 'edge', cover: 'low', blocksSight: false } },
  { placement: 'fence', label: 'Fence', hint: 'edge-snaps · low cover', build: { pieceKind: 'fence', snap: 'edge', cover: 'low', blocksSight: false } },
  { placement: 'floor', label: 'Floor', hint: 'lists under floors — swap a placed floor to this', build: { pieceKind: 'floor', snap: 'grid', cover: 'none', blocksSight: false } },
  { placement: 'stairs', label: 'Stairs', hint: 'lists under stairs — swap a placed staircase to this', build: { pieceKind: 'stairs', snap: 'grid', cover: 'none', blocksSight: false } },
  { placement: 'trim', label: 'Trim', hint: 'sticks onto a face (posters, moldings)', build: { pieceKind: 'trim', snap: 'surface', cover: 'none', blocksSight: false } },
];

/** Map a nature + bounce + placement → the granular PropDescriptorInput the cook fills.
 *  A DOOR (req_1864) is always a static wall carrying a `door` request — the cook turns
 *  its "Door Leaf" part into a toggleable two-state panel — so it ignores the nature pick. */
function natureToDescriptor(nature: PropNature, label: string, bounce: number, placement?: PropDescriptorInput['buildPlacement'], door?: { vehicle: boolean }): PropDescriptorInput {
  const place = placement ? { buildPlacement: placement } : {};
  if (door) return { label, solid: true, tileKind: 'wall', ...place, door };
  if (nature === 'foliage') return { label, solid: false, tileKind: 'bush', ...place };
  if (nature === 'physics') return { label, solid: true, tileKind: 'wall', physics: { restitution: bounce }, ...place };
  return { label, solid: true, tileKind: 'wall', ...place };
}

export function CompileAssetDialog(props: { sceneName: string | null; onCancel: () => void; onCook: (d: PropDescriptorInput) => void }) {
  const [kind, setKind] = useState<'prop' | 'item' | 'vehiclePart' | 'clothing'>('prop');
  const [label, setLabel] = useState(props.sceneName || 'Asset');
  const [nature, setNature] = useState<PropNature>('static');
  // bounce (restitution) for a physics body — drum/can ~0.18, a ball ~0.65.
  const [bounce, setBounce] = useState(0.3);
  // how the cooked piece SNAPS when placed (req_1684) — free scenery vs railing/wall/trim.
  const [placement, setPlacement] = useState<PiecePlacement>('free');
  // a DOOR (req_1864) is a walk portal by default, or a vehicle-sized garage portal.
  const [doorVehicle, setDoorVehicle] = useState(false);
  const ready = COMPILE_KINDS.find((k) => k.kind === kind)?.ready ?? false;
  const natureHint = COMPILE_NATURES.find((n) => n.nature === nature)?.hint ?? '';
  const placeDef = COMPILE_PLACEMENTS.find((p) => p.placement === placement) ?? COMPILE_PLACEMENTS[0];
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 440, gap: 9, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#8a6f3a' }}>
        <Text fontSize={13} color="#e9c77f" style={{ fontWeight: '800' }}>⚙ Compile Asset</Text>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>{`from "${props.sceneName || 'untitled'}" — geometry + footprint are measured from the mesh`}</Text>

        {/* The KIND — the asset's meaning, asked first. */}
        <LCField label="Kind">
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {COMPILE_KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f16' : '#13233aee', borderWidth: 1, borderColor: on ? '#c79a3a' : '#2c4a6a', opacity: k.ready ? 1 : 0.55 }}>
                  <Text fontSize={10} color={on ? '#e9c77f' : T.dim} style={{ fontFamily: 'monospace' }}>{k.ready ? k.label : `${k.label} (soon)`}</Text>
                </Pressable>
              );
            })}
          </Row>
        </LCField>

        {ready ? (
          <>
            <LCField label="Label">
              <Box style={{ flexGrow: 1 }}>
                <TextInput value={label} onChangeText={setLabel} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
              </Box>
            </LCField>
            <LCField label="Nature">
              <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                {COMPILE_NATURES.map((n) => {
                  const on = nature === n.nature;
                  return <Pressable key={n.nature} onPress={() => setNature(n.nature)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{n.label}</Text></Pressable>;
                })}
              </Row>
            </LCField>
            <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', marginTop: -3 }}>{natureHint}</Text>
            {/* Physics bodies author the BOUNCE; the body radius is MEASURED from the
                footprint at cook time (derive, don't store twice). */}
            {nature === 'physics' ? (
              <LCField label="Bounce">
                <LCStepper value={bounce} onChange={(n) => setBounce(Math.max(0, Math.min(1, Math.round(n * 100) / 100)))} min={0} max={1} step={0.05} />
              </LCField>
            ) : null}
            {/* PLACEMENT (req_1684): make the cooked model a real piece — a railing that
                edge-snaps onto stairs, a wall panel, a face decal — not just free scenery. */}
            <LCField label="Piece type">
              <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                {COMPILE_PLACEMENTS.map((p) => {
                  const on = placement === p.placement;
                  return <Pressable key={p.placement} onPress={() => setPlacement(p.placement)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#9b7fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#e2cfff' : T.dim} style={{ fontFamily: 'monospace' }}>{p.label}</Text></Pressable>;
                })}
              </Row>
            </LCField>
            <Text fontSize={9} color={T.dim} style={{ fontFamily: 'monospace', marginTop: -3 }}>{placeDef.hint}</Text>
            {/* DOOR (req_1864): walk vs vehicle (garage) portal — sets the opening size +
                interaction reach the cook records onto the door panel. */}
            {placement === 'door' ? (
              <LCField label="Door size">
                <Row style={{ gap: 5, flexWrap: 'wrap' }}>
                  {[{ vehicle: false, label: 'Walk' }, { vehicle: true, label: 'Vehicle (garage)' }].map((d) => {
                    const on = doorVehicle === d.vehicle;
                    return <Pressable key={d.label} onPress={() => setDoorVehicle(d.vehicle)} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#3a2f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#9b7fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#e2cfff' : T.dim} style={{ fontFamily: 'monospace' }}>{d.label}</Text></Pressable>;
                  })}
                </Row>
              </LCField>
            ) : null}
            {placement === 'door' ? (
              <Text fontSize={9} color="#c79a3a" style={{ fontFamily: 'monospace', marginTop: -3 }}>needs a part named "Door Leaf" (the seeded Door Wall makes one) — that part becomes the toggleable leaf.</Text>
            ) : null}
          </>
        ) : (
          <Text fontSize={11} color={T.dim} style={{ fontFamily: 'monospace', paddingTop: 6, paddingBottom: 6 }}>This kind's cook lands in a later slice. Prop is ready now.</Text>
        )}

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable
            onPress={() => { if (ready) props.onCook(natureToDescriptor(nature, label, bounce, placeDef.build, placement === 'door' ? { vehicle: doorVehicle } : undefined)); }}
            style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: ready ? '#3a2f16' : '#1a2436', borderWidth: 1, borderColor: ready ? '#c79a3a' : '#2c4a6a', opacity: ready ? 1 : 0.5 }}
          >
            <Text fontSize={11} color={ready ? '#e9c77f' : T.dim} style={{ fontWeight: '800' }}>Cook + Install</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
