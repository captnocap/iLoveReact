import { classifiers as S } from '@reactjit/core';
import type { CommandComposer, CommandComposerPromptSegment } from '../../data/overstock/command-composer';
import { CommandComposerActionRail } from './CommandComposerActionRail';
import { CommandComposerChip, CommandComposerPromptReference } from './CommandComposerChip';

function segmentKey(segment: CommandComposerPromptSegment, index: number): string {
  if (segment.kind === 'text') return `${segment.text}-${index}`;
  return `${segment.kind}-${segment.label}-${index}`;
}

function promptRows(segments: CommandComposerPromptSegment[]): CommandComposerPromptSegment[][] {
  const rows: CommandComposerPromptSegment[][] = [[]];

  for (const segment of segments) {
    if (segment.breakBefore && rows[rows.length - 1].length > 0) {
      rows.push([]);
    }
    rows[rows.length - 1].push(segment);
  }

  return rows;
}

export function CommandComposerPromptLine({ row }: { row: CommandComposer }) {
  const rows = promptRows(row.prompt);

  return (
    <S.CommandComposerMain>
      <S.CommandComposerPromptRows>
        {rows.map((promptRow, rowIndex) => (
          <S.CommandComposerPromptFlow key={`prompt-row-${rowIndex}`}>
            {promptRow.map((segment, index) =>
              segment.kind === 'text' ? (
                <S.CommandComposerPromptText key={segmentKey(segment, index)}>{segment.text}</S.CommandComposerPromptText>
              ) : (
                <CommandComposerPromptReference key={segmentKey(segment, index)} segment={segment} />
              )
            )}
          </S.CommandComposerPromptFlow>
        ))}
      </S.CommandComposerPromptRows>

      <S.CommandComposerActionRow>
        <CommandComposerChip chip={row.branch} />
        <CommandComposerActionRail modeGlyph={row.modeGlyph} sendLabel={row.sendLabel} />
      </S.CommandComposerActionRow>
    </S.CommandComposerMain>
  );
}
