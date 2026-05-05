import type { ControlTone } from '../components/controls-specimen/controlsSpecimenTheme';

export type ToolbarOrientation = 'horizontal' | 'vertical';
export type ToolbarKind = 'text-menu' | 'icon-bar' | 'status' | 'vertical';
export type ToolbarItemKind = 'button' | 'menu' | 'separator' | 'status';

export type ToolbarMenuItem = {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  tone?: ControlTone;
  disabled?: boolean;
  children?: ToolbarMenuItem[];
};

export type ToolbarItem = {
  id: string;
  kind: ToolbarItemKind;
  label?: string;
  icon?: string;
  tone?: ControlTone;
  active?: boolean;
  value?: string;
  shortcut?: string;
  disabled?: boolean;
  menu?: ToolbarMenuItem[];
};

export type ToolbarData = {
  id: string;
  label: string;
  kind: ToolbarKind;
  orientation?: ToolbarOrientation;
  items: ToolbarItem[];
  openMenuIds?: string[];
};

export const toolbarTextMenuData: ToolbarData = {
  id: 'workspace-text-menu',
  label: 'Workspace menu bar',
  kind: 'text-menu',
  items: [
    {
      id: 'file',
      kind: 'menu',
      label: 'File',
      icon: 'file',
      menu: [
        { id: 'new-file', label: 'New file', icon: 'file', shortcut: 'Ctrl N' },
        { id: 'open-folder', label: 'Open folder', icon: 'folder-open', shortcut: 'Ctrl O' },
        {
          id: 'recent',
          label: 'Recent',
          icon: 'clock',
          children: [
            { id: 'recent-reactjit', label: 'reactjit', icon: 'folder', tone: 'accent' },
            { id: 'recent-runtime', label: 'runtime/primitives.tsx', icon: 'file-code', tone: 'blue' },
            { id: 'clear-recent', label: 'Clear recent list', icon: 'trash', tone: 'flag' },
          ],
        },
        { id: 'save-all', label: 'Save all', icon: 'save', shortcut: 'Ctrl S', tone: 'ok' },
      ],
    },
    {
      id: 'explore',
      kind: 'menu',
      label: 'Explore',
      icon: 'compass',
      menu: [
        { id: 'symbols', label: 'Symbols', icon: 'hash', shortcut: 'Ctrl Shift O' },
        { id: 'search', label: 'Search workspace', icon: 'search', shortcut: 'Ctrl Shift F' },
        {
          id: 'agents',
          label: 'Agents',
          icon: 'bot',
          children: [
            { id: 'running-workers', label: 'Running workers', icon: 'play', tone: 'ok' },
            { id: 'blocked-workers', label: 'Blocked workers', icon: 'warning', tone: 'warn' },
            { id: 'worker-logs', label: 'Worker logs', icon: 'terminal', tone: 'blue' },
          ],
        },
      ],
    },
    {
      id: 'help',
      kind: 'menu',
      label: 'Help',
      icon: 'help',
      menu: [
        { id: 'docs', label: 'Documentation', icon: 'book-open' },
        {
          id: 'diagnostics',
          label: 'Diagnostics',
          icon: 'bug',
          children: [
            { id: 'layout-pass', label: 'Layout pass', icon: 'ruler', tone: 'accent' },
            { id: 'event-router', label: 'Event router', icon: 'network', tone: 'blue' },
            { id: 'gpu-text', label: 'GPU text atlas', icon: 'cpu', tone: 'warn' },
          ],
        },
        { id: 'report', label: 'Report issue', icon: 'message', tone: 'flag' },
      ],
    },
  ],
  openMenuIds: ['file', 'recent'],
};

export const toolbarIconData: ToolbarData = {
  id: 'editor-icon-bar',
  label: 'Editor icon toolbar',
  kind: 'icon-bar',
  items: [
    { id: 'save', kind: 'button', label: 'Save', icon: 'save', tone: 'ok', active: true },
    { id: 'copy', kind: 'button', label: 'Copy', icon: 'copy' },
    { id: 'cut', kind: 'button', label: 'Cut', icon: 'scissors' },
    { id: 'sep-edit', kind: 'separator' },
    { id: 'undo', kind: 'button', label: 'Undo', icon: 'undo' },
    { id: 'redo', kind: 'button', label: 'Redo', icon: 'redo', disabled: true },
    { id: 'sep-run', kind: 'separator' },
    { id: 'run', kind: 'button', label: 'Run', icon: 'play', tone: 'ok' },
    { id: 'stop', kind: 'button', label: 'Stop', icon: 'stop', tone: 'flag' },
  ],
};

