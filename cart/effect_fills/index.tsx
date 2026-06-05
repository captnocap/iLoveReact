import { useState } from 'react';
import { Box, Col, Effect, Pressable, Row, ScrollView, Text } from '@reactjit/primitives';
import { FILL_SHADER } from '../hmsc/render3d/fillShader';

const SWATCH = 125;
const VARIANTS = [0, 1, 2] as const;

const MATERIALS = [
  { id: 0, name: 'Road' },
  { id: 1, name: 'Concrete' },
  { id: 2, name: 'Brick' },
  { id: 3, name: 'Sand' },
  { id: 4, name: 'Water' },
  { id: 5, name: 'Grass' },
  { id: 6, name: 'Wood' },
] as const;

const GRUNGE_MATERIALS = [
  { id: 0, name: 'Mold Wall' },
  { id: 1, name: 'Peel Paint' },
  { id: 2, name: 'Linoleum' },
  { id: 3, name: 'Bath Tile' },
  { id: 4, name: 'Mildew Brick' },
  { id: 5, name: 'Rot Siding' },
  { id: 6, name: 'Rust Sheet' },
] as const;

const PROP_MATERIALS = [
  { id: 0, name: 'Blade Steel' },
  { id: 1, name: 'Gunmetal' },
  { id: 2, name: 'Grip Polymer' },
  { id: 3, name: 'Leather' },
  { id: 4, name: 'Denim' },
  { id: 5, name: 'Fabric' },
  { id: 6, name: 'Skin' },
] as const;

const VICE_MATERIALS = [
  { id: 0, name: 'Peel Wallpaper' },
  { id: 1, name: 'Motel Carpet' },
  { id: 2, name: 'Rotten Rug' },
  { id: 3, name: 'Neon Stucco' },
  { id: 4, name: 'Pool Tile' },
  { id: 5, name: 'Booth Vinyl' },
  { id: 6, name: 'Drop Ceiling' },
  { id: 7, name: 'PDX Carpet' },
] as const;

// Board E / Neon Surface — Claude's dream-pole materials (board id 4).
const SURFACE_MATERIALS = [
  { id: 0, name: 'Stucco Facade' },
  { id: 1, name: 'Neon Tube' },
  { id: 2, name: 'Sunset Sky' },
  { id: 3, name: 'Wet Asphalt' },
  { id: 4, name: 'Car Paint' },
  { id: 5, name: 'CRT Screen' },
  { id: 6, name: 'Palm Canopy' },
] as const;

// Board F / Contraband & Consequence — Claude's squalor-pole game-objects (board id 5).
const CONTRA_MATERIALS = [
  { id: 0, name: 'Cash Stack' },
  { id: 1, name: 'Product Baggie' },
  { id: 2, name: 'Blood Pool' },
  { id: 3, name: 'Evidence' },
  { id: 4, name: 'Refuse' },
  { id: 5, name: 'Corkboard' },
  { id: 6, name: 'Substance' },
] as const;

// Board G / Liminal — Kimi's threshold surfaces (board id 6).
const LIMINAL_MATERIALS = [
  { id: 0, name: 'Fogged Mirror' },
  { id: 1, name: 'Salt Flat' },
  { id: 2, name: 'Moss Carpet' },
  { id: 3, name: 'Tarnished Silver' },
  { id: 4, name: 'Ice Sheet' },
  { id: 5, name: 'Charcoal Bed' },
  { id: 6, name: 'Stained Glass' },
] as const;

// Board H / Second Pass — Kimi's alt takes on the core environment set (board id 7).
const ALT_MATERIALS = [
  { id: 0, name: 'Asphalt' },
  { id: 1, name: 'Sidewalk' },
  { id: 2, name: 'Stone Wall' },
  { id: 3, name: 'Dune' },
  { id: 4, name: 'Deep Water' },
  { id: 5, name: 'Turf' },
  { id: 6, name: 'Plank Deck' },
] as const;

