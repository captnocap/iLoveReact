// editors/workbench/characters/figureFrame.tsx — the ONE draft→render
// derivation every character-family stage mounts (CLOTHSPLIT-0606 phase 2).
//
// Pre-split, Stage.tsx owned this block (regioned grids → face-depth fold →
// content-addressed tex/dyn keys → PartRender per part). The split gives the
// character (mesh), clothing, and animation contexts three stages over the
// same store — so the derivation lifts HERE and each stage calls it with its
// own face-anim state (the mesh context pins 'still'; the animation context
// feeds its clocks). A second copy of this math is the WORKBENCH.md §8
// review-blocker; don't fork it.
//
// FigureCaptures is the same move for the offscreen texture stack: the
// CharacterEditorCaptures mount (head composition + per-part skins + painted
// segments + clothing prints) keyed in LOCKSTEP with partRender's texKeys —
// whatever stage renders the figure must mount it, so it ships as one unit.

import { useMemo } from 'react';
import { hedDepthGrid, animateHed, type HedAnimation, type HedDocument } from '../../../game/figure/hed';
import { PART_IDS, type PartId } from '../../../game/figure/shapes';
import type { PartRender } from '../../../game/figure/render';
import { applyRegionValues, regionSignature } from '../../characters/regions';
import { editorPartParams, headTextureKey, partDynKey, skinTextureKey } from '../../characters/paintKit';
import { CharacterEditorCaptures } from '../../characters/preview';
import type { CharacterStore } from './store';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The face-animation moment a stage renders: the mesh context pins
 *  {anim: null, phase: 0} (it never ticks); the animation stage feeds its
 *  clock fold (scriptMouth beats manual — computed stage-side). */
export type FigureFaceAnim = { anim: HedAnimation | null; phase: number };

export type FigureRender = {
  /** the face document AS SHOWN (animated when anim is live, else the draft's) */
  shownDoc: HedDocument | null;
  /** per-part displacement: sculpt grid + region sliders composited */
  regionedGrids: Record<PartId, number[]>;
  /** the head's displacement with the face depth folded in */
  headDisplace: number[];
  faceId: string;
  headTexKey: string;
  skinTexKeyFor: (id: PartId) => string;
  partRender: Record<PartId, PartRender>;
};

export function useFigureRender(s: CharacterStore, face: FigureFaceAnim): FigureRender {
  const draft = s.draft;
  const v = s.view;
  const activeAnim = face.anim;
  const phase = face.phase;

  const shownDoc = useMemo(
    () => (draft.face ? (activeAnim ? animateHed(draft.face, activeAnim, phase) : draft.face) : null),
    [draft.face, activeAnim, phase],
  );

  // ── geometry: composited displacement per part (the route's 331-382) ──────
  const regionedGrids = useMemo(
    () => Object.fromEntries(PART_IDS.map((id) => [id, applyRegionValues(id, draft.grids[id], draft.regions[id])])) as Record<PartId, number[]>,
    [draft.grids, draft.regions],
  );
  const faceDepth = useMemo(() => (shownDoc ? hedDepthGrid(shownDoc) : null), [shownDoc]);
  const headDisplace = useMemo(
    () => (faceDepth ? regionedGrids.head.map((x, i) => clamp(x + faceDepth[i], -1, 1)) : regionedGrids.head),
    [regionedGrids.head, faceDepth],
  );

  const faceId = draft.face?.metadata?.seed != null ? `s${draft.face.metadata.seed}` : draft.face ? `f${draft.face.layers.length}` : 'noface';
  const paintStamp = (id: PartId) => (draft.paint?.[id] ? `.p${draft.paint[id]!.stamp}` : '');
  const headTexKey = headTextureKey({
    photoStamp: v.photo?.stamp ?? null, faceId, anim: activeAnim ?? 'still', phase,
    skin: draft.skin, photoScale: v.photoScale, photoY: v.photoY,
  }) + paintStamp('head');
  // the wardrobe-flavored content addressing stays on EVERY stage (mesh
  // included) — the capture keys and the mesh texKeys must match per stage
  const skinTexKeyFor = (id: PartId) =>
    skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape }) + paintStamp(id);

  const seqs = s.seqs;
  const partRender = useMemo(() => {
    const out = {} as Record<PartId, PartRender>;
    for (const id of PART_IDS) {
      const displace = id === 'head' ? headDisplace : regionedGrids[id];
      const headBits = id === 'head' ? `${faceId}.${activeAnim ?? 'still'}.${phase}.${draft.headScaleY.toFixed(2)}` : 'x';
      out[id] = {
        params: editorPartParams(id, draft, displace),
        dynKey: partDynKey(id, seqs[id], headBits, draft.amount, regionSignature(draft.regions[id])),
        texKey: id === 'head' ? headTexKey : skinTexKeyFor(id),
        bareTexKey: id === 'head'
          ? headTexKey
          : skinTextureKey(id, { skin: draft.skin, clothing: draft.clothing, bottoms: draft.bottoms, bodyShape: draft.bodyShape }),
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read exactly these
  }, [regionedGrids, headDisplace, seqs, draft.profiles, faceId, activeAnim, phase, draft.amount, draft.headScaleY, draft.skin, headTexKey, draft.clothing, draft.bottoms, draft.bodyShape, draft.regions, draft.paint]);

  return { shownDoc, regionedGrids, headDisplace, faceId, headTexKey, skinTexKeyFor, partRender };
}

/** The offscreen capture stack as one mountable unit — keys in lockstep with
 *  the FigureRender that produced them (CharacterEditorCaptures itself mounts
 *  ClothingSkinCaptures, so dressed stages get the print artwork for free). */
export function FigureCaptures(props: { store: CharacterStore; r: FigureRender }) {
  const draft = props.store.draft;
  const v = props.store.view;
  return (
    <CharacterEditorCaptures
      headTexKey={props.r.headTexKey}
      skinTexKeyFor={props.r.skinTexKeyFor}
      skin={draft.skin}
      photo={v.photo}
      photoScale={v.photoScale}
      photoY={v.photoY}
      layers={props.r.shownDoc?.layers ?? null}
      clothing={draft.clothing}
      bottoms={draft.bottoms}
      bodyShape={draft.bodyShape}
      parts={PART_IDS}
      paint={draft.paint}
    />
  );
}
