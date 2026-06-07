import { assert, assertEqual, finish, test } from '../game/_testkit';
import { normalizeOverlayNotice } from './notifications';

test('rebuild-required notifications normalize to the reusable overlay shape', () => {
  const notice = normalizeOverlayNotice({
    id: 'dev-host-stale',
    type: 'rebuild-required',
    kind: 'native-build-id-mismatch',
    title: ' Rebuild needed ',
    message: ' Restart rjit dev. ',
    detail: 'running old / disk new',
    persistent: true,
    runningBuildId: 'old',
    currentBuildId: 'new',
    inputCount: 7,
  });
  assert(notice !== null, 'notice accepted');
  assertEqual(notice!.id, 'dev-host-stale', 'id preserved');
  assertEqual(notice!.type, 'rebuild-required', 'type preserved');
  assertEqual(notice!.kind, 'native-build-id-mismatch', 'kind preserved');
  assertEqual(notice!.title, 'Rebuild needed', 'title trimmed');
  assertEqual(notice!.message, 'Restart rjit dev.', 'message trimmed');
  assertEqual(notice!.persistent, true, 'persistent flag preserved');
  assertEqual(notice!.inputCount, 7, 'input count preserved');
});

test('invalid and clear notifications do not create dead overlay rows', () => {
  assertEqual(normalizeOverlayNotice(null), null, 'null ignored');
  assertEqual(normalizeOverlayNotice({ type: 'rebuild-required', title: '', message: 'x' }), null, 'empty title ignored');
  assertEqual(normalizeOverlayNotice({ type: 'rebuild-required', title: 'x', message: '' }), null, 'empty message ignored');

  const clear = normalizeOverlayNotice({ type: 'clear', id: 'dev-host-stale' });
  assert(clear !== null, 'clear accepted');
  assertEqual(clear!.id, 'dev-host-stale', 'clear id preserved');
  assertEqual(clear!.type, 'clear', 'clear type preserved');
});

finish('shell/notifications');
