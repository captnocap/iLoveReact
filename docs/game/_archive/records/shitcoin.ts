import type { DocIndex } from '../types';

export const shitcoin: DocIndex = {
  name: 'shitcoin',
  file: 'shitcoin.md',
  cart: 'cart/shitcoin/index.tsx',
  purpose: ['game_loop', 'persistence', 'ui', 'scripting', 'host_bridge', 'telemetry'],
  summary:
    'A shitcoin trading tycoon: an OS-shell UI (desktop, windows, taskbar, nested browser with per-tab routing) over a hot-path Zig-native AMM market sim and a cold-path TypeScript meta-system layer, bridged into React hooks by a sim.ts facade, with IFTTT automation scripts, achievements, and a classifier/theme/skin system.',
  interfaces: [
    {
      name: 'sim',
      purpose: ['game_loop', 'host_bridge', 'telemetry'],
      kind: 'module',
      sourceFile: 'cart/shitcoin/sim.ts',
      description:
        'Hot-path cache + hook facade. A single drainFrame() rAF loop (30 Hz notification cap) drains Zig AMM tape, polls snapshots, runs the cold engine, notifies listener sets, and exposes the sim.* API plus useXxx() hooks.',
      dependsOn: ['sim_engine', 'zigCall'],
      consumes: ['__zig_call', 'sim:tokens', 'sim:player', 'sim:npcs:init', 'sim:trade:reset', 'sim:trade', 'sim:wallet'],
      emits: ['sim:trade'],
      consumers: ['cart/shitcoin/components', 'cart/shitcoin/ifttt_sim.ts'],
      status: 'live',
    },
    {
      name: 'drainFrame',
      purpose: ['game_loop', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/shitcoin/sim.ts',
      description:
        'The rAF loop: drains up to 64 AMM tape events/frame from Zig; every 6 frames (~5 Hz) pulls price snapshots; every 30 frames (~1 Hz) pulls market/time/wallet/holdings/staking snapshots and runs engine.tickCold(); then notifies listener sets (generic, token-specific, market, wallet, trade, staking).',
      dependsOn: ['sim_engine', 'zigCall'],
      status: 'live',
    },
    {
      name: 'useSub / useWallet / useXxx hooks',
      purpose: ['game_loop', 'ui'],
      kind: 'hook',
      sourceFile: 'cart/shitcoin/sim.ts',
      description:
        'Thin hook wrappers: useSub() starts the rAF loop on first mount and subscribes to a listener set; useWallet/useMarket/useTrade/useStaking etc. each subscribe to a module-level listener Set and return the cached snapshot.',
      dependsOn: ['drainFrame'],
      status: 'live',
    },
    {
      name: 'sim_engine',
      purpose: ['game_loop', 'persistence'],
      kind: 'module',
      sourceFile: 'cart/shitcoin/sim_engine.ts',
      description:
        'Cold-content engine ticked at ~1 Hz: deterministic PRNG-driven meta-systems — staking (7 recipes), upgrades (40+ shop items, 8 hardware slots), mining rigs (cap 8), LP positions (cap 16), pump favors, reputation, token websites, ad slots, CEXes (5), social feed (4096-ring whale-watch), Telegram (32 channels), forum boards (20), news (256-ring), alpha leaks (64-ring).',
      consumes: ['wallet_debit_usd', 'wallet_credit_usd', 'apply_mining_yield', 'pool_take_lp_fees'],
      consumers: ['cart/shitcoin/sim.ts'],
      status: 'live',
    },
    {
      name: 'zigCall',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/shitcoin/sim.ts',
      description:
        'zigCall(fn, ...args) -> __zig_call(\'sim\', fn, ...args). The exclusive bridge to the Zig sim, called hundreds of times per second. Wraps current_price/buy/sell/quote/reset/snapshot_*/drain_tape/apply_* and the full Zig fn list.',
      consumes: ['__zig_call'],
      status: 'live',
    },
    {
      name: 'ifttt_sim',
      purpose: ['scripting', 'host_bridge'],
      kind: 'module',
      sourceFile: 'cart/shitcoin/ifttt_sim.ts',
      description:
        'IFTTT bridge (side-effect import in index.tsx). Registers sim trigger sources (sim:trade:executed:buy/sell[:id], sim:trade:executed, sim:trade:reset, sim:wallet:milestone:<usd>, sim:wallet:bankrupted, ach:<id>) and action verbs (trade:buy/sell, stake:harvest/stake/unstake, ach:emit, notify) onto the global IFTTT registry.',
      dependsOn: ['sim'],
      emits: ['sim:trade:executed', 'sim:wallet:milestone', 'sim:wallet:bankrupted', 'ach:<id>'],
      consumers: ['cart/shitcoin/index.tsx'],
      status: 'live',
    },
    {
      name: 'achievements',
      purpose: ['persistence', 'telemetry'],
      kind: 'module',
      sourceFile: 'cart/shitcoin/achievements.ts',
      description:
        '8 achievements (FirstTrade, 100Trades, FirstHarvest, Millionaire, DiamondHands, Bankrupt, PaperHands, FirstBotBuy), file-persisted to ./shitcoin_achievements.json keyed by player wallet address. API: setActivePlayer/progress/unlock/isUnlocked/getProgress/onUnlock. Survives sim.reset() — forever progression.',
      consumes: ['__fs_read', '__fs_write', 'sim:player'],
      emits: ['./shitcoin_achievements.json'],
      consumers: ['cart/shitcoin/index.tsx'],
      status: 'live',
    },
    {
      name: 'useScriptRules',
      purpose: ['scripting', 'persistence'],
      kind: 'hook',
      sourceFile: 'cart/shitcoin/useScriptRules.ts',
      description:
        'Script rule storage. ScriptRule = {id,label,enabled,triggerSpec,actionSpec,args,recentFires}. File-persisted to ./shitcoin_scripts.json keyed by (playerAddress -> appId). API: setActivePlayer/getRules/addRule/updateRule/removeRule/recordFire/useScriptRules. resolveSpec(spec,args) substitutes $name placeholders.',
      consumes: ['__fs_read', '__fs_write'],
      emits: ['./shitcoin_scripts.json'],
      consumers: ['cart/shitcoin/components/desktop/apps/ScriptApp.tsx'],
      status: 'live',
    },
    {
      name: 'Desktop',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/Desktop.tsx',
      description:
        'Window manager owning all window state (windows[], z-order, focus, minimize, maximize with prevRect snapshot/restore), icon grid, taskbar, start menu, and CRT filter. Title-bar drag via framework pointer capture. Reads useHardwareTier(\'monitor\') to wrap the tree in <Filter shader="crt"> when tier < 2.',
      dependsOn: ['Window', 'useDesktopApps', 'useHardwareTier'],
      status: 'live',
    },
    {
      name: 'Window',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/Window.tsx',
      description:
        'Pure-render window chrome: receives x,y,w,h,z,focused,maximized + drag callbacks; renders absolute-positioned title bar, min/max/close.',
      status: 'live',
    },
    {
      name: 'Browser',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/browser/Browser.tsx',
      description:
        'A desktop app inside a Window: owns a tab strip + per-tab <Router local> with independent back/forward history. All tabs stay mounted; inactive ones collapse to height:0/overflow:hidden so history survives tab switching. memo(BrowserImpl) so Desktop drag re-renders don\'t propagate. Has a /dev route with reference docs.',
      dependsOn: ['Router'],
      status: 'live',
    },
    {
      name: 'useDesktopApps / BASE_APPS / GATED_APPS',
      purpose: ['ui', 'format'],
      kind: 'registry',
      sourceFile: 'cart/shitcoin/components/desktop/icons.tsx',
      description: 'App registry (BASE_APPS + GATED_APPS) and the useDesktopApps() hook that resolves the launchable app list.',
      status: 'live',
    },
    {
      name: 'ScriptApp',
      purpose: ['scripting', 'ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/apps/ScriptApp.tsx',
      description:
        'Generic IFTTT rule editor shell. Owns useScriptRules(appId), add/update/remove rules, per-rule <RuleRunner> mounting useIFTTT. SniperBot and ArbBot are thin wrappers over it with template trigger/action specs.',
      dependsOn: ['useScriptRules', 'useIFTTT'],
      status: 'live',
    },
    {
      name: 'AchievementsListener',
      purpose: ['telemetry', 'scripting', 'ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/apps/AchievementsListener.tsx',
      description: 'Invisible component mounting the IFTTT achievement bindings.',
      dependsOn: ['achievements', 'useIFTTT'],
      status: 'live',
    },
    {
      name: 'Telegram',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/apps/Telegram.tsx',
      description: 'Channel list + message pane. Uses useTGChannels().',
      status: 'live',
    },
    {
      name: 'MiningRig',
      purpose: ['ui', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/desktop/apps/MiningRig.tsx',
      description: 'Rig list + debug install buttons. Uses useMiningRigs().',
      status: 'live',
    },
    {
      name: 'DexCard',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/dex-card/DexCard.tsx',
      description: 'Buy/sell swap card. DEX skin variants: uniswap/pancake/sushi/dextools/etherscan.',
      status: 'live',
    },
    {
      name: 'WalletPanel',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/wallet/WalletPanel.tsx',
      description: 'Wallet balance + holdings list. Skin variants: metamask/phantom/rabby.',
      status: 'live',
    },
    {
      name: 'StakingPool',
      purpose: ['ui', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/shitcoin/components/staking/StakingPool.tsx',
      description: 'Yield farm card: APR, stake, harvest.',
      status: 'live',
    },
    {
      name: 'classifier / theme tokens',
      purpose: ['ui', 'color'],
      kind: 'registry',
      sourceFile: 'cart/shitcoin/style.cls.ts',
      description:
        'Global classifier registry (~35 named UI components with theme-token styles + variant branches). APP_COLORS/APP_STYLES (theme.ts) are partial palettes injected at root via <ThemeProvider>; styles reference theme tokens like theme:surface resolved at render time. Variant families: DEX, Wallet, OS, Browser.',
      status: 'live',
    },
    {
      name: 'Skin / SkinProvider / SKINS',
      purpose: ['ui', 'color'],
      kind: 'utility',
      sourceFile: 'cart/shitcoin/components/shared/skins.ts',
      description:
        'A Skin is {variant, colors, styles}. applySkin(key) calls setVariant()+setTokens()+setStyleTokens() to switch the entire UI appearance; SkinProvider wraps a subtree and applies a skin on mount.',
      status: 'live',
    },
    {
      name: 'initSteamAdapter',
      purpose: ['telemetry', 'persistence'],
      kind: 'utility',
      sourceFile: 'cart/shitcoin/adapters/steam.ts',
      description:
        'Steamworks adapter stub: maps achievement IDs to Steam keys; returns an onUnlock subscription (currently no-op until Steamworks is linked).',
      dependsOn: ['achievements'],
      status: 'dormant',
    },
  ],
  patterns: [
    {
      name: 'Hot/cold sim split behind a facade',
      purpose: ['game_loop', 'host_bridge'],
      description:
        'Hot path (Zig-native AMM at frame rate: prices, NPC trades, wallet, tape) vs cold path (TS meta-systems ticked ~1 Hz: staking, mining, LP, social, news, CEX), unified by the sim.ts facade that hides the split behind React hooks.',
      examples: ['shitcoin'],
      promoteTo: 'sim',
      status: 'recurring',
    },
    {
      name: 'Drain frame + listener sets',
      purpose: ['game_loop', 'ui'],
      description:
        'A single rAF drainFrame loop pulls tape/snapshots/cold-ticks from Zig and notifies module-level Set<()=>void> per concern (wallet, market, trade, staking); hooks subscribe via useSub. Keeps per-frame Zig traffic out of React except at notify cadence.',
      examples: ['shitcoin'],
      status: 'recurring',
    },
    {
      name: 'Single host bridge fn (__zig_call)',
      purpose: ['host_bridge'],
      description:
        'All Zig sim traffic funnels through one zigCall(fn,...) wrapper over __zig_call(\'sim\', fn, ...); the entire Zig surface is a string-keyed function table.',
      examples: ['shitcoin'],
      promoteTo: 'zigCall',
      status: 'recurring',
    },
    {
      name: 'IFTTT rule + script rule',
      purpose: ['scripting', 'persistence'],
      description:
        'A {triggerSpec, actionSpec} pair registered globally; triggers subscribe to bus events, actions call sim methods. A script rule is a persisted IFTTT rule per (player, app) with an audit log (recentFires).',
      examples: ['shitcoin', 'ScriptApp'],
      status: 'recurring',
    },
    {
      name: 'Classifier + theme-token skin sheets',
      purpose: ['ui', 'color'],
      description:
        'Every visual component has a .tsx logic file + a .cls.ts skin sheet; classifier() registers named UI factories with variant branches and theme-token styles (theme:surface) resolved at render time; a Skin bundle switches the whole UI.',
      examples: ['shitcoin', 'DexCard.cls.ts', 'Window.cls.ts'],
      status: 'recurring',
    },
    {
      name: 'Local-router browser tabs',
      purpose: ['ui'],
      description:
        'Each browser tab mounts its own <Router local> with independent back/forward history; inactive tabs stay mounted but height-collapsed so history survives switching.',
      examples: ['shitcoin', 'Browser'],
      status: 'recurring',
    },
    {
      name: 'fs-JSON persistence keyed by player',
      purpose: ['persistence'],
      description:
        '__fs_read/__fs_write to JSON files keyed by wallet address — NOT localStorage. Used for achievements and script rules; survives sim.reset().',
      examples: ['shitcoin', 'achievements', 'useScriptRules'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'global skin store breaks concurrent skins',
      purpose: ['ui', 'maintenance'],
      description:
        'setVariant/setTokens write into a GLOBAL store, so concurrent skins across tabs/windows are a known limitation — switching one skins the whole UI.',
      evidence: ['shitcoin.md skin system caveat: setVariant/setTokens write into a global store'],
      severity: 'medium',
    },
    {
      name: 'CEX trading unimplemented',
      purpose: ['game_loop'],
      description:
        'CEX balances and actions are stubbed/unimplemented; player balance stubs exist but CEX actions do nothing.',
      evidence: ['shitcoin.md: "Player balance stubs exist but CEX actions are unimplemented."'],
      severity: 'low',
    },
    {
      name: 'Steam adapter is a no-op stub',
      purpose: ['telemetry'],
      description:
        'adapters/steam.ts maps achievement IDs to Steam keys but initSteamAdapter is no-op until Steamworks is linked.',
      evidence: ['shitcoin.md: Steam adapter is a stub, currently no-op'],
      severity: 'low',
    },
    {
      name: 'only __zig_call/__fs_*/ffi host fns used',
      purpose: ['host_bridge'],
      description:
        'No __http_*, __store_*, __exec, __clipboard, __crypto, __mermaidRender, __openWindow, __registerDispatch. No network/HTTP, no real blockchain, no localStorage, no DOM APIs except globalThis.addEventListener(\'keydown\') for the Ctrl+Shift+C dev hotkey.',
      evidence: ['shitcoin.md "What this cart does NOT do" + "No other host functions"'],
      severity: 'low',
    },
    {
      name: 'zigCall returns null when host absent',
      purpose: ['host_bridge'],
      description:
        'zigCall returns null if __zig_call is not a function; callers must tolerate null snapshots (e.g. useWallet returns Wallet | null).',
      evidence: ['shitcoin.md zigCall: "if (typeof host.__zig_call !== \'function\') return null;"'],
      severity: 'low',
    },
  ],
};
