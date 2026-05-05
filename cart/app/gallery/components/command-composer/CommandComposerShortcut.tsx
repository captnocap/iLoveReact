import { classifiers as S } from '@reactjit/core';
import type { CommandComposerShortcut as CommandComposerShortcutData } from '../../data/overstock/command-composer';

export function CommandComposerKeycap({ value }: { value: string }) {
  return (
    <S.CommandComposerKeycap>
      <S.CommandComposerKeycapText>{value}</S.CommandComposerKeycapText>
    </S.CommandComposerKeycap>
  );
}

export function CommandComposerShortcutHint({ shortcut }: { shortcut: CommandComposerShortcutData }) {
  return (
    <S.CommandComposerShortcutGroup>
      <CommandComposerKeycap value={shortcut.key} />
      {shortcut.joiner ? <S.CommandComposerMutedText>{shortcut.joiner}</S.CommandComposerMutedText> : null}
      {shortcut.secondaryKey ? <CommandComposerKeycap value={shortcut.secondaryKey} /> : null}
      <S.CommandComposerShortcutText>{shortcut.label}</S.CommandComposerShortcutText>
    </S.CommandComposerShortcutGroup>
  );
}
