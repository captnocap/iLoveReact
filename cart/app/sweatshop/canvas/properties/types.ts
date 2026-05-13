// Selection model for the /canvas Properties panel.
//
// The canvas surface eventually carries two distinct content kinds:
//
//   - Design nodes — Page / Box / Text / Pressable / Image / Frame / Gallery
//     atoms, descended from the composer route. These have visual props
//     (size, position, padding, bg, text, …) the user tweaks in the
//     inspector.
//   - Flow nodes — trigger / action / token / rule / sequence / lanes /
//     loop / if / switch nodes from the sweatshop FlowEditor. These have
//     runtime props (label, channel, role, ports, state, meta).
//
// PropertiesPanel routes on Selection.kind. New selectable kinds get
// added to the union and a new sub-panel — no plumbing changes required
// at the call site.
//
// Patches are partial; the panel emits the diff and the canvas page (or
// content layer) folds it into committed state.

import type { FlowNode } from '../../../gallery/components/flow-editor/types';

export type DesignNodeKind =
  | 'Page' | 'Box' | 'Text' | 'Pressable' | 'Image' | 'Frame' | 'GalleryAtom';

export interface DesignNode {
  id: string;
  type: DesignNodeKind;
  name?: string;
  text?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  padding?: number;
  gap?: number;
  bg?: string;
  color?: string;
  flexDirection?: 'row' | 'column';
}

export type CanvasSelection =
  | { kind: 'design'; node: DesignNode }
  | { kind: 'flow'; node: FlowNode }
  | null;

/** Patch shapes — sub-panels emit the diff; the host folds it in. */
export type DesignPatch = Partial<Omit<DesignNode, 'id' | 'type'>>;
export type FlowPatch = Partial<Pick<FlowNode, 'label' | 'x' | 'y' | 'data'>>;

export type SelectionPatch =
  | { kind: 'design'; id: string; patch: DesignPatch }
  | { kind: 'flow'; id: string; patch: FlowPatch };
