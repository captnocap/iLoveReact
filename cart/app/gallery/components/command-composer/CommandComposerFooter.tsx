import { Fragment } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import type { CommandComposer } from '../../data/overstock/command-composer';
import { CommandComposerKeycap } from './CommandComposerShortcut';

function FooterDivider() {
  return (
    <Box style={{
      width: 1,
      height: 14,
      backgroundColor: 'theme:rule',
      alignSelf: 'center',
    }} />
  );
}

export function CommandComposerFooter({ row }: { row: CommandComposer }) {
  const exec = row.executeShortcut;
  const execTooltip = exec.secondaryKey
    ? `${exec.label} (${exec.key}${exec.joiner ?? '+'}${exec.secondaryKey})`
    : `${exec.label} (${exec.key})`;
  const execGlyph = exec.secondaryKey === 'enter' ? '⏎' : (exec.secondaryKey ?? exec.key);

  return (
    <S.CommandComposerFooter>
      <S.CommandComposerFooterShortcuts>
        {row.leftShortcuts.map((shortcut, i) => (
          <Fragment key={shortcut.id}>
            {i > 0 ? <FooterDivider /> : null}
            <Tooltip label={shortcut.label} side="top">
              <CommandComposerKeycap value={shortcut.key} />
            </Tooltip>
          </Fragment>
        ))}
      </S.CommandComposerFooterShortcuts>
      <S.Spacer />
      <Tooltip label={execTooltip} side="top">
        <CommandComposerKeycap value={execGlyph} />
      </Tooltip>
    </S.CommandComposerFooter>
  );
}
