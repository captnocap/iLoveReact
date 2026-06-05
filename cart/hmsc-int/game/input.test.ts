// input.test.ts — P4 behavior tests for GAME_INPUT.
//
// Drives the real framework bus (runtime/ffi.ts emit) — the same channel the
// engine's key shims publish on — and asserts the transport contract: a held
// key reads down until its keyup, modifiers track the latest event, and a
// disposed snapshot goes deaf.

import { emit } from '@reactjit/ffi';
import { GAME_INPUT } from './input';
import { assertEqual, finish, test } from './_testkit';

test('a held key reads down until its keyup arrives', () => {
  const keys = GAME_INPUT.createKeyState();
  assertEqual(keys.isDown('w'), false, 'untouched key must read up');
  emit('__keydown', { key: 'W' });
  assertEqual(keys.isDown('w'), true, 'keydown must read down (case-insensitive)');
  assertEqual(keys.isDown('a'), false, 'other keys must stay up');
  emit('__keyup', { key: 'w' });
  assertEqual(keys.isDown('w'), false, 'keyup must release the key');
  keys.dispose();
});

test('modifiers track the latest event', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'shift', shiftKey: true });
  assertEqual(keys.shift(), true, 'shift must read held');
  emit('__keyup', { key: 'shift', shiftKey: false });
  assertEqual(keys.shift(), false, 'shift must release');
  emit('__keydown', { key: 's', ctrlKey: true, altKey: true });
  assertEqual(keys.ctrl(), true, 'ctrl must track');
  assertEqual(keys.alt(), true, 'alt must track');
  keys.dispose();
});

test('a disposed snapshot goes deaf; live subscribers still hear the bus', () => {
  const keys = GAME_INPUT.createKeyState();
  emit('__keydown', { key: 'd' });
  keys.dispose();
  emit('__keyup', { key: 'd' });
  assertEqual(keys.isDown('d'), true, 'a disposed snapshot must freeze (the keyup never lands)');

  const seen: string[] = [];
  const off = GAME_INPUT.onKeyDown((event) => seen.push(String(event.key)));
  emit('__keydown', { key: 'x' });
  off();
  emit('__keydown', { key: 'y' });
  assertEqual(seen.join(','), 'x', 'raw subscription must hear until unsubscribed');
});

finish('game/input');
