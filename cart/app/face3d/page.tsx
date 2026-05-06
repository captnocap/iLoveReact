// /face3d — fullscreen testbench for the BlockFace3D voxel-on-sphere
// experiment. Big avatar, side rail of knobs (face wrap, gap, thickness,
// camera distance, archetype, seed, frame) so we can scrutinize whether
// it hits or eats shit.

import { useState } from 'react';
import { Box, Col, Row, Pressable, Text, TextInput } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Avatar } from '@reactjit/runtime/avatar';
import { DEFAULT_AVATAR } from '../character/catalog';
import { BlockFace3D } from '../gallery/components/block-faces/BlockFace3D';
import {
  blockFacesArchetypes,
  type ArchetypeKey,
} from '../gallery/components/block-faces/BlockFaces';

const FRAMES = ['idle', 'blink', 'talk', 'smile'];
const BACKDROPS = ['#0a0e18', '#1a1f2e', '#2a3347', '#3a4d5c', '#5a3a3a', '#000000', '#ffffff'];

function ChipRow<T extends string>({
  options,
  value,
  onPick,
}: {
  options: readonly T[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <Row style={{ gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const Tile = o === value ? S.AppTraitChipActive : S.AppTraitChip;
        const Lbl = o === value ? S.AppTraitChipTextActive : S.AppTraitChipText;
        return (
          <Tile key={o} onPress={() => onPick(o)}>
            <Lbl>{o}</Lbl>
          </Tile>
        );
      })}
    </Row>
  );
}

function NumKnob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  fmt?: (n: number) => string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const fmtFn = fmt ?? ((n: number) => n.toFixed(2));
  return (
    <Col style={{ gap: 4 }}>
      <Row style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <S.Label>{label}</S.Label>
        <S.Caption>{fmtFn(value)}</S.Caption>
      </Row>
      <Row style={{ gap: 4 }}>
        <S.ButtonOutline onPress={() => onChange(clamp(value - step))}>
          <S.ButtonOutlineLabel>-</S.ButtonOutlineLabel>
        </S.ButtonOutline>
        <S.ButtonOutline onPress={() => onChange(clamp(value - step * 5))}>
          <S.ButtonOutlineLabel>--</S.ButtonOutlineLabel>
        </S.ButtonOutline>
        <Box style={{ flexGrow: 1 }} />
        <S.ButtonOutline onPress={() => onChange(clamp(value + step * 5))}>
          <S.ButtonOutlineLabel>++</S.ButtonOutlineLabel>
        </S.ButtonOutline>
        <S.ButtonOutline onPress={() => onChange(clamp(value + step))}>
          <S.ButtonOutlineLabel>+</S.ButtonOutlineLabel>
        </S.ButtonOutline>
      </Row>
    </Col>
  );
}

