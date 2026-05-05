import { Col, Row } from '@reactjit/runtime/primitives';
import { defineGallerySection, defineGalleryStory } from '../types';
import { commandComposerMockData } from '../data/overstock/command-composer';
import { CommandComposerActionRail } from '../components/command-composer/CommandComposerActionRail';
import { CommandComposerChip, CommandComposerPromptReference } from '../components/command-composer/CommandComposerChip';
import { CommandComposerFooter } from '../components/command-composer/CommandComposerFooter';
import { CommandComposerHeader } from '../components/command-composer/CommandComposerHeader';
import { CommandComposerPromptLine } from '../components/command-composer/CommandComposerPromptLine';
import { CommandComposerShortcutHint } from '../components/command-composer/CommandComposerShortcut';
import type { CommandComposerPromptSegment } from '../data/overstock/command-composer';

const row = commandComposerMockData[0];
type PromptReferenceSegment = Extract<CommandComposerPromptSegment, { label: string }>;

function isPromptReference(segment: CommandComposerPromptSegment): segment is PromptReferenceSegment {
  return segment.kind !== 'text';
}

const promptRefs = row.prompt.filter(isPromptReference);

function AtomShelf({ children }: { children: any }) {
  return (
    <Col style={{ width: '100%', gap: 14, padding: 16, alignItems: 'flex-start' }}>
      {children}
    </Col>
  );
}

function AtomRow({ children }: { children: any }) {
  return (
    <Row style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
    </Row>
  );
}

function section(id: string, title: string, source: string, render: () => any) {
  return defineGallerySection({
    id,
    title,
    group: {
      id: 'controls',
      title: 'Controls & Cards',
    },
    kind: 'atom',
    stories: [
      defineGalleryStory({
        id: `${id}/default`,
        title,
        source,
        status: 'ready',
        tags: ['input', 'panel'],
        variants: [
          {
            id: 'default',
            name: 'Default',
            render,
          },
        ],
      }),
    ],
  });
}

export const commandComposerHeaderSection = section(
  'command-composer-header',
  'Command Composer Header',
  'cart/app/gallery/components/command-composer/CommandComposerHeader.tsx',
  () => <CommandComposerHeader row={row} />,
);

export const commandComposerPromptLineSection = section(
  'command-composer-prompt-line',
  'Command Composer Prompt Line',
  'cart/app/gallery/components/command-composer/CommandComposerPromptLine.tsx',
  () => <CommandComposerPromptLine row={row} />,
);

export const commandComposerFooterSection = section(
  'command-composer-footer',
  'Command Composer Footer',
  'cart/app/gallery/components/command-composer/CommandComposerFooter.tsx',
  () => <CommandComposerFooter row={row} />,
);

export const commandComposerActionRailSection = section(
  'command-composer-action-rail',
  'Command Composer Action Rail',
  'cart/app/gallery/components/command-composer/CommandComposerActionRail.tsx',
  () => <CommandComposerActionRail modeGlyph={row.modeGlyph} sendLabel={row.sendLabel} />,
);

export const commandComposerChipSection = section(
  'command-composer-chip',
  'Command Composer Chip',
  'cart/app/gallery/components/command-composer/CommandComposerChip.tsx',
  () => (
    <AtomShelf>
      <AtomRow>
        <CommandComposerChip chip={row.route!} />
        <CommandComposerChip chip={row.target!} />
        <CommandComposerChip chip={row.branch} />
      </AtomRow>
      <AtomRow>
        {promptRefs.map((segment) => (
          <CommandComposerPromptReference key={segment.label} segment={segment} />
        ))}
      </AtomRow>
    </AtomShelf>
  ),
);

export const commandComposerShortcutSection = section(
  'command-composer-shortcut',
  'Command Composer Shortcut',
  'cart/app/gallery/components/command-composer/CommandComposerShortcut.tsx',
  () => (
    <AtomRow>
      {row.leftShortcuts.map((shortcut) => (
        <CommandComposerShortcutHint key={shortcut.id} shortcut={shortcut} />
      ))}
      <CommandComposerShortcutHint shortcut={row.executeShortcut} />
    </AtomRow>
  ),
);

export const commandComposerAtomSections = [
  commandComposerHeaderSection,
  commandComposerPromptLineSection,
  commandComposerFooterSection,
  commandComposerActionRailSection,
  commandComposerChipSection,
  commandComposerShortcutSection,
];
