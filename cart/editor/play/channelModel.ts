// Criminal Careers play-channel state.
//
// React owns presentation in the editor's dynamic /play route, but it does not
// own three unrelated copies of game state. One record/event reducer feeds the
// Gigwork wall, personal phone, and identity readout. Each channel carries its
// own monotonic revision so a future native document compiler can schedule the
// exact dirty surface without changing the gameplay-facing interface here.

export type PlayChannelId = 'gigwork' | 'phone' | 'identity';
export type GigTone = 'cyan' | 'amber' | 'violet' | 'red' | 'green';
export type PhoneApp = 'feed' | 'messages' | 'market';

export interface GigDefinition {
  id: string;
  title: string;
  strap: string;
  detail: string;
  client: string;
  payoutCents: number;
  risk: number;
  tone: GigTone;
}

export interface FeedPost {
  id: string;
  author: string;
  handle: string;
  age: string;
  body: string;
  reactions: number;
  reposts: number;
  replies: number;
  tone: GigTone;
}

export interface ChannelNotice {
  id: string;
  title: string;
  detail: string;
  tone: GigTone;
}

export interface PlayChannelState {
  revisions: Record<PlayChannelId, number>;
  selectedGigId: string;
  activeGigId: string | null;
  completedGigIds: readonly string[];
  creditsCents: number;
  health: number;
  sanity: number;
  compliance: number;
  notoriety: number;
  warrants: number;
  unread: number;
  terminalOpen: boolean;
  phoneOpen: boolean;
  phoneApp: PhoneApp;
  phoneWindowStart: number;
  marketTick: number;
  marketPriceCents: number;
  sequence: number;
  feed: readonly FeedPost[];
  notices: readonly ChannelNotice[];
}

export type PlayChannelAction =
  | { type: 'select-gig'; gigId: string }
  | { type: 'accept-selected' }
  | { type: 'complete-active' }
  | { type: 'tick-market' }
  | { type: 'toggle-terminal' }
  | { type: 'set-terminal-open'; open: boolean }
  | { type: 'toggle-phone' }
  | { type: 'set-phone-open'; open: boolean }
  | { type: 'set-phone-app'; app: PhoneApp }
  | { type: 'page-phone'; delta: number }
  | { type: 'mark-phone-read' }
  | { type: 'dismiss-surfaces' };

export const PLAY_CHANNEL_TUNING = {
  marketTickMs: 2_000,
  phoneWindowSize: 5,
  maxFeedRows: 32,
  startingCreditsCents: 2_367,
  startingMarketPriceCents: 2_367,
  marketDeltasCents: [7, -4, 12, -9, 5, 3, -6, 10] as readonly number[],
} as const;

