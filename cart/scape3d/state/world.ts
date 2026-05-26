import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { busOn } from '@reactjit/runtime/hooks/useIFTTT';
import { decorAt } from '../world/tiles';
import { featureAt } from '../world/atlas';
import { THINGYMAJIGGERS } from '../thingymajiggers';
import { findPath, nearestWalkable } from '../world/pathfinding';
import { buildDecorWindow, buildTileWindow, HALF, type Decor } from '../world/window';
import { unproject, type Cam, type Rect } from '../world/projection';
import type { EvidenceAxis, LifeState, Player, VisualSignature } from '../design';
import {
  adjustArmor,
  adjustHealth,
  adjustMoney,
  adjustSuspicionAxis,
  advancePlayer,
  createInitialPlayerState,
  increaseHigh,
  setCostume,
  setHigh,
  setLifeState,
  type ScapePlayerState,
} from './player';
import { advanceClock, clockHM, createClock, formatClock, type GameClock } from './clock';
import {
  createInitialInventoryState,
  dropInHand,
  equipInventoryItem,
  inHandSlot,
  inventorySlots,
  nearestWorldItem,
  pickupWorldItem,
  stashInHand,
  emptyStash,
  type InventorySlot,
  type InventoryState,
} from '../systems/inventory';
import { buildDoors, closedDoorBlockers, nearestDoor, toggleDoor, type Door } from '../systems/doors';
import { availableActions, targetLabel, targetPos, type ActionTarget, type AttackContext, type WeaponContext } from '../systems/actions';
import { PROXIMITY_RANGE } from '../systems/interactions';
import type { ActionMenuState } from '../ui/ContextMenu';

const NPC_SPEED = 1.1;
const ROT_SPEED = 1.9;
const PITCH_SPEED = 0.7;

export type EntKind = 'storefront' | 'sign' | 'npc';

export interface Ent {
  id: string;
  kind: EntKind;
  x: number;
  y: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  tint: number;
  label: string;
  blocks: boolean;
  quest?: boolean;
  name?: string;
  dead?: boolean; // downed by an attack — stops wandering, renders as a body
}

export function makeEntities(): Ent[] {
  const e: Ent[] = [];
  const put = (p: Partial<Ent> & { kind: EntKind; x: number; y: number; label: string; tint: number }) =>
    e.push({ id: `${p.kind}-${e.length}`, hx: p.x, hy: p.y, tx: p.x, ty: p.y, blocks: true, ...p });
  put({ kind: 'storefront', x: 19.5, y: 14.5, tint: 0, label: 'EL POLLO LOCO-ISH — taco window, grease-fogged glass, OPEN 25 HRS.' });
  put({ kind: 'storefront', x: 32.5, y: 14.5, tint: 1, label: 'CASH 4 GOLD — barred pawn shop, half the neon letters dead.' });
  put({ kind: 'npc', x: 24.5, y: 22.5, tint: 5, blocks: false, quest: true, name: "Roach", label: 'Roach is vibrating in place near the fountain. (click to talk)' });
  put({ kind: 'npc', x: 20.5, y: 20.5, tint: 1, blocks: false, label: 'Promoter: "Yo yo — VIP list, you on it, I PUT you on it, c\'mon."' });
  put({ kind: 'npc', x: 29.5, y: 27.5, tint: 2, blocks: false, label: 'Corner kid: "...you good? you straight? you need somethin\'?"' });
  put({ kind: 'npc', x: 26.5, y: 25.5, tint: 0, blocks: false, label: 'Tweaker: "the PALM TREES are WATCHING bro I\'m not even playin\'."' });
  put({ kind: 'npc', x: 18.5, y: 26.5, tint: 3, blocks: false, label: 'Guy on a bench: "spare a couple bucks? for the bus. it\'s not for the bus."' });
  return e;
}

type KeyState = Record<string, boolean>;

export type ChatGate = {
  chatOpenRef: MutableRefObject<boolean>;
  openQuestChat: (npc: Ent) => void;
};

