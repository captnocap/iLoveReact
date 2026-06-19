// editors/model/studio/dialogs/CreateTextureDialog.tsx — lifted verbatim from editors/model/Studio.tsx (req_1390). No behavior change.
import { useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput } from '@reactjit/primitives';
import { T } from '../config';
import { Z } from '../chrome/zlayers';
import { DEFAULT_TEXTURE_OPTIONS, PIXEL_DENSITIES, type TextureOptions, type TextureType } from '../../textureize';


// ── Create Texture dialog (req_1068) ──────────────────────────────────────────
// Blockbench's "Create Texture" popup, faithfully: Name · Type · Pixel Density ·
// Color · Rearrange UV · Power-of-2 Size · Keep Multi Texture Occupancy · Combine
// Islands · Edge/Island Angle Threshold · Padding. The questions ARE the pack
// parameters (textureize.ts); Confirm packs the whole scene into one sprite-map
// atlas. The fully-wired options today: Pixel Density, Rearrange UV, Power-of-2,
// Padding; the island-merge ones (Combine + the thresholds) + Keep-Multi are
// surfaced for parity and carried through (their effect is the Phase-2 merge step).

const TEXTURE_TYPES: { type: TextureType; label: string }[] = [
  { type: 'template', label: 'Texture Template' }, { type: 'solid', label: 'Solid Color' }, { type: 'blank', label: 'Blank' },
];

function TexCheck(props: { label: string; value: boolean; onChange: (v: boolean) => void; dim?: boolean }) {
  return (
    <Row style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
      <Text fontSize={11} color={props.dim ? T.dim : T.ink} style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Pressable onPress={() => props.onChange(!props.value)} style={{ width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: props.value ? '#1c3a2a' : '#13233aee', borderWidth: 1, borderColor: props.value ? '#2f7a4f' : '#2c4a6a' }}>
        {props.value ? <Text fontSize={12} color="#7fd6a0">✓</Text> : null}
      </Pressable>
    </Row>
  );
}

export function CreateTextureDialog(props: { onCancel: () => void; onConfirm: (o: TextureOptions) => void }) {
  const [o, setO] = useState<TextureOptions>(DEFAULT_TEXTURE_OPTIONS);
  const set = (p: Partial<TextureOptions>) => setO((prev) => ({ ...prev, ...p }));
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa', zIndex: Z.modal }}>
      <Col style={{ width: 420, gap: 9, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Create Texture</Text>

        <LCField label="Name">
          <Box style={{ flexGrow: 1 }}>
            <TextInput value={o.name} onChangeText={(t: string) => set({ name: t })} style={{ height: 24, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
          </Box>
        </LCField>

        <LCField label="Type">
          <Row style={{ gap: 5, flexWrap: 'wrap' }}>
            {TEXTURE_TYPES.map((tt) => {
              const on = o.type === tt.type;
              return <Pressable key={tt.type} onPress={() => set({ type: tt.type })} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{tt.label}</Text></Pressable>;
            })}
          </Row>
        </LCField>

        <LCField label="Pixel Density">
          <Row style={{ gap: 5 }}>
            {PIXEL_DENSITIES.map((d) => {
              const on = o.density === d;
              return <Pressable key={d} onPress={() => set({ density: d })} style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 6, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: on ? '#5b8fd6' : '#2c4a6a' }}><Text fontSize={10} color={on ? '#cfe2ff' : T.dim} style={{ fontFamily: 'monospace' }}>{`${d}x`}</Text></Pressable>;
            })}
          </Row>
        </LCField>

        {/* Color — only for the Solid Color type (dim otherwise, like Blockbench). */}
        <LCField label="Color">
          <Row style={{ gap: 6, alignItems: 'center' }}>
            <Box style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: o.color, borderWidth: 1, borderColor: '#2c4a6a', opacity: o.type === 'solid' ? 1 : 0.4 }} />
            <Box style={{ width: 92 }}>
              <TextInput value={o.color} onChangeText={(t: string) => set({ color: t })} style={{ height: 22, fontSize: 11, color: o.type === 'solid' ? T.ink : T.dim, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 6, fontFamily: 'monospace' }} />
            </Box>
          </Row>
        </LCField>

        <Box style={{ height: 1, backgroundColor: '#22344c', marginTop: 2, marginBottom: 2 }} />

        <TexCheck label="Rearrange UV" value={o.rearrangeUV} onChange={(v) => set({ rearrangeUV: v })} />
        <TexCheck label="Power-of-2 Size" value={o.powerOfTwo} onChange={(v) => set({ powerOfTwo: v })} />
        <TexCheck label="Keep Multi Texture Occupancy" value={o.keepOccupancy} onChange={(v) => set({ keepOccupancy: v })} />
        <TexCheck label="Combine Islands" value={o.combineIslands} onChange={(v) => set({ combineIslands: v })} />
        <LCField label="Edge Angle">
          <LCStepper value={o.edgeAngle} onChange={(n) => set({ edgeAngle: n })} min={0} max={180} step={1} />
        </LCField>
        <LCField label="Island Angle">
          <LCStepper value={o.islandAngle} onChange={(n) => set({ islandAngle: n })} min={0} max={180} step={1} />
        </LCField>
        <TexCheck label="Padding" value={o.padding} onChange={(v) => set({ padding: v })} />
        <TexCheck label="Dedupe Islands (shared)" value={o.dedupIslands} onChange={(v) => set({ dedupIslands: v })} />

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' }}><Text fontSize={11} color={T.dim}>Cancel</Text></Pressable>
          <Pressable onPress={() => props.onConfirm(o)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#1c3a2a', borderWidth: 1, borderColor: '#2f7a4f' }}><Text fontSize={11} color="#7fd6a0" style={{ fontWeight: '800' }}>Confirm</Text></Pressable>
        </Row>
      </Col>
    </Box>
  );
}