export const toolbarStatusData: ToolbarData = {
  id: 'system-status-bar',
  label: 'System status toolbar',
  kind: 'status',
  items: [
    { id: 'sync', kind: 'status', label: 'Sync', icon: 'cloud', value: 'current', tone: 'ok' },
    { id: 'wifi', kind: 'status', label: 'Network', icon: 'wifi', value: 'online', tone: 'blue' },
    { id: 'cpu', kind: 'status', label: 'CPU', icon: 'cpu', value: '37%', tone: 'warn' },
    { id: 'git', kind: 'status', label: 'Git', icon: 'git-branch', value: 'main +4', tone: 'accent' },
    { id: 'db', kind: 'status', label: 'Store', icon: 'database', value: 'ready', tone: 'ok' },
  ],
};

export const toolbarVerticalData: ToolbarData = {
  id: 'activity-rail',
  label: 'Vertical activity toolbar',
  kind: 'vertical',
  orientation: 'vertical',
  items: [
    { id: 'files', kind: 'button', label: 'Files', icon: 'folder-open', active: true, tone: 'accent' },
    { id: 'search', kind: 'button', label: 'Search', icon: 'search', tone: 'blue' },
    { id: 'branch', kind: 'button', label: 'Source control', icon: 'git-branch', tone: 'ok' },
    { id: 'debug', kind: 'button', label: 'Debug', icon: 'bug', tone: 'warn' },
    { id: 'sep-rail', kind: 'separator' },
    {
      id: 'settings',
      kind: 'menu',
      label: 'Settings',
      icon: 'settings',
      tone: 'lilac',
      menu: [
        { id: 'theme', label: 'Theme', icon: 'palette', tone: 'lilac' },
        {
          id: 'panels',
          label: 'Panels',
          icon: 'panel-left',
          children: [
            { id: 'left', label: 'Toggle left panel', icon: 'panel-left' },
            { id: 'right', label: 'Toggle right panel', icon: 'panel-right' },
            { id: 'bottom', label: 'Toggle bottom panel', icon: 'panel-bottom' },
          ],
        },
        { id: 'keyboard', label: 'Keyboard shortcuts', icon: 'keyboard' },
      ],
    },
  ],
  openMenuIds: ['settings', 'panels'],
};

export const toolbarNestedMenuData: ToolbarData = {
  id: 'nested-toolbar-menu',
  label: 'Nested menu atoms',
  kind: 'text-menu',
  items: [
    {
      id: 'command',
      kind: 'menu',
      label: 'Command',
      icon: 'command',
      tone: 'accent',
      menu: [
        {
          id: 'workspace',
          label: 'Workspace',
          icon: 'folder',
          children: [
            {
              id: 'index',
              label: 'Index',
              icon: 'database',
              children: [
                { id: 'index-now', label: 'Index now', icon: 'refresh', tone: 'ok' },
                { id: 'index-settings', label: 'Index settings', icon: 'settings', tone: 'lilac' },
              ],
            },
            { id: 'trust', label: 'Trust workspace', icon: 'shield', tone: 'blue' },
          ],
        },
        {
          id: 'view',
          label: 'View',
          icon: 'eye',
          children: [
            { id: 'show-toolbar', label: 'Show toolbar', icon: 'check', tone: 'ok' },
            { id: 'zen', label: 'Focus mode', icon: 'eye-off' },
          ],
        },
      ],
    },
  ],
  openMenuIds: ['command', 'workspace', 'index'],
};

export const toolbarMockData = [
  toolbarTextMenuData,
  toolbarIconData,
  toolbarStatusData,
  toolbarVerticalData,
  toolbarNestedMenuData,
];
