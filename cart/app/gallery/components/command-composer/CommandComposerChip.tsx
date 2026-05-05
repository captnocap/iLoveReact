import { classifiers as S } from '@reactjit/core';
import {
  AtSign,
  Braces,
  File,
  FileText,
  GitBranch,
  Hash,
  Image as ImageIcon,
} from '@reactjit/runtime/icons/icons';
import { Icon, type IconData } from '@reactjit/runtime/icons/Icon';
import type {
  CommandComposerChip as CommandComposerChipData,
  CommandComposerPromptSegment,
  CommandComposerTone,
} from '../../data/overstock/command-composer';

type ClassifierComponent = (props: { children?: any; key?: string }) => any;
type ReferenceSegment = Extract<CommandComposerPromptSegment, { label: string }>;

function textForTone(tone: CommandComposerTone): ClassifierComponent {
  if (tone === 'success') return S.CommandComposerSuccessText;
  if (tone === 'warn') return S.CommandComposerWarnText;
  if (tone === 'hot') return S.CommandComposerHotText;
  if (tone === 'accent') return S.CommandComposerTokenText;
  return S.CommandComposerMutedText;
}

function frameForTone(tone: CommandComposerTone): ClassifierComponent {
  if (tone === 'success') return S.CommandComposerChipSuccess;
  if (tone === 'hot' || tone === 'accent') return S.CommandComposerChipAccent;
  return S.CommandComposerChip;
}

function colorForTone(tone: CommandComposerTone): string {
  if (tone === 'success') return 'theme:ok';
  if (tone === 'warn') return 'theme:warn';
  if (tone === 'hot') return 'theme:accentHot';
  if (tone === 'accent') return 'theme:blue';
  return 'theme:inkDim';
}

function iconForPromptSegment(segment: ReferenceSegment): IconData {
  if (segment.kind === 'file') return AtSign;
  if (segment.kind === 'variable') return Braces;
  return Hash;
}

function iconForChip(chip: CommandComposerChipData): IconData | null {
  if (chip.prefix === '▣') return chip.label.endsWith('.png') ? ImageIcon : File;
  if (chip.prefix === '☰') return FileText;
  if (chip.prefix === '⌁') return GitBranch;
  return null;
}

export function CommandComposerChip({ chip }: { chip: CommandComposerChipData }) {
  const Frame = frameForTone(chip.tone);
  const Label = textForTone(chip.tone);
  const icon = iconForChip(chip);
  const color = colorForTone(chip.tone);

  return (
    <Frame>
      {icon ? (
        <S.CommandComposerInlineIconSlot>
          <Icon icon={icon} size={12} color={color} strokeWidth={2.1} />
        </S.CommandComposerInlineIconSlot>
      ) : null}
      {chip.prefix && !icon ? <S.CommandComposerMutedText>{chip.prefix}</S.CommandComposerMutedText> : null}
      <Label>{chip.label}</Label>
    </Frame>
  );
}

export function CommandComposerPromptReference({ segment }: { segment: ReferenceSegment }) {
  const Frame =
    segment.kind === 'command'
      ? S.CommandComposerCommandRef
      : segment.kind === 'variable'
        ? S.CommandComposerVariableRef
        : S.CommandComposerReference;
  const Label = textForTone(segment.tone);

  return (
    <Frame>
      <S.CommandComposerPromptIconSlot>
        <Icon icon={iconForPromptSegment(segment)} size={13} color={colorForTone(segment.tone)} strokeWidth={2.2} />
      </S.CommandComposerPromptIconSlot>
      <Label>{segment.label}</Label>
    </Frame>
  );
}
