// shell/stage.tsx — column 4 scaffolding (WORKBENCH.md §2).
//
// LAW 1: the stage DEMONSTRATES, it never edits — rigs/previews receive values
// from their source and expose nothing. LAW 2: the preview bar holds LENSES
// only (3D/2D ⇄ PAINT, ALL ⇄ channel) — a lens changes how you look, never
// what is. LAW 3: no dead space — a stage with nothing to show says so at
// full size (EmptyStage), it never leaves the column black and tiny.

import type { ReactNode } from 'react';
import { Box } from '@reactjit/primitives';
import { C } from './workbench.cls';

export interface LensSpec { id: string; label: string }

/** The preview bar: subject tag on the left, lens segments on the right. */
export function LensBar(props: { tag: string; lenses: LensSpec[]; active: string; onLens: (id: string) => void }) {
  return (
    <C.PreviewBar>
      <C.PreviewTag>{props.tag}</C.PreviewTag>
      <Box style={{ flexGrow: 1 }} />
      {props.lenses.length > 1 ? (
        <C.LensSeg>
          {props.lenses.map((l) => {
            const Cell = l.id === props.active ? C.LensCellOn : C.LensCell;
            const T = l.id === props.active ? C.LensTextOn : C.LensText;
            return <Cell key={l.id} onPress={() => props.onLens(l.id)}><T>{l.label}</T></Cell>;
          })}
        </C.LensSeg>
      ) : null}
    </C.PreviewBar>
  );
}

/** Full-size placeholder for a stage a source hasn't built yet. */
export function EmptyStage(props: { title: string; hint: string; children?: ReactNode }) {
  return (
    <C.EmptyState>
      <C.EmptyTitle>{props.title}</C.EmptyTitle>
      <C.EmptyHint>{props.hint}</C.EmptyHint>
      {props.children}
    </C.EmptyState>
  );
}