export const GIGS: readonly GigDefinition[] = [
  { id: 'fishes', title: 'SWIMMING WITH THE FISHES', strap: 'wet work', detail: 'Recover a sealed package before the tide turns witness.', client: 'South Jetty Mutual', payoutCents: 8_400, risk: 3, tone: 'cyan' },
  { id: 'felony-finder', title: 'FELONY FINDER', strap: 'skip tracing', detail: 'Locate a parole ghost using only public mistakes and old favors.', client: 'Vera Bail Group', payoutCents: 5_600, risk: 2, tone: 'amber' },
  { id: 'flockbook', title: 'FLOCKBOOK', strap: 'like. obey. repeat.', detail: 'Seed a grievance, steer the replies, and sell the resulting panic.', client: 'Patriot Growth LLC', payoutCents: 3_200, risk: 2, tone: 'cyan' },
  { id: 'drown', title: 'DROWN', strap: 'liquidation services', detail: 'Sink a reputation without leaving fingerprints on the timeline.', client: 'DROWN Official', payoutCents: 6_100, risk: 3, tone: 'green' },
  { id: 'pills-r-us', title: 'PILLS-R-US', strap: 'your pain. our profit.', detail: 'Move a mislabeled sample case across three compliance zones.', client: 'ReliefDirect', payoutCents: 7_700, risk: 4, tone: 'violet' },
  { id: 'spray-pray', title: 'SPRAY AND PRAY', strap: 'urban renewal', detail: 'Replace a rival mural before the morning commuter cycle.', client: 'Civic Color Front', payoutCents: 2_900, risk: 1, tone: 'violet' },
  { id: 'shoplifter', title: 'SHOPLIFTER', strap: 'lift more. pay less.', detail: 'Recover inventory the store insists it never stocked.', client: 'Aisle Nine Union', payoutCents: 4_500, risk: 2, tone: 'amber' },
  { id: 'warrant-buffet', title: 'WARRANT BUFFET', strap: 'all you can flee', detail: 'Erase one camera chain while every precinct is looking elsewhere.', client: 'Public Defender DAO', payoutCents: 9_200, risk: 5, tone: 'red' },
  { id: 'why-c', title: 'WHY-C', strap: 'vitamin chaos', detail: 'Redirect a supplement shipment and preserve the wellness narrative.', client: 'Why-C Holdings', payoutCents: 4_800, risk: 2, tone: 'cyan' },
  { id: 'prophet-margin', title: 'PROPHET MARGIN', strap: 'predict. prey. profit.', detail: 'Make tomorrow\'s rumor true before today\'s market closes.', client: 'Oracle Street', payoutCents: 8_600, risk: 4, tone: 'green' },
  { id: 'alllots', title: 'AILLOTS', strap: 'bid low. win souls.', detail: 'Depress one parcel auction without disturbing the neighboring lots.', client: 'AllLots Municipal', payoutCents: 5_100, risk: 3, tone: 'amber' },
  { id: 'condemnation', title: 'CONDEMNATION', strap: 'clearance by neglect', detail: 'Turn a livable block into an emergency redevelopment opportunity.', client: 'Renewal Partners', payoutCents: 12_400, risk: 5, tone: 'red' },
  { id: 'squatter', title: 'SQUATTER', strap: 'live rent free', detail: 'Hold a property long enough for ownership to become negotiable.', client: 'Tenants Unknown', payoutCents: 6_800, risk: 3, tone: 'green' },
  { id: 'organ-trail', title: 'ORGAN TRAIL', strap: 'donate or die', detail: 'Escort a temperature-sensitive cooler through private checkpoints.', client: 'Mercy Logistics', payoutCents: 11_100, risk: 5, tone: 'amber' },
  { id: 'drought', title: 'BEYOND A REASONABLE DROUGHT', strap: 'stay thirsty', detail: 'Make a water audit arrive at the most profitable conclusion.', client: 'Regional Aqua Board', payoutCents: 7_300, risk: 3, tone: 'cyan' },
  { id: 'terms', title: 'TERMS OF WORSHIP', strap: 'click to agree', detail: 'Recover a congregation list before the next terms update.', client: 'Blessed Platform', payoutCents: 4_200, risk: 2, tone: 'violet' },
  { id: 'kyc', title: 'KYC', strap: 'know your customer', detail: 'Prove a customer exists without introducing them to reality.', client: 'Identity Orchard', payoutCents: 5_900, risk: 3, tone: 'cyan' },
  { id: 'public-offender', title: 'PUBLIC OFFENDER', strap: 'taxes are theft', detail: 'Deliver one sealed civic record to the courthouse basement.', client: 'Concerned Taxpayers', payoutCents: 6_600, risk: 4, tone: 'amber' },
  { id: 'hot-fixed', title: 'HOT FIXED', strap: 'we fix it hot', detail: 'Patch a deployed kiosk before its audit log catches up.', client: 'Emergency Systems', payoutCents: 7_900, risk: 4, tone: 'red' },
  { id: 'genuinely', title: 'GENUINELY', strap: 'be real. for a fee.', detail: 'Manufacture authenticity for a creator with declining engagement.', client: 'Human Presence Co.', payoutCents: 3_700, risk: 1, tone: 'green' },
];

const INITIAL_FEED: readonly FeedPost[] = [
  { id: 'post-1', author: 'PatriotPat3000', handle: '@freedom_asset', age: '2m', body: 'Another day, another win for freedom. The algorithm agrees.', reactions: 12, reposts: 3, replies: 1, tone: 'cyan' },
  { id: 'post-2', author: 'GovPositiveBot', handle: '@civic_happiness', age: '5m', body: 'REMINDER: Happiness is mandatory. Report negativity to earn points.', reactions: 8, reposts: 1, replies: 0, tone: 'violet' },
  { id: 'post-3', author: 'DROWN Official', handle: '@drown_help', age: '7m', body: 'Need something removed? We can help. Fast. Clean. Final.', reactions: 21, reposts: 4, replies: 0, tone: 'green' },
  { id: 'post-4', author: 'WokeAndBroke', handle: '@rent_is_theft', age: '11m', body: 'Can\'t pay rent. Might sell kidney. Thread below.', reactions: 2, reposts: 0, replies: 7, tone: 'amber' },
  { id: 'post-5', author: 'FlockBook FactCheck', handle: '@verified_truth', age: '13m', body: 'False: Rest is human right. True: Rest is privilege.', reactions: 15, reposts: 2, replies: 4, tone: 'cyan' },
  { id: 'post-6', author: 'MarginProphet', handle: '@tomorrow_first', age: '18m', body: 'The correction is already priced in. The panic is not.', reactions: 33, reposts: 12, replies: 9, tone: 'green' },
  { id: 'post-7', author: 'Neighborhood Watch+', handle: '@premium_safety', age: '24m', body: 'Three unfamiliar faces detected. Upgrade to identify them.', reactions: 7, reposts: 2, replies: 3, tone: 'red' },
  { id: 'post-8', author: 'AllLots Alerts', handle: '@parcel_drop', age: '31m', body: 'Foreclosure inventory refreshed. Human occupancy may vary.', reactions: 19, reposts: 6, replies: 2, tone: 'amber' },
  { id: 'post-9', author: 'Terms of Worship', handle: '@agree_below', age: '42m', body: 'We updated salvation. Continued existence constitutes consent.', reactions: 44, reposts: 18, replies: 0, tone: 'violet' },
  { id: 'post-10', author: 'Public Defender DAO', handle: '@jury_pool', age: '51m', body: 'Today\'s legal defense yield is now variable-rate.', reactions: 10, reposts: 5, replies: 6, tone: 'cyan' },
  { id: 'post-11', author: 'Why-C Wellness', handle: '@megadose', age: '1h', body: 'If one capsule is healthy, twelve are twelve times healthier.', reactions: 27, reposts: 8, replies: 12, tone: 'green' },
  { id: 'post-12', author: 'Civic Color Front', handle: '@clean_wall', age: '2h', body: 'Unauthorized color is visual trespass. Report expressive surfaces.', reactions: 4, reposts: 1, replies: 15, tone: 'red' },
];