export type ScapeWorld = {
  sim: ScapePlayerState;
  player: Player;
  playerActions: PlayerDebugActions;
  inventory: InventoryState;
  inventorySlots: InventorySlot[];
  inHand: InventorySlot | null;
  inventoryActions: InventoryActions;
  clock: string;
  rect: Rect;
  cam: Cam;
  rectRef: MutableRefObject<Rect>;
  winOX: number;
  winOY: number;
  winTiles: number[];
  decorList: Decor[];
  entities: Ent[];
  doors: Door[];
  examineText: string | null;
  menu: ActionMenuState | null;
  onSceneDown: (payload: any) => void;
  onSceneRightClick: (payload: any) => void;
  runAction: (interactionKey: string) => void;
  closeMenu: () => void;
};

export type PlayerDebugActions = {
  adjustHealth: (delta: number) => void;
  adjustArmor: (delta: number) => void;
  adjustMoney: (delta: number) => void;
  adjustSuspicionAxis: (axis: EvidenceAxis, delta: number) => void;
  setLifeState: (lifeState: LifeState) => void;
  setCostume: (costume: Partial<VisualSignature>) => void;
  adjustHigh: (delta: number) => void;
};

export type InventoryActions = {
  equip: (instanceId: number) => void;
  dropInHand: () => void;
};

function useSceneControls(
  keys: MutableRefObject<KeyState>,
  sim: MutableRefObject<ScapePlayerState>,
  inventory: MutableRefObject<InventoryState>,
  refresh: () => void,
  disabledRef: MutableRefObject<boolean>,
): void {
  useEffect(() => {
    const set = (ev: any, down: boolean) => {
      if (disabledRef.current) return;
      const k = String(ev?.key ?? '').toLowerCase();
      if (k === 'w' || k === 'a' || k === 's' || k === 'd') keys.current[k] = down;
      if (down && k === 'h') increaseHigh(sim.current);
      if (down && k === 'q') {
        dropInHand(sim.current.body, inventory.current, sim.current.px + Math.cos(sim.current.body.facing) * 0.9, sim.current.py + Math.sin(sim.current.body.facing) * 0.9);
        refresh();
      }
    };
    const offD = busOn('__keydown', (e) => set(e, true));
    const offU = busOn('__keyup', (e) => set(e, false));
    return () => {
      offD();
      offU();
    };
  }, [disabledRef, inventory, keys, refresh, sim]);
}

function useWorldLoop({
  entsRef,
  staticBlockers,
  sim,
  clock,
  keys,
  force,
}: {
  entsRef: MutableRefObject<Ent[]>;
  staticBlockers: Set<string>;
  sim: MutableRefObject<ScapePlayerState>;
  clock: MutableRefObject<GameClock>;
  keys: MutableRefObject<KeyState>;
  force: Dispatch<SetStateAction<number>>;
}): void {
  useEffect(() => {
    const G: any = globalThis;
    const sched = G.requestAnimationFrame ? G.requestAnimationFrame.bind(G) : (fn: any) => setTimeout(fn, 16);
    const cancel = G.cancelAnimationFrame ? G.cancelAnimationFrame.bind(G) : clearTimeout;
    let handle: any = 0;
    let last = G.performance?.now?.() ?? Date.now();
    const tick = () => {
      const now = G.performance?.now?.() ?? Date.now();
      const dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000));
      last = now;
      advanceClock(clock.current, dt);
      const s = sim.current;
      const k = keys.current;
      if (k.a) s.yaw -= ROT_SPEED * dt;
      if (k.d) s.yaw += ROT_SPEED * dt;
      if (k.w) s.pitch = Math.min(0.86, s.pitch + PITCH_SPEED * dt);
      if (k.s) s.pitch = Math.max(0.40, s.pitch - PITCH_SPEED * dt);
      advancePlayer(s, dt);
      for (const e of entsRef.current) {
        if (e.kind !== 'npc' || e.quest || e.dead) continue;
        const dx = e.tx - e.x;
        const dy = e.ty - e.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.08) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * 2.2;
          const cand = nearestWalkable(Math.round(e.hx + Math.cos(ang) * rad), Math.round(e.hy + Math.sin(ang) * rad), staticBlockers);
          if (cand) {
            e.tx = cand.x + 0.5;
            e.ty = cand.y + 0.5;
          }
        } else {
          const tt = Math.min(1, (NPC_SPEED * dt) / d);
          e.x += dx * tt;
          e.y += dy * tt;
        }
      }
      force((nn) => (nn + 1) & 0xffff);
      handle = sched(tick);
    };
    handle = sched(tick);
    return () => cancel(handle);
  }, [clock, entsRef, force, keys, sim, staticBlockers]);
}