const QUALITY_GRADES = [
  { id: 0, label: 'PSX', note: '32px snap, 6-bit color' },
  { id: 1, label: 'PS2', note: '64px snap, banded color' },
  { id: 2, label: 'Preview', note: 'coarse pass' },
  { id: 3, label: 'Std', note: 'game-ready' },
  { id: 4, label: 'Max', note: 'extra detail' },
] as const;
type QualityGrade = typeof QUALITY_GRADES[number]['id'];
type BoardId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;


function fillData(materialId: number, variant: number, quality: QualityGrade, board: BoardId): number[] {
  const seed = board === 0
    ? materialId * 17.0 + variant * 5.0 + 3.0
    : board === 1
      ? materialId * 23.0 + variant * 11.0 + 41.0
      : board === 2
        ? materialId * 29.0 + variant * 13.0 + 89.0
        : board === 3
          ? materialId * 31.0 + variant * 17.0 + 131.0
          : board === 4
            ? materialId * 37.0 + variant * 19.0 + 181.0
            : board === 5
              ? materialId * 41.0 + variant * 23.0 + 229.0
              : board === 6
                ? materialId * 43.0 + variant * 27.0 + 271.0
                : materialId * 47.0 + variant * 29.0 + 313.0;
  return [materialId, variant, seed, quality, board];
}

function swatchId(prefix: string, materialId: number, variant: number): string {
  const n = materialId * VARIANTS.length + variant + 1;
  return prefix + (n < 10 ? `0${n}` : `${n}`);
}

function Swatch({ data, idLabel }: { data: number[]; idLabel: string }) {
  return (
    <Box
      style={{
        position: 'relative',
        width: SWATCH,
        height: SWATCH,
        backgroundColor: '#05070a',
        borderWidth: 1,
        borderColor: '#223042',
        overflow: 'hidden',
      }}
    >
      <Effect shader={FILL_SHADER} data={data} style={{ position: 'absolute', left: 0, top: 0, width: SWATCH, height: SWATCH }} />
      <Box style={{ position: 'absolute', left: 6, top: 6, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: '#05070acc', borderWidth: 1, borderColor: '#d8e2ef55' }}>
        <Text style={{ fontSize: 10, color: '#f4f7fb', fontFamily: 'monospace', fontWeight: '800' }}>{idLabel}</Text>
      </Box>
    </Box>
  );
}

function MaterialColumn({ material, quality }: { material: typeof MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`${material.id}-${variant}`} data={fillData(material.id, variant, quality, 0)} idLabel={swatchId('A', material.id, variant)} />
      ))}
    </Col>
  );
}

function GrungeColumn({ material, quality }: { material: typeof GRUNGE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`g-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 1)} idLabel={swatchId('B', material.id, variant)} />
      ))}
    </Col>
  );
}

function PropColumn({ material, quality }: { material: typeof PROP_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`p-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 2)} idLabel={swatchId('C', material.id, variant)} />
      ))}
    </Col>
  );
}

function ViceColumn({ material, quality }: { material: typeof VICE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`v-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 3)} idLabel={swatchId('D', material.id, variant)} />
      ))}
    </Col>
  );
}

function SurfaceColumn({ material, quality }: { material: typeof SURFACE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`e-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 4)} idLabel={swatchId('E', material.id, variant)} />
      ))}
    </Col>
  );
}

function ContraColumn({ material, quality }: { material: typeof CONTRA_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`f-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 5)} idLabel={swatchId('F', material.id, variant)} />
      ))}
    </Col>
  );
}

function LiminalColumn({ material, quality }: { material: typeof LIMINAL_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`g-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 6)} idLabel={swatchId('G', material.id, variant)} />
      ))}
    </Col>
  );
}

