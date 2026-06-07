// editors/workbench/clothing/source.tsx — the GARMENT WorkbenchSource
// (CLOTHSOURCE-0606 → CLOTHFLIP-0607, req_0234). THE clothing authority.
// USER verbatim: "i want to just have to select a t shirt, and then i can go
// through the designs, add a new design, brings me to the painter save, done
// now that shirt exists i can give it a name, and all that important meta
// data."
//
// Roster = the garment TABLES (tops/bottoms/accessories — generated); the
// GARMENT lens renders the item ALONE over the variant GRID (the designs
// themselves, visible); the DESIGN lens IS the shared paint bench opened on
// a garment-design target (the vehicles PaintLens doorway, worn by
// garments). `+ new design` flips there; the SAVE lands the design on the
// clothing-variants stream and this source flips back wearing it.

import { useEffect, useRef, useState } from 'react';
import type { WorkbenchSource } from '../../../shell/Workbench';
import type { LensSpec } from '../../../shell/stage';
import { subscribeLiveDoors } from '../livePoll';
import { paintBenchStore } from '../paint/live';
import { PaintBench } from '../paint/PaintBench';
import { clothingPanel, clothingRoster } from './panel';
import { clothingWorkbenchStore } from './live';
import { GarmentStage } from './Stage';
import type { ClothingStore } from './store';

const GARMENT_LENSES: LensSpec[] = [
  { id: 'stage', label: 'GARMENT' },
  { id: 'design', label: 'DESIGN' },
];

/** the painter doorway (the vehicles PaintLens pattern): mounts THE shared
 *  bench; when a NEW design for this garment lands (the bench's save), the
 *  source selects it and returns to the stage — "save, done, now that shirt
 *  exists" */
function GarmentDesignLens(props: { store: ClothingStore; garmentId: string }) {
  const s = props.store;
  const bench = paintBenchStore();
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  const designIds = s.variantsOf(props.garmentId)
    .filter((v) => !v.seed && 'design' in v)
    .map((v) => v.id);
  const knownRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (knownRef.current === null) { knownRef.current = new Set(designIds); return; }
    const fresh = designIds.find((id) => !knownRef.current!.has(id));
    knownRef.current = new Set(designIds);
    if (fresh) {
      s.selectVariant(props.garmentId, fresh);
      s.setLens('stage'); // wear it — the spine's "done"
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the id SET is the signal
  }, [designIds.join('|')]);

  return <PaintBench store={bench} />;
}

export function garmentsSource(): WorkbenchSource<string> {
  const store = clothingWorkbenchStore();
  return {
    id: 'garment',
    // CLOTHFLIP-0607: the cosplay source died — this IS the clothing
    // category now; it takes the Shirt icon and the CLOTHING kicker
    icon: 'Shirt',
    kicker: 'CLOTHING',

    list: () => clothingRoster(store),
    select: (rowId: string): string => rowId,
    panel: (id: string) => clothingPanel(store, id),

    // the controlled lens pair (the characters precedent): `+ new design`
    // flips to DESIGN from inside the panel; the save flips back
    lenses: () => GARMENT_LENSES,
    activeLens: () => store.lens(),
    onLens: (_id, lens) => store.setLens(lens as 'stage' | 'design'),

    stage: (id: string) =>
      store.lens() === 'design'
        ? <GarmentDesignLens store={store} garmentId={id} />
        : <GarmentStage store={store} garmentId={id} />,

    // variant saves/selections tick the store; another session's commits
    // arrive through the shared live-doors poll
    subscribe: (fn: () => void) => {
      const offStore = store.subscribe(fn);
      const offDoors = subscribeLiveDoors(fn);
      return () => { offStore(); offDoors(); };
    },
  };
}
