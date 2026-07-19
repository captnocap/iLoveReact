// Pure channel reducer tests.
//
//   tools/esbuild cart/editor/play/channelModel.test.ts --bundle \
//     --outfile=/tmp/editor-play-channel.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-play-channel.test.js
import {
  PLAY_CHANNEL_TUNING,
  channelTextureKey,
  dirtyChannels,
  formatCredits,
  initialPlayChannelState,
  playChannelReducer,
  visiblePhonePosts,
} from './channelModel';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('selection dirties only the shared wall channel', () => {
  const before = initialPlayChannelState();
  const after = playChannelReducer(before, { type: 'select-gig', gigId: 'drown' });
  assert(after.selectedGigId === 'drown', 'selection did not change');
  assert(dirtyChannels(before, after).join(',') === 'gigwork', `wrong dirty set: ${dirtyChannels(before, after)}`);
  assert(after.feed === before.feed, 'selection rebuilt unrelated phone data');
});

test('unknown and duplicate selections preserve exact state identity', () => {
  const before = initialPlayChannelState();
  assert(playChannelReducer(before, { type: 'select-gig', gigId: 'missing' }) === before, 'unknown gig allocated state');
  assert(playChannelReducer(before, { type: 'select-gig', gigId: before.selectedGigId }) === before, 'duplicate selection allocated state');
});

test('accepting a contract fans one domain event into all affected channels', () => {
  const before = initialPlayChannelState();
  const selected = playChannelReducer(before, { type: 'select-gig', gigId: 'warrant-buffet' });
  const after = playChannelReducer(selected, { type: 'accept-selected' });
  assert(after.activeGigId === 'warrant-buffet', 'contract did not arm');
  assert(after.feed.length === selected.feed.length + 1, 'phone did not receive dispatch row');
  assert(after.unread === selected.unread + 1, 'notification count did not rise');
  assert(dirtyChannels(selected, after).join(',') === 'gigwork,phone,identity', `wrong cross-surface dirty set: ${dirtyChannels(selected, after)}`);
  assert(playChannelReducer(after, { type: 'accept-selected' }) === after, 'duplicate acceptance was not a no-op');
});

test('completion pays once, closes the contract, and publishes proof', () => {
  const base = initialPlayChannelState();
  const armed = playChannelReducer(base, { type: 'accept-selected' });
  const paid = playChannelReducer(armed, { type: 'complete-active' });
  assert(paid.activeGigId === null, 'completed contract stayed active');
  assert(paid.creditsCents > armed.creditsCents, 'escrow did not pay');
  assert(paid.completedGigIds.includes(base.selectedGigId), 'completion history missing gig');
  assert(playChannelReducer(paid, { type: 'complete-active' }) === paid, 'empty completion allocated state or paid twice');
});

test('market cadence stays channel-local until the phone reads market', () => {
  const feed = initialPlayChannelState();
  const wallTick = playChannelReducer(feed, { type: 'tick-market' });
  assert(dirtyChannels(feed, wallTick).join(',') === 'gigwork', 'feed phone dirtied for an invisible price');
  const market = playChannelReducer(wallTick, { type: 'set-phone-app', app: 'market' });
  const bothTick = playChannelReducer(market, { type: 'tick-market' });
  assert(dirtyChannels(market, bothTick).join(',') === 'gigwork,phone', 'visible market phone did not join ticker dirtiness');
});

test('phone window materializes only the bounded visible paragraph slice', () => {
  const before = initialPlayChannelState();
  assert(visiblePhonePosts(before).length === PLAY_CHANNEL_TUNING.phoneWindowSize, 'initial feed window has wrong size');
  const after = playChannelReducer(before, { type: 'page-phone', delta: 1 });
  assert(after.phoneWindowStart === PLAY_CHANNEL_TUNING.phoneWindowSize, 'page did not advance by one bounded window');
  assert(visiblePhonePosts(after)[0]?.id !== visiblePhonePosts(before)[0]?.id, 'visible slice did not change');
  assert(dirtyChannels(before, after).join(',') === 'phone', 'paging dirtied a non-phone channel');
});

test('texture identity is stable across revisions and formatting is integer-safe', () => {
  const before = initialPlayChannelState();
  const after = playChannelReducer(before, { type: 'tick-market' });
  assert(channelTextureKey('gigwork') === channelTextureKey('gigwork'), 'public texture key is unstable');
  assert(before.revisions.gigwork !== after.revisions.gigwork, 'fixture did not advance revision');
  assert(formatCredits(2_367) === '¥ 23.67', `unexpected positive format: ${formatCredits(2_367)}`);
  assert(formatCredits(-405) === '-¥ 4.05', `unexpected negative format: ${formatCredits(-405)}`);
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
