import { memo } from 'react';
import type { PropKind, WorldProp } from '../design';
import { StreetSign } from './props/StreetSign';
import { LedTicker } from './props/LedTicker';
import { DataProp } from './props/DataProp';
import { ImportedProp } from './props/ImportedProp';
import { isImportedPropKind } from '../game/kinds/importedProps';

// PROPSINGLE-0782: every prop renders through the ONE generic component —
// DataProp → resolvePropParts(prop) → the prop's single recipe (the SAME source
// the compile bake reads). So every prop is skinnable (click-to-pick parts) and
// matches the compiled game by construction, with no per-prop render code.
//
// This map holds only the rare SPECIAL cases that aren't a plain recipe yet;
// every other kind falls through to DataProp. Imported (GLB) props go to
// ImportedProp. The former per-prop components (Payphone, Dumpster, Tree, Rock,
// Furniture…) are retired — their geometry now lives once in compile/propRecipes.
type PropModel = (props: { prop: WorldProp }) => any;

const PROP_MODELS: Partial<Record<PropKind, PropModel>> = {
  // Street signs carry a default route-plate texture (a defaultTextureKey the
  // flat recipe can't express yet), so they keep their bespoke component.
  streetSign: StreetSign,
  // The LED ticker's lit face is ANIMATED (scrolls each frame), so it can't be a
  // static recipe — its custom renderer draws the housing + the moving LEDs.
  ledTicker: LedTicker,
};

// One placed prop, drawn at its anchor + yaw. Memoized on the (referentially
// stable) prop so a player/camera frame does not re-render every prop.
export const Prop = memo(function Prop(props: { prop: WorldProp }) {
  if (isImportedPropKind(props.prop.kind)) return <ImportedProp prop={props.prop} />;
  const Model = PROP_MODELS[props.prop.kind] ?? DataProp;
  return <Model prop={props.prop} />;
});