function AltColumn({ material, quality }: { material: typeof ALT_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`h-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 7)} idLabel={swatchId('H', material.id, variant)} />
      ))}
    </Col>
  );
}

function BoardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <Col style={{ gap: 4 }}>
        <Text style={{ fontSize: 29, color: '#f4f7fb', fontWeight: '800' }}>{title}</Text>
        <Text style={{ fontSize: 13, color: '#8fa3bb' }}>{subtitle}</Text>
      </Col>
    </Row>
  );
}

function QualityToggle({ quality, onChange }: { quality: QualityGrade; onChange: (quality: QualityGrade) => void }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text style={{ fontSize: 12, color: '#8fa3bb', fontWeight: '700' }}>Quality</Text>
      <Row style={{ gap: 2, backgroundColor: '#101820', borderWidth: 1, borderColor: '#223042', padding: 3 }}>
        {QUALITY_GRADES.map((grade) => {
          const active = quality === grade.id;
          return (
            <Pressable
              key={grade.id}
              onPress={() => onChange(grade.id)}
              style={{
                width: 68,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? '#d8e2ef' : '#101820',
                borderWidth: 1,
                borderColor: active ? '#d8e2ef' : '#1a2533',
              }}
            >
              <Text style={{ fontSize: 12, color: active ? '#071018' : '#b8c6d8', fontWeight: '800' }}>{grade.label}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Text style={{ fontSize: 12, color: '#65758a' }}>{QUALITY_GRADES[quality].note}</Text>
    </Row>
  );
}

export default function EffectFills() {
  const [quality, setQuality] = useState<QualityGrade>(3);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#070b10' }}>
      <Row style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 18, paddingBottom: 12, alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#162232' }}>
        <Col style={{ gap: 3 }}>
          <Text style={{ fontSize: 18, color: '#f4f7fb', fontWeight: '800' }}>Effect Fill Lab</Text>
          <Text style={{ fontSize: 12, color: '#65758a' }}>runtime detail grade feeds every swatch; IDs stay stable across grades</Text>
        </Col>
        <QualityToggle quality={quality} onChange={setQuality} />
      </Row>

      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
        <Col style={{ padding: 26, gap: 34 }}>
          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board A / Environment" subtitle="A01-A21: road, concrete, brick, sand, water, grass, wood" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {MATERIALS.map((material) => (
                <MaterialColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board B / Condemned" subtitle="B01-B21: mold, water damage, rot, rust, cracked interior and exterior tiles" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {GRUNGE_MATERIALS.map((material) => (
                <GrungeColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board C / Props and Wearables" subtitle="C01-C21: blade, gunmetal, grip, leather, denim, fabric, skin fills" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {PROP_MATERIALS.map((material) => (
                <PropColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board D / Neon Rot" subtitle="D01-D24: wallpaper, carpets, rugs, stucco, tile, vinyl, ceiling stains, PDX carpet" />
            <Row style={{ gap: 8, alignItems: 'flex-start' }}>
              {VICE_MATERIALS.map((material) => (
                <ViceColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board E / Neon Surface — Claude" subtitle="E01-E21: stucco facade, neon tube, sunset sky, wet asphalt, car paint, CRT screen, palm canopy — the Drive/Miami dream pole for scape3d" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {SURFACE_MATERIALS.map((material) => (
                <SurfaceColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board F / Contraband & Consequence — Claude" subtitle="F01-F21: cash stack, product baggie, blood pool, evidence, refuse, corkboard, substance — the Spun squalor game-objects" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {CONTRA_MATERIALS.map((material) => (
                <ContraColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board G / Liminal — Kimi" subtitle="G01-G21: fogged mirror, salt flat, moss carpet, tarnished silver, ice sheet, charcoal bed, stained glass — surfaces at the threshold of state-change" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {LIMINAL_MATERIALS.map((material) => (
                <LiminalColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board H / Second Pass — Kimi" subtitle="H01-H21: asphalt, sidewalk, stone wall, dune, deep water, turf, plank deck — alternative environment takes, pick your least-shitty road" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {ALT_MATERIALS.map((material) => (
                <AltColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>
        </Col>
      </ScrollView>
    </Box>
  );
}