export default function Face3DPage() {
  const [archetype, setArchetype] = useState<ArchetypeKey>(blockFacesArchetypes[0]);
  const [seed, setSeed] = useState('moonshot-1');
  const [frame, setFrame] = useState<string>('idle');
  const [yawHalf, setYawHalf] = useState(55);
  const [pitchHalf, setPitchHalf] = useState(50);
  const [gap, setGap] = useState(0.05);
  const [thickness, setThickness] = useState(0.04);
  const [radius, setRadius] = useState(0.35);
  const [camDist, setCamDist] = useState(2.4);
  const [camY, setCamY] = useState(1.55);
  const [targetY, setTargetY] = useState(1.55);
  const [backdrop, setBackdrop] = useState(BACKDROPS[0]);
  // Default: head sphere hidden so the textured sphere is the visible
  // surface. There's a depth-occlusion edge case when both spheres share
  // a center — toggling hide makes the face show cleanly while we sort
  // it out properly.
  const [showHead, setShowHead] = useState(false);

  // Optionally hide the head sphere so the voxel face IS the face.
  const avatarData = showHead
    ? DEFAULT_AVATAR
    : {
        ...DEFAULT_AVATAR,
        parts: DEFAULT_AVATAR.parts.map((p) =>
          p.kind === 'head' ? { ...p, visible: false } : p
        ),
      };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg' }}>
      <Row style={{ width: '100%', height: '100%', alignItems: 'stretch' }}>
        {/* Stage */}
        <Box style={{ flexGrow: 1, flexBasis: 0, height: '100%', position: 'relative' }}>
          <Avatar
            avatar={avatarData}
            style={{ width: '100%', height: '100%' }}
            backgroundColor={backdrop}
            cameraPosition={[0, camY, camDist]}
            cameraTarget={[0, targetY, 0]}
            cameraFov={48}
          >
            <BlockFace3D
              center={[0, 1.55, 0]}
              radius={radius}
              archetype={archetype}
              seed={seed || undefined}
              frame={frame}
              yawHalfDeg={yawHalf}
              pitchHalfDeg={pitchHalf}
              gap={gap}
              thickness={thickness}
            />
          </Avatar>
          <Box style={{
            position: 'absolute', left: 16, top: 16,
            paddingTop: 4, paddingBottom: 4, paddingLeft: 8, paddingRight: 8,
            backgroundColor: 'theme:bg', borderWidth: 1, borderColor: 'theme:rule',
          }}>
            <S.Label style={{ color: 'theme:accentHot' }}>FACE3D · MOONSHOT BENCH</S.Label>
          </Box>
        </Box>

        {/* Control rail */}
        <Box style={{
          width: 320, height: '100%',
          paddingTop: 18, paddingBottom: 18, paddingLeft: 14, paddingRight: 14,
          gap: 14, borderLeftWidth: 1, borderColor: 'theme:rule',
          backgroundColor: 'theme:bg2',
          overflow: 'hidden',
        }}>
          <Col style={{ gap: 14 }}>
            <Col style={{ gap: 4 }}>
              <S.Label>Archetype</S.Label>
              <ChipRow options={blockFacesArchetypes} value={archetype} onPick={setArchetype} />
            </Col>

            <Col style={{ gap: 4 }}>
              <S.Label>Seed</S.Label>
              <S.AppFormInput
                value={seed}
                placeholder="any string"
                onChangeText={(t: string) => setSeed(t)}
              />
            </Col>

            <Col style={{ gap: 4 }}>
              <S.Label>Frame</S.Label>
              <ChipRow options={FRAMES} value={frame} onPick={setFrame} />
            </Col>

            <NumKnob
              label="Yaw half (°)"
              value={yawHalf}
              min={5}
              max={90}
              step={1}
              onChange={setYawHalf}
              fmt={(n) => n.toFixed(0)}
            />
            <NumKnob
              label="Pitch half (°)"
              value={pitchHalf}
              min={5}
              max={90}
              step={1}
              onChange={setPitchHalf}
              fmt={(n) => n.toFixed(0)}
            />
            <NumKnob
              label="Gap"
              value={gap}
              min={0}
              max={0.5}
              step={0.01}
              onChange={setGap}
            />
            <NumKnob
              label="Thickness"
              value={thickness}
              min={0.005}
              max={0.2}
              step={0.005}
              onChange={setThickness}
              fmt={(n) => n.toFixed(3)}
            />
            <NumKnob
              label="Radius"
              value={radius}
              min={0.1}
              max={0.8}
              step={0.01}
              onChange={setRadius}
            />
            <NumKnob
              label="Camera dist"
              value={camDist}
              min={0.8}
              max={8}
              step={0.1}
              onChange={setCamDist}
              fmt={(n) => n.toFixed(1)}
            />
            <NumKnob
              label="Camera Y"
              value={camY}
              min={0}
              max={3}
              step={0.05}
              onChange={setCamY}
            />
            <NumKnob
              label="Target Y"
              value={targetY}
              min={0}
              max={3}
              step={0.05}
              onChange={setTargetY}
            />

            <Col style={{ gap: 4 }}>
              <S.Label>Head sphere</S.Label>
              <Row style={{ gap: 4 }}>
                {[true, false].map((v) => {
                  const active = v === showHead;
                  const Tile = active ? S.AppTraitChipActive : S.AppTraitChip;
                  const Lbl = active ? S.AppTraitChipTextActive : S.AppTraitChipText;
                  return (
                    <Tile key={String(v)} onPress={() => setShowHead(v)}>
                      <Lbl>{v ? 'show' : 'hide'}</Lbl>
                    </Tile>
                  );
                })}
              </Row>
            </Col>

            <Col style={{ gap: 4 }}>
              <S.Label>Backdrop</S.Label>
              <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                {BACKDROPS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setBackdrop(c)}
                    style={{
                      width: 28, height: 24, borderRadius: 4,
                      backgroundColor: c,
                      borderWidth: backdrop === c ? 2 : 1,
                      borderColor: backdrop === c ? 'theme:accentHot' : 'theme:border',
                    }}
                  />
                ))}
              </Row>
            </Col>
          </Col>
        </Box>
      </Row>
    </Box>
  );
}
