import { classifiers as S } from '@reactjit/core';
import { ChevronRight } from '@reactjit/runtime/icons/icons';
import { Icon } from '@reactjit/runtime/icons/Icon';
import type { CommandComposer } from '../../data/overstock/command-composer';
import { CommandComposerChip } from './CommandComposerChip';

function ComposerDividerIcon() {
  return (
    <S.CommandComposerToolbarIconSlot>
      <Icon icon={ChevronRight} size={12} color="theme:inkDimmer" strokeWidth={2.2} />
    </S.CommandComposerToolbarIconSlot>
  );
}

export function CommandComposerHeader({ row }: { row: CommandComposer }) {
  if (row.attachments.length === 0) return null;

  return (
    <S.CommandComposerTopbar>
      <S.CommandComposerTopCluster>
        <S.CommandComposerMetaText>{row.attachLabel}</S.CommandComposerMetaText>
        <ComposerDividerIcon />
        {row.attachments.map((attachment) => (
          <CommandComposerChip key={attachment.id} chip={attachment} />
        ))}
      </S.CommandComposerTopCluster>
    </S.CommandComposerTopbar>
  );
}