const INITIAL_NOTICES: readonly ChannelNotice[] = [
  { id: 'notice-message', title: 'NEW MESSAGE', detail: 'FlockBook sent 37 notifications', tone: 'cyan' },
  { id: 'notice-warrant', title: 'WARRANT ALERT', detail: '3 active warrants · click to review', tone: 'red' },
  { id: 'notice-payment', title: 'PAYMENT PENDING', detail: 'AllLots escrow awaiting proof', tone: 'amber' },
  { id: 'notice-reputation', title: 'REPUTATION DROP', detail: 'Complaint verified · -15 social credit', tone: 'red' },
];

function bump(revisions: PlayChannelState['revisions'], channels: readonly PlayChannelId[]): PlayChannelState['revisions'] {
  const next = { ...revisions };
  for (const channel of channels) next[channel] += 1;
  return next;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function gigById(id: string | null): GigDefinition | null {
  if (!id) return null;
  return GIGS.find((gig) => gig.id === id) ?? null;
}

export function formatCredits(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}¥ ${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, '0')}`;
}

export function channelTextureKey(channel: PlayChannelId, owner = 'public'): string {
  return `criminal-careers:${channel}:${owner}`;
}

export function initialPlayChannelState(): PlayChannelState {
  return {
    revisions: { gigwork: 1, phone: 1, identity: 1 },
    selectedGigId: 'flockbook',
    activeGigId: null,
    completedGigIds: [],
    creditsCents: PLAY_CHANNEL_TUNING.startingCreditsCents,
    health: 42,
    sanity: 31,
    compliance: 68,
    notoriety: 2,
    warrants: 3,
    unread: 37,
    terminalOpen: true,
    phoneOpen: true,
    phoneApp: 'feed',
    phoneWindowStart: 0,
    marketTick: 0,
    marketPriceCents: PLAY_CHANNEL_TUNING.startingMarketPriceCents,
    sequence: 100,
    feed: [...INITIAL_FEED],
    notices: [...INITIAL_NOTICES],
  };
}

export function visiblePhonePosts(state: PlayChannelState): readonly FeedPost[] {
  const start = Math.max(0, Math.min(state.phoneWindowStart, Math.max(0, state.feed.length - PLAY_CHANNEL_TUNING.phoneWindowSize)));
  return state.feed.slice(start, start + PLAY_CHANNEL_TUNING.phoneWindowSize);
}

export function dirtyChannels(before: PlayChannelState, after: PlayChannelState): readonly PlayChannelId[] {
  const channels: PlayChannelId[] = [];
  if (before.revisions.gigwork !== after.revisions.gigwork) channels.push('gigwork');
  if (before.revisions.phone !== after.revisions.phone) channels.push('phone');
  if (before.revisions.identity !== after.revisions.identity) channels.push('identity');
  return channels;
}

export function playChannelReducer(state: PlayChannelState, action: PlayChannelAction): PlayChannelState {
  switch (action.type) {
    case 'select-gig': {
      if (action.gigId === state.selectedGigId || !gigById(action.gigId)) return state;
      return { ...state, selectedGigId: action.gigId, revisions: bump(state.revisions, ['gigwork']) };
    }
    case 'accept-selected': {
      const gig = gigById(state.selectedGigId);
      if (!gig || state.activeGigId === gig.id) return state;
      const sequence = state.sequence + 1;
      const post: FeedPost = {
        id: `contract-${sequence}`,
        author: 'Gigwork Dispatch',
        handle: '@contract_wire',
        age: 'now',
        body: `Contract armed: ${gig.title}. Client ${gig.client} is watching the clock.`,
        reactions: 0,
        reposts: 0,
        replies: 1,
        tone: gig.tone,
      };
      const notice: ChannelNotice = {
        id: `notice-contract-${sequence}`,
        title: 'CONTRACT ARMED',
        detail: `${gig.title} · ${formatCredits(gig.payoutCents)} on proof`,
        tone: gig.tone,
      };
      return {
        ...state,
        activeGigId: gig.id,
        sequence,
        unread: state.unread + 1,
        notoriety: clampPercent(state.notoriety + Math.max(1, gig.risk - 2)),
        feed: [post, ...state.feed].slice(0, PLAY_CHANNEL_TUNING.maxFeedRows),
        notices: [notice, ...state.notices].slice(0, 6),
        revisions: bump(state.revisions, ['gigwork', 'phone', 'identity']),
      };
    }
    case 'complete-active': {
      const gig = gigById(state.activeGigId);
      if (!gig) return state;
      const sequence = state.sequence + 1;
      const alreadyCompleted = state.completedGigIds.includes(gig.id);
      const post: FeedPost = {
        id: `payment-${sequence}`,
        author: 'Escrow Witness',
        handle: '@proof_of_work',
        age: 'now',
        body: `Payment released for ${gig.title}. Nobody involved admits why.`,
        reactions: 1,
        reposts: 0,
        replies: 0,
        tone: 'green',
      };
      return {
        ...state,
        activeGigId: null,
        sequence,
        creditsCents: state.creditsCents + gig.payoutCents,
        completedGigIds: alreadyCompleted ? state.completedGigIds : [...state.completedGigIds, gig.id],
        unread: state.unread + 1,
        compliance: clampPercent(state.compliance - gig.risk * 2),
        notoriety: clampPercent(state.notoriety + gig.risk),
        feed: [post, ...state.feed].slice(0, PLAY_CHANNEL_TUNING.maxFeedRows),
        notices: [{ id: `notice-paid-${sequence}`, title: 'PAYMENT RECEIVED', detail: `${formatCredits(gig.payoutCents)} · ${gig.client}`, tone: 'green' }, ...state.notices].slice(0, 6),
        revisions: bump(state.revisions, ['gigwork', 'phone', 'identity']),
      };
    }
    case 'tick-market': {
      const delta = PLAY_CHANNEL_TUNING.marketDeltasCents[state.marketTick % PLAY_CHANNEL_TUNING.marketDeltasCents.length] ?? 0;
      const phoneReadsMarket = state.phoneOpen && state.phoneApp === 'market';
      return {
        ...state,
        marketTick: state.marketTick + 1,
        marketPriceCents: Math.max(1, state.marketPriceCents + delta),
        revisions: bump(state.revisions, phoneReadsMarket ? ['gigwork', 'phone'] : ['gigwork']),
      };
    }
    case 'toggle-terminal':
      return { ...state, terminalOpen: !state.terminalOpen };
    case 'set-terminal-open':
      return state.terminalOpen === action.open ? state : { ...state, terminalOpen: action.open };
    case 'toggle-phone':
      return { ...state, phoneOpen: !state.phoneOpen };
    case 'set-phone-open':
      return state.phoneOpen === action.open ? state : { ...state, phoneOpen: action.open };
    case 'set-phone-app':
      if (state.phoneApp === action.app) return state;
      return { ...state, phoneApp: action.app, phoneWindowStart: 0, revisions: bump(state.revisions, ['phone']) };
    case 'page-phone': {
      if (state.phoneApp !== 'feed' || !Number.isFinite(action.delta) || action.delta === 0) return state;
      const maxStart = Math.max(0, state.feed.length - PLAY_CHANNEL_TUNING.phoneWindowSize);
      const nextStart = Math.max(0, Math.min(maxStart, state.phoneWindowStart + Math.sign(action.delta) * PLAY_CHANNEL_TUNING.phoneWindowSize));
      if (nextStart === state.phoneWindowStart) return state;
      return { ...state, phoneWindowStart: nextStart, revisions: bump(state.revisions, ['phone']) };
    }
    case 'mark-phone-read':
      if (state.unread === 0) return state;
      return { ...state, unread: 0, revisions: bump(state.revisions, ['phone', 'identity']) };
    case 'dismiss-surfaces':
      if (!state.phoneOpen && !state.terminalOpen) return state;
      return { ...state, phoneOpen: false, terminalOpen: false };
    default:
      return state;
  }
}
