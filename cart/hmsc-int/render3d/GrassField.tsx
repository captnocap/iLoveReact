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
  // EDITOR-ONLY render cap (req_1645): the preview materialises one 12-float row PER
  // BLADE in JS (up to MAX_INSTANCES=1,048,576) and ships the WHOLE buffer as ONE
  // Scene3D.Instances command — a million-row array whose JSON.stringify is hundreds
  // of MB and OOMs the editor heap. The COMPILED game has no such buffer: it ships the
  // flora CELLS and the GPU expands blades (framework/world/foliage.zig). Until the
  // editor preview does the same (the flora refactor), cap what we SHIP so a lush map
  // still opens — a thinned-but-representative field, not a heap bomb. Slice (a copy)
  // so the giant underlying buffer never reaches the command stream.
  const cappedCount = Math.min(field.count, EDITOR_FOLIAGE_RENDER_CAP);
  const data = cappedCount < field.count ? field.data.slice(0, cappedCount * 12) : field.data;
  if (cappedCount < field.count) {
    console.warn(`[grassPopulation] editor preview capped ${field.count} → ${cappedCount} blades shipped (GPU-expanded in the compiled game; raise EDITOR_FOLIAGE_RENDER_CAP if needed)`);
  }
  return (
    <Scene3D.Instances
      geometry={props.geometry}
      params={props.params}
      data={data}
      count={cappedCount}
      stride={12}
      center={field.center}
      boundsRadius={field.radius}
      textureKey={textureKey}
    />
  );
}

// How many foliage blades the EDITOR preview is allowed to ship in one instances
// command. 64Ki blades ≈ a 786 KB buffer — plenty to read the field's shape, far under
// the heap-bombing million-row command. Editor-only; the compiled game is uncapped (GPU).
const EDITOR_FOLIAGE_RENDER_CAP = 65536;

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
