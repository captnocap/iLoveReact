// CommandComposerPanel — gallery component bound to the `CommandComposer` data shape.
//
// Source of truth: cart/app/gallery/data/command-composer.ts
//
// Top-level fields on `CommandComposer`:
//   id: string
//   routingLabel: string
//   route: CommandComposerChip
//   target: CommandComposerChip
//   attachLabel: string
//   attachments: CommandComposerChip[]
//   prompt: CommandComposerPromptSegment[]
//   branch: CommandComposerChip
//   leftShortcuts: CommandComposerShortcut[]
//   executeShortcut: CommandComposerShortcut
//   modeGlyph: string
//   sendLabel: string
//
// Available exports from the shape file:
//   commandComposerMockData: CommandComposer[]    — seeded mock rows for stories
//   commandComposerSchema: JsonObject    — JSON schema
//   commandComposerReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `CommandComposer` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `commandComposerMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: CommandComposer[]` and update the variant
//     accordingly.

import { classifiers as S } from '@reactjit/core';
import type { CommandComposer } from '../../data/overstock/command-composer';
import { CommandComposerFooter } from '../command-composer/CommandComposerFooter';
import { CommandComposerHeader } from '../command-composer/CommandComposerHeader';
import { CommandComposerPromptLine } from '../command-composer/CommandComposerPromptLine';

export type CommandComposerPanelProps = {
  row: CommandComposer;
};

export function CommandComposerPanel({ row }: CommandComposerPanelProps) {
  return (
    <S.CommandComposerFrame>
      <CommandComposerHeader row={row} />
      <CommandComposerPromptLine row={row} />
      <CommandComposerFooter row={row} />
    </S.CommandComposerFrame>
  );
}
