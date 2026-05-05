import type { GalleryDataReference, JsonObject } from '../../types';

export type CommandComposerTone =
  | 'muted'
  | 'accent'
  | 'hot'
  | 'warn'
  | 'success';

export type CommandComposerChip = {
  id: string;
  label: string;
  prefix?: string;
  tone: CommandComposerTone;
};

export type CommandComposerPromptSegment =
  | {
      kind: 'text';
      text: string;
      breakBefore?: boolean;
    }
  | {
      kind: 'file' | 'variable' | 'command';
      label: string;
      glyph: string;
      tone: CommandComposerTone;
      breakBefore?: boolean;
    };

export type CommandComposerShortcut = {
  id: string;
  key: string;
  secondaryKey?: string;
  label: string;
  joiner?: string;
};

export type CommandComposer = {
  id: string;
  routingLabel?: string;
  route?: CommandComposerChip;
  target?: CommandComposerChip;
  attachLabel: string;
  attachments: CommandComposerChip[];
  prompt: CommandComposerPromptSegment[];
  branch: CommandComposerChip;
  leftShortcuts: CommandComposerShortcut[];
  executeShortcut: CommandComposerShortcut;
  modeGlyph: string;
  sendLabel: string;
};

export const commandComposerMockData: CommandComposer[] = [
  {
    id: 'command-composer-001',
    routingLabel: 'ROUTING',
    route: {
      id: 'route-opus',
      label: '@frank · opus 4.7',
      tone: 'hot',
    },
    target: {
      id: 'target',
      prefix: '+',
      label: 'target',
      tone: 'muted',
    },
    attachLabel: 'ATTACHED',
    attachments: [
      {
        id: 'layout-v2',
        prefix: '▣',
        label: 'layout-v2.png',
        tone: 'muted',
      },
      {
        id: 'crash-log',
        prefix: '☰',
        label: 'crash_log.txt',
        tone: 'muted',
      },
    ],
    prompt: [
      { kind: 'text', text: 'refactor' },
      { kind: 'file', glyph: '@', label: 'App.jsx', tone: 'accent' },
      { kind: 'text', text: 'to match the layout from the mock and follow the constraints in' },
      { kind: 'variable', glyph: '{}', label: 'spec.boundaries', tone: 'warn', breakBefore: true },
      { kind: 'text', text: 'and verify with' },
      { kind: 'command', glyph: '#', label: 'git.branch', tone: 'hot' },
    ],
    branch: {
      id: 'branch',
      prefix: '⌁',
      label: 'feature/raid-ui-v2',
      tone: 'success',
    },
    leftShortcuts: [
      { id: 'tag-file', key: '@', label: 'tag file' },
      { id: 'variable', key: '{}', label: 'variable' },
      { id: 'command', key: '/', label: 'command' },
    ],
    executeShortcut: {
      id: 'execute',
      key: '⌘',
      secondaryKey: 'enter',
      joiner: '+',
      label: 'execute',
    },
    modeGlyph: '¶',
    sendLabel: 'SEND',
  },
];

export const commandComposerSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CommandComposer',
  type: 'array',
  $defs: {
    tone: {
      type: 'string',
      enum: ['muted', 'accent', 'hot', 'warn', 'success'],
    },
    chip: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'label', 'tone'],
      properties: {
        id: { type: 'string' },
        label: { type: 'string' },
        prefix: { type: 'string' },
        tone: { $ref: '#/$defs/tone' },
      },
    },
    shortcut: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'key', 'label'],
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        secondaryKey: { type: 'string' },
        label: { type: 'string' },
        joiner: { type: 'string' },
      },
    },
  },
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'attachLabel',
      'attachments',
      'prompt',
      'branch',
      'leftShortcuts',
      'executeShortcut',
      'modeGlyph',
      'sendLabel',
    ],
    properties: {
      id: { type: 'string' },
      routingLabel: { type: 'string' },
      route: { $ref: '#/$defs/chip' },
      target: { $ref: '#/$defs/chip' },
      attachLabel: { type: 'string' },
      attachments: {
        type: 'array',
        items: { $ref: '#/$defs/chip' },
      },
      prompt: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'text'],
              properties: {
                kind: { const: 'text' },
                text: { type: 'string' },
                breakBefore: { type: 'boolean' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'label', 'glyph', 'tone'],
              properties: {
                kind: { type: 'string', enum: ['file', 'variable', 'command'] },
                label: { type: 'string' },
                glyph: { type: 'string' },
                tone: { $ref: '#/$defs/tone' },
                breakBefore: { type: 'boolean' },
              },
            },
          ],
        },
      },
      branch: { $ref: '#/$defs/chip' },
      leftShortcuts: {
        type: 'array',
        items: { $ref: '#/$defs/shortcut' },
      },
      executeShortcut: { $ref: '#/$defs/shortcut' },
      modeGlyph: { type: 'string' },
      sendLabel: { type: 'string' },
    },
  },
};

export const commandComposerReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'Prompt fragments',
    targetSource: 'cart/app/gallery/data/prompt-fragment.ts',
    summary: 'Inline prompt references can be backed by file, variable, or command prompt fragments.',
  },
  {
    kind: 'references',
    label: 'Model route',
    targetSource: 'cart/app/gallery/data/model-route.ts',
    summary: 'The route chip mirrors the model dispatch selected for this turn.',
  },
];
