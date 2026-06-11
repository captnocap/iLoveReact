// workbench.test.ts — shell-level shortcut dispatch for the Workbench frame.
// The editor-control-contract bindings in Workbench.tsx ('bench' scope) call
// this same action resolver; source tests cover the domain behavior behind
// the actions. Chord/gate behavior is covered by editors/controls.test.ts.

import { assert, assertEqual, finish, test } from '../game/_testkit';
import { workbenchActionShortcut, workbenchShortcutAction, workbenchShortcutHandlers, type ActionSpec } from './Workbench';

test('KEYBINDINGS: shell shortcuts resolve to the visible source actions', () => {
  const seen: string[] = [];
  const actions: ActionSpec[] = [
    { id: 'save', label: 'Save', icon: 'Check', run: () => seen.push('save') },
    { id: 'undo', label: 'Undo', icon: 'Undo2', run: () => seen.push('undo') },
    { id: 'redo', label: 'Redo', icon: 'Redo2', run: () => seen.push('redo') },
  ];
  assertEqual(workbenchActionShortcut(actions[0]), 'Ctrl+S', 'save button tooltip carries ctrl+s');
  assertEqual(workbenchActionShortcut(actions[1]), 'Ctrl+Z', 'undo button tooltip carries ctrl+z');
  assertEqual(workbenchActionShortcut(actions[2]), 'Ctrl+Y / Ctrl+Shift+Z', 'redo button tooltip carries both standard redo shortcuts');
  assert(workbenchShortcutAction(actions, 'undo') === actions[1], 'ctrl+z chooses the visible undo action');

  const handlers = workbenchShortcutHandlers(actions, (a) => a.run());
  handlers.save?.();
  handlers.undo?.();
  handlers.redo?.();
  assertEqual(seen.join(','), 'save,undo,redo', 'keyboard dispatch uses the same action run path as the buttons');
});

finish('shell/workbench');
