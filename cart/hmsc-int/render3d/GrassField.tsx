import { memo, useEffect, useMemo, useState } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState } from '../design';
import { buildGrassInstances, buildBushInstances, buildFlowerInstances } from './grassPopulation';
import { buildPalmFrondInstances, buildPalmTrunkInstances } from './palmPopulation';
import { editorTunables } from '../editors/tunables';
import type { GeometryDef } from '@reactjit/geometries';

// Re-render when the grass globals are tuned on /settings (GRASS_CONFIG height /
// density / colour). The tunable revision bumps on every write; poll it cheaply so
// a slider/ColorWheel drag re-bakes the field within a frame or two, without a
// per-frame cost. (Editor only — the compiled bake reads the same config one-shot.)
function useTuningRevision(): number {
  const [rev, setRev] = useState(() => editorTunables().revision());
  useEffect(() => {
    const id = setInterval(() => {
      const r = editorTunables().revision();
      setRev((prev) => (prev === r ? prev : r));
    }, 150);
    return () => clearInterval(id);
  }, []);
  return rev;
}

// A painted-tile foliage field, populated as ONE instanced card batch. The host
// collapses it to a single instanced draw (no per-card React node); the "~grass~"
// tex key routes it to the foliage scene3d pipeline (wind + wisp cutout + root→tip
// gradient). Memoized on `world` (+ the tuning revision) so it only re-rolls when
// the map or the foliage globals change, never on a movement frame.
function FoliageField(props: {
  world: GameState['world'];
  build: (world: GameState['world']) => ReturnType<typeof buildGrassInstances>;
  geometry: GeometryDef;
  params: any;
  textureKey?: string | null;
}) {
  const rev = useTuningRevision();
  const field = useMemo(() => props.build(props.world), [props.world, rev, props.build]);
  if (field.count === 0) return null;
  const textureKey = props.textureKey === null ? undefined : props.textureKey ?? '~grass~';
  return (
    <Scene3D.Instances
      geometry={props.geometry}
      params={props.params}
      data={field.data}
      count={field.count}
      stride={12}
      center={field.center}
      boundsRadius={field.radius}
      textureKey={textureKey}
    />
  );
}

// Grass: blades over the painted grass tiles.
export const GrassField = memo(function GrassField(props: { world: GameState['world'] }) {
  return <FoliageField world={props.world} build={buildGrassInstances} geometry={Geometry.GrassBlade} params={Geometry.GRASS_BLADE_DEFAULTS} />;
});

export const FlowerField = memo(function FlowerField(props: { world: GameState['world'] }) {
  return <FoliageField world={props.world} build={buildFlowerInstances} geometry={Geometry.FlowerHead} params={Geometry.FLOWER_HEAD_DEFAULTS} />;
});

// Bush: leafy clumps over the painted 'bush' tiles — the same foliage pipeline,
// the bushier BushClump geometry (replaces the old solid-sphere bush prop).
export const BushField = memo(function BushField(props: { world: GameState['world'] }) {
  return <FoliageField world={props.world} build={buildBushInstances} geometry={Geometry.BushClump} params={Geometry.BUSH_CLUMP_DEFAULTS} />;
});

export const PalmFrondField = memo(function PalmFrondField(props: { world: GameState['world'] }) {
  return <FoliageField world={props.world} build={buildPalmFrondInstances} geometry={Geometry.Frond} params={Geometry.FROND_DEFAULTS} textureKey="~frond~" />;
});

export const PalmTrunkField = memo(function PalmTrunkField(props: { world: GameState['world'] }) {
  return <FoliageField world={props.world} build={buildPalmTrunkInstances} geometry={Geometry.PalmTrunk} params={Geometry.PALM_TRUNK_DEFAULTS} textureKey={null} />;
});
