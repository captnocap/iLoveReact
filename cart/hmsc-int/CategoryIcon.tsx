// CategoryIcon — a build-piece category drawn as a baked-SDF wireframe glyph
// (req_1925): a picture that reads "floor"/"wall"/"ramp" without the word. Mirrors
// the paint kit's BrushIcon exactly — the SAME reason it exists: a live <Graph.Path>
// per tab re-parses + re-tessellates every frame and tanks fps, so we draw the
// pre-baked `cat.<id>` atlas glyph as one quad. The PathIcon fallback only fires if
// the atlas wasn't regenerated (rjit bake-icons), so a tab never goes blank.

import { SdfIcon } from '@reactjit/primitives';
import { BAKED_ICON_NAMES } from '@reactjit/icons/baked-names';
import { PathIcon } from '@reactjit/paint/controls';
import { categoryIconLayers } from '@reactjit/paint/category-icons';

export function CategoryIcon(props: { cat: string; size?: number; color: string }) {
  const size = props.size ?? 22;
  const name = `cat.${props.cat}`;
  if (BAKED_ICON_NAMES.has(name)) return <SdfIcon name={name} size={size} color={props.color} />;
  return <PathIcon layers={categoryIconLayers(props.cat)} size={size} color={props.color} />;
}