export function useScapeWorld(chat: ChatGate): ScapeWorld {
  const ents = useMemo(() => makeEntities(), []);
  const staticBlockers = useMemo(
    () => new Set(ents.filter((e) => e.blocks).map((e) => `${Math.floor(e.x)},${Math.floor(e.y)}`)),
    [ents],
  );
  const entsRef = useRef(ents);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1100, height: 720 });
  const keys = useRef<KeyState>({});
  const sim = useRef<ScapePlayerState>(createInitialPlayerState());
  const clock = useRef<GameClock>(createClock());
  const inventory = useRef<InventoryState>(createInitialInventoryState());
  const [, force] = useState(0);
  const examineRef = useRef<{ text: string; until: number } | null>(null);
  const refresh = useCallback(() => force((nn) => (nn + 1) & 0xffff), []);
  const doorsRef = useRef<Door[]>(buildDoors());
  const [menu, setMenu] = useState<ActionMenuState | null>(null);
  const menuTargetRef = useRef<ActionTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Live blockers = static entity tiles + every CLOSED door tile (recomputed at
  // call time so opening a door immediately makes its tile walkable).
  const liveBlockers = () => new Set<string>([...staticBlockers, ...closedDoorBlockers(doorsRef.current)]);

  useSceneControls(keys, sim, inventory, refresh, chat.chatOpenRef);
  useWorldLoop({ entsRef, staticBlockers, sim, clock, keys, force });

  const playerActions: PlayerDebugActions = {
    adjustHealth: (delta) => {
      adjustHealth(sim.current, delta);
      refresh();
    },
    adjustArmor: (delta) => {
      adjustArmor(sim.current, delta);
      refresh();
    },
    adjustMoney: (delta) => {
      adjustMoney(sim.current, delta);
      refresh();
    },
    adjustSuspicionAxis: (axis, delta) => {
      adjustSuspicionAxis(sim.current, axis, delta);
      refresh();
    },
    setLifeState: (lifeState) => {
      setLifeState(sim.current, lifeState);
      refresh();
    },
    setCostume: (costume) => {
      setCostume(sim.current, costume);
      refresh();
    },
    adjustHigh: (delta) => {
      setHigh(sim.current, sim.current.body.high.intensity + delta);
      refresh();
    },
  };

  const inventoryActions: InventoryActions = {
    equip: (instanceId) => {
      const text = equipInventoryItem(sim.current.body, inventory.current, instanceId);
      if (text) examineRef.current = { text, until: ((globalThis as any).performance?.now?.() ?? Date.now()) + 2200 };
      refresh();
    },
    dropInHand: () => {
      const s = sim.current;
      const text = dropInHand(s.body, inventory.current, s.px + Math.cos(s.body.facing) * 0.9, s.py + Math.sin(s.body.facing) * 0.9);
      if (text) examineRef.current = { text, until: ((globalThis as any).performance?.now?.() ?? Date.now()) + 2200 };
      refresh();
    },
  };

  const onSceneDown = (payload: any) => {
    if (chat.chatOpenRef.current) return;
    if (menu) {
      setMenu(null);
      return;
    }
    const r = rectRef.current;
    const sx = Number(payload?.x ?? 0) - r.x;
    const sy = Number(payload?.y ?? 0) - r.y;
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
    if (sx >= 12 && sx <= 286 && sy >= r.height - 260 && sy <= r.height - 12) return; // PlayerDebug panel
    if (sx >= r.width - 320 && sy <= 172) return; // top-right stats + weapon box
    if (sx >= r.width - 180 && sy >= r.height - 180) return; // bottom-right radar
    const s = sim.current;
    const world = unproject(sx, sy, s, r);
    const nearbyItem = nearestWorldItem(inventory.current.worldItems, world.x, world.y, 0.75);
    if (nearbyItem) {
      const playerDist = Math.hypot(nearbyItem.x - s.px, nearbyItem.y - s.py);
      if (playerDist <= 1.65) {
        const text = pickupWorldItem(s.body, inventory.current, nearbyItem.id);
        if (text) examineRef.current = { text, until: ((globalThis as any).performance?.now?.() ?? Date.now()) + 2400 };
        refresh();
      } else {
        s.path = findPath(s.px, s.py, nearbyItem.x, nearbyItem.y, liveBlockers());
        examineRef.current = { text: 'Walk closer to pick that up.', until: ((globalThis as any).performance?.now?.() ?? Date.now()) + 2200 };
      }
      return;
    }
    const door = nearestDoor(doorsRef.current, world.x, world.y, 0.75);
    if (door) {
      const dist = Math.hypot(door.x + 0.5 - s.px, door.y + 0.5 - s.py);
      if (dist <= PROXIMITY_RANGE.adjacent) {
        toggleDoor(door);
        refresh();
      } else {
        s.path = findPath(s.px, s.py, door.x + 0.5, door.y + 0.5, liveBlockers());
        examineRef.current = { text: 'Head over to the door.', until: ((globalThis as any).performance?.now?.() ?? Date.now()) + 2000 };
      }
      return;
    }
    let best: Ent | null = null;
    let bestD = 0.9;
    for (const e of entsRef.current) {
      const d = Math.hypot(e.x - world.x, e.y - world.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    const now = (globalThis as any).performance?.now?.() ?? Date.now();
    if (best && best.quest) {
      chat.openQuestChat(best);
      return;
    }
    if (best) {
      examineRef.current = { text: best.label, until: now + 3500 };
      return;
    }
    const tdec = decorAt(Math.floor(world.x), Math.floor(world.y));
    if (tdec && Math.hypot(Math.floor(world.x) + 0.5 - world.x, Math.floor(world.y) + 0.5 - world.y) < 0.7) {
      const decorText =
        tdec === 'palm'
          ? 'A scraggly palm, half its fronds dead. Very Miami.'
          : tdec === 'dumpster'
            ? "A dumpster. Something in it is leaking. Don't."
            : 'A buzzing neon sign, one letter flickering out.';
      examineRef.current = { text: decorText, until: now + 3500 };
      return;
    }
    s.path = findPath(s.px, s.py, world.x, world.y, liveBlockers());
  };

  // What the player clicked, resolved to an action target (door > NPC/object >
  // item > prop > bare ground). Priority mirrors onSceneDown's default-action order.
  const pickTarget = (wx: number, wy: number): ActionTarget => {
    const door = nearestDoor(doorsRef.current, wx, wy, 0.75);
    if (door) return { kind: 'door', door };
    let best: Ent | null = null;
    let bestD = 0.9;
    for (const e of entsRef.current) {
      const d = Math.hypot(e.x - wx, e.y - wy);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      if (best.kind === 'storefront') return { kind: 'storefront', ent: best };
      if (best.kind === 'sign') return { kind: 'sign', ent: best };
      return { kind: 'npc', ent: best };
    }
    const item = nearestWorldItem(inventory.current.worldItems, wx, wy, 0.75);
    if (item) return { kind: 'item', item };
    const feature = featureAt(Math.floor(wx), Math.floor(wy));
    if (feature) return { kind: 'feature', feature };
    const dec = decorAt(Math.floor(wx), Math.floor(wy));
    if (dec && Math.hypot(Math.floor(wx) + 0.5 - wx, Math.floor(wy) + 0.5 - wy) < 0.7) {
      return { kind: 'prop', prop: { x: Math.floor(wx) + 0.5, y: Math.floor(wy) + 0.5, kind: dec } };
    }
    return { kind: 'tile', x: Math.floor(wx), y: Math.floor(wy) };
  };

  // Snapshot everything the chance engine needs from the current player: held
  // weapon, combat skill, condition, the hour, and the live (closed-door) blockers
  // for line-of-sight. Built fresh per right-click so the % reflects where you stand.
  const buildAttackContext = (cur: ScapePlayerState): AttackContext => {
    const slot = inHandSlot(cur.body, inventory.current);
    let weapon: WeaponContext | null = null;
    if (slot && slot.module.type.category === 'weapon') {
      const ty = slot.module.type;
      const ranged = !!ty.ranged;
      weapon = {
        ranged,
        profile: ty.range ?? null,
        key: ranged ? 'shoot' : 'slash',
        label: `${ranged ? 'Shoot' : 'Slash'} — ${ty.label}`,
      };
    }
    return {
      px: cur.px,
      py: cur.py,
      weapon,
      combat: cur.body.skills.combat,
      health01: cur.body.health / cur.body.maxHealth,
      hour: clockHM(clock.current).hour,
      closedDoors: new Set<string>(closedDoorBlockers(doorsRef.current)),
      heldKey: slot?.module.type.key, // gates tool actions (e.g. 'pry' needs a crowbar)
      heldLabel: slot?.module.type.label, // names the "Stash the X" row
    };
  };

  const onSceneRightClick = (payload: any) => {
    if (chat.chatOpenRef.current) return;
    const r = rectRef.current;
    const sx = Number(payload?.x ?? 0) - r.x;
    const sy = Number(payload?.y ?? 0) - r.y;
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
    const cur = sim.current;
    const world = unproject(sx, sy, cur, r);
    const target = pickTarget(world.x, world.y);
    menuTargetRef.current = target;
    setMenu({ x: sx, y: sy, title: targetLabel(target), options: availableActions(target, buildAttackContext(cur)) });
  };

  const examineTextFor = (t: ActionTarget): string => {
    switch (t.kind) {
      case 'npc':
      case 'storefront':
      case 'sign':
        return t.ent.label;
      case 'door':
        return t.door.open ? 'An open doorway. Dark in there.' : 'A shut door. The building is closed up tight.';
      case 'item':
        return 'Something worth grabbing is lying here.';
      case 'prop':
        // flavor is declared on the thingymajigger now, not switched on kind here
        return THINGYMAJIGGERS[t.prop.kind]?.examine ?? 'Some bit of street junk.';
      case 'feature':
        if (t.feature.kind === 'floorboard') {
          return t.feature.cache.opened
            ? 'Torn-up boards and a dark gap. Whatever was here is gone.'
            : t.feature.cache.needs
              ? 'A board that sits a little proud of the others. It would take a tool to lift.'
              : 'Floorboards. Some give a little underfoot.';
        }
        return THINGYMAJIGGERS[t.feature.kind]?.examine ?? t.feature.kind;
      case 'tile':
        return 'Cracked pavement, old gum, a flyer for a club that closed.';
    }
  };

  // Run the picked menu action on the stored target. Blocked rows aren't pressable,
  // so anything that reaches here already passed its proximity gate.
  const runAction = (interactionKey: string) => {
    const t = menuTargetRef.current;
    // The TRUE chance for the picked row (ground truth — NOT the warped value the
    // menu may have shown under high). The dice roll uses this, so a manic player
    // baited by a fake % eats the real odds.
    const picked = menu?.options.find((o) => o.interactionKey === interactionKey);
    setMenu(null);
    if (!t) return;
    const cur = sim.current;
    const now = (globalThis as any).performance?.now?.() ?? Date.now();
    const setEx = (text: string) => {
      examineRef.current = { text, until: now + 3000 };
    };
    const pos = targetPos(t);
    // Open a stash cache once and bank whatever cash it held. Returns the amount taken,
    // or null if it was already opened. Shared by 'loot' (quiet) and 'pry' (loud) so the
    // reveal logic lives in one place; flavor + heat stay per-verb.
    const takeStash = (cache: { opened?: boolean; money?: number }): number | null => {
      if (cache.opened) return null;
      cache.opened = true;
      const got = cache.money && cache.money > 0 ? cache.money : 0;
      if (got) { adjustMoney(cur, got); cache.money = 0; }
      return got;
    };
    switch (interactionKey) {
      case 'walk':
        cur.path = findPath(cur.px, cur.py, pos.x, pos.y, liveBlockers());
        break;
      case 'examine':
        setEx(examineTextFor(t));
        break;
      case 'talk':
        if (t.kind === 'npc' && t.ent.quest) {
          chat.openQuestChat(t.ent);
          return;
        }
        if (t.kind === 'npc') setEx(t.ent.label);
        break;
      case 'pickup':
        if (t.kind === 'item') {
          const text = pickupWorldItem(cur.body, inventory.current, t.item.id);
          if (text) setEx(text);
        }
        break;
      case 'open':
      case 'close':
        if (t.kind === 'door') toggleDoor(t.door);
        break;
      case 'loot': {
        if (t.kind !== 'feature') break;
        const cache = t.feature.cache;
        if (cache.stash != null) {
          // A REUSABLE container (toilet/bed/dumpster) — pull out cash + everything you
          // stashed. Stays reusable (no 'opened'), so it keeps working as a hiding spot.
          // Quiet: rifling your own stash isn't loud, so no heat.
          const parts: string[] = [];
          if (cache.money && cache.money > 0) { adjustMoney(cur, cache.money); parts.push(`$${cache.money.toLocaleString()}`); cache.money = 0; }
          parts.push(...emptyStash(cur.body, inventory.current, cache));
          setEx(parts.length ? `You pull out: ${parts.join(', ')}.` : `You search the ${t.feature.kind}. Empty.`);
        } else {
          // A ONE-TIME cache. Quiet search — take the cash, then it's spent.
          const got = takeStash(cache);
          if (got == null) setEx('Already been through here. Nothing left.');
          else if (got > 0) setEx(`Tucked in there — $${got.toLocaleString()}. Lucky you.`);
          else setEx(`You search the ${t.feature.kind}. Nothing worth taking.`);
        }
        break;
      }
      case 'stash': {
        // Deposit the in-hand item into a reusable stash (the menu already checked room).
        if (t.kind !== 'feature') break;
        const msg = stashInHand(cur.body, inventory.current, t.feature.cache);
        setEx(msg ?? 'No room, or nothing in hand.');
        break;
      }
      case 'pry': {
        // A GATED stash (the action menu already checked you're holding the tool).
        // Loud — forcing it open is a mess, so it spikes visual heat either way.
        if (t.kind !== 'feature') break;
        const got = takeStash(t.feature.cache);
        if (got == null) { setEx('Already pried open. Nothing left but the gap.'); break; }
        adjustSuspicionAxis(cur, 'visual', 6);
        if (got > 0) setEx(`Under it — a brick of cash. $${got.toLocaleString()}. You did hear something.`);
        else setEx('You splinter it open. Rotten joists, a dead roach. Nothing.');
        break;
      }
      case 'shoot':
      case 'slash': {
        if (t.kind !== 'npc') break;
        const e = t.ent;
        if (e.dead) {
          setEx(`${e.name ?? 'They'} are already down. You stand over the body, breathing hard.`);
          break;
        }
        const pTrue = picked?.chance ?? 0;
        const hit = Math.random() < pTrue;
        // a shot spends a round
        const slot = inHandSlot(cur.body, inventory.current);
        if (slot && slot.module.type.ranged && slot.instance.charges != null) {
          slot.instance.charges = Math.max(0, slot.instance.charges - 1);
        }
        if (hit) {
          // down them: they stop where they fall and render as a body
          e.dead = true;
          e.tx = e.x;
          e.ty = e.y;
          cur.body.career.kills += 1;
          setEx(`Hit. ${e.name ?? 'They'} fold up — ugly, twitchy, over in a second.`);
          adjustSuspicionAxis(cur, 'visual', 12);
        } else {
          // a witnessed botch: the target bolts away from the player, heat spikes
          const away = nearestWalkable(Math.round(e.x + (e.x - cur.px)), Math.round(e.y + (e.y - cur.py)), liveBlockers());
          if (away) {
            e.tx = away.x + 0.5;
            e.ty = away.y + 0.5;
          }
          setEx(`You whiff. ${e.name ?? 'They'} bolt screaming — and now the whole block saw you.`);
          adjustSuspicionAxis(cur, 'visual', 20);
        }
        break;
      }
    }
    refresh();
  };

  const s = sim.current;
  const r = rectRef.current;
  const cam: Cam = { px: s.px, py: s.py, yaw: s.yaw, pitch: s.pitch, zoom: s.zoom };
  const winOX = Math.floor(s.px) - HALF;
  const winOY = Math.floor(s.py) - HALF;
  const winTiles = useMemo(() => buildTileWindow(winOX, winOY), [winOX, winOY]);
  const decorList = useMemo(() => buildDecorWindow(winOX, winOY, winTiles), [winOX, winOY, winTiles]);
  const nowMs = (globalThis as any).performance?.now?.() ?? 0;
  const examineText = examineRef.current && examineRef.current.until > nowMs ? examineRef.current.text : null;

  return {
    sim: s,
    player: s.body,
    playerActions,
    inventory: inventory.current,
    inventorySlots: inventorySlots(s.body, inventory.current),
    inHand: inHandSlot(s.body, inventory.current),
    inventoryActions,
    clock: formatClock(clock.current),
    rect: r,
    cam,
    rectRef,
    winOX,
    winOY,
    winTiles,
    decorList,
    entities: entsRef.current,
    doors: doorsRef.current,
    examineText,
    menu,
    onSceneDown,
    onSceneRightClick,
    runAction,
    closeMenu,
  };
}
