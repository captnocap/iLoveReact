// The asset-authoring contract, as a prompt — the systemPrompt the AI lane feeds
// to useAssistant when the user asks it to generate a placeable asset. Codified
// here (not inlined at the call site) so the rules live in ONE place and the
// model, the human author, and the bake all agree on the same contract.
//
// NOT wired to useAssistant yet — this is the seam. When the generate flow lands,
// it calls useAssistant({ backend, systemPrompt: ASSET_AUTHORING_PROMPT, ... })
// then `ask("a 3-deck parking garage, open sides")`, and writes the returned
// component text to cart/hmsc/world/assets/<Name>.tsx + appends an ASSETS entry.
// The output is structurally identical to a hand-authored asset (see assets.ts),
// so nothing downstream cares the model wrote it.

// The scale + emission rules every asset obeys. Mirrors the scape3d scale
// contract memory (1 tile = 1 m; the ~2-unit player is the fixed human anchor,
// never rescaled; scale verticals UP — stylised-tall, not realistic-tall) and
// the hmsc render conventions (one <Scene3D.Mesh> per solid; box geometry from
// @reactjit/geometries; textured faces via texturedFaces).
export const ASSET_AUTHORING_PROMPT = `You author a single placeable world asset for a stylised 3D city game, as one React component.

OUTPUT: exactly one .tsx file — a default-exported React component. No prose, no markdown fences, just the file contents.

CONTRACT (non-negotiable):
- 1 tile = 1 metre. All sizes/positions are in metres.
- The player is ~2 units tall and is the FIXED human anchor. Never rescale to the player; size the asset to feel right beside a 2-unit human. Scale verticals UP for drama — stylised-tall, not photoreal.
- The component receives props: { at: string (ignore — placement handles position), rot?: 0|90|180|270, and any sizing/appearance props you define with sane defaults }. It must render correctly with NO props beyond defaults.
- Emit geometry as <Scene3D.Mesh> children. Use box geometry from '@reactjit/geometries' (import * as Geometry; geometry={Geometry.Box}, params={{ width, height, depth }}). Position is the mesh CENTER. Build the asset around local origin (0,0,0) at its footprint's min-corner on the ground (y=0 = ground).
- Colour via material="#rrggbb". Keep a small, coherent palette.
- Keep it ONE coherent object (a building, a prop, a structure) — not a scene.
- All sizes/offsets must be COMPUTABLE CONSTANTS or simple arithmetic of the component's props (so the asset bakes to static geometry at ship). Do not read live game state, time, random, or hooks.

SHAPE (follow this skeleton):
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
export default function <Name>({ rot = 0, ...sizing }: { rot?: 0|90|180|270 } & <YourProps>) {
  // derive metre dimensions from sizing props (with defaults)
  return (
    <>
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: W, height: H, depth: D }} material="#.." position={[cx, H/2, cz]} />
      {/* ...more meshes... */}
    </>
  );
}`;

// Build the full instruction for one generation request: the contract + the
// user's natural-language ask + the component name to export. The generate flow
// passes ASSET_AUTHORING_PROMPT as systemPrompt and this as the user turn.
export function assetRequest(componentName: string, userAsk: string): string {
  return `Name the exported component exactly \`${componentName}\`. Asset to author: ${userAsk}`;
}
