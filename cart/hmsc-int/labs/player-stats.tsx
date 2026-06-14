// labs/player-stats.tsx — the player STATS bench: dial every stat, watch the
// real HUD, simulate the systems that move them.
//
// The ground floor arrives through '@game' (V17). This lab drives GAME_STATS:
// the left column tunes the live stat set, the right pane renders the REAL
// readout (render/StatsHud — the same package the in-world HUD uses, so the lab
// demonstrates the shipped thing, not a mock) over a clothed figure, and the
// simulation row exercises the formulas — sprinting drains energy by the stamina
// skill, evading bleeds the wanted level, and play earns xp toward the next
// level. Contract: the paired player-stats.notes.md.
//
// (Structural note: a lab importing render/StatsHud bends "labs → game/ only" so
// the lab can show the SHIPPED HUD rather than a fork — the user's "one complete
// package" ruling. StatsHud itself depends only on @game + primitives.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { GAME_LOOP, GAME_STATS, type PlayerStats, type SkillId, type PantsId, type BackpackId, type AssetRef } from '@game';
import { buildRigFrame } from '@game/figure';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { StatsHud } from '../render/StatsHud';

const BG = '#0a0712';
const INK = '#ffe3f1';
const DIM = '#9a7f93';
const ACCENT = '#18e0d8';

const PANTS: PantsId[] = ['none', 'briefs', 'shorts', 'jeans', 'slacks', 'skirt', 'cargo'];
const BACKPACKS: BackpackId[] = ['none', 'satchel', 'backpack', 'suitcase'];
const SHIRTS = ['tee', 'hoodie', 'suit', 'armor', 'dress', 'underwear'];

// PantsId → a renderable BottomsId for the figure (none/cargo have no garment of
// their own; show the nearest silhouette). Render-only; capacity reads the real
// PantsId.
const PANTS_RENDER: Record<PantsId, string> = {
  none: 'briefs', briefs: 'briefs', shorts: 'shorts', jeans: 'jeans', slacks: 'slacks', skirt: 'skirt', cargo: 'jeans',
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function geometryFor(kind: 'box' | 'sphere' | 'cone' | 'cylinder') {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'cone' ? Geometry.Cone : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

type LabPlayer = {
  health: number;
  heat: number;
  money: number;
  inventory: string[];
  stats: PlayerStats;
};

function initialPlayer(): LabPlayer {
  const stats = GAME_STATS.defaultPlayerStats();
  stats.wallet.cash = 4200;
  stats.wallet.crypto = 1500;
  stats.wallet.assets = [{ id: 'sedan', label: 'sedan', value: 9000 }];
  return { health: 100, heat: 22, money: 0, inventory: ['pistol', 'phone'], stats };
}

export default function PlayerStatsLab() {
  const [player, setPlayer] = useState<LabPlayer>(initialPlayer);
  // The active continuous activity the sim applies each frame.
  const [mode, setMode] = useState<'rest' | 'walk' | 'run'>('rest');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Evading bleeds notoriety; while NOT evading the wanted level holds (persistent).
  const [evading, setEvading] = useState(false);
  const evadingRef = useRef(evading);
  evadingRef.current = evading;

  // mutate the stats in place via a patch (keeps the nested shape simple).
  const patchStats = (fn: (s: PlayerStats) => void) =>
    setPlayer((p) => { const stats = JSON.parse(JSON.stringify(p.stats)) as PlayerStats; fn(stats); return { ...p, stats }; });
  const patchPlayer = (fn: (p: LabPlayer) => void) =>
    setPlayer((p) => { const next = { ...p, stats: JSON.parse(JSON.stringify(p.stats)) as PlayerStats }; fn(next); return next; });

  // ── the simulation loop: energy drain/regen, step xp, notoriety decay ────────
  useEffect(() => {
    let last = GAME_LOOP.now();
    let handle: unknown;
    const tick = () => {
      const t = GAME_LOOP.now();
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      setPlayer((p) => {
        const stats = { ...p.stats };
        const staminaLevel = GAME_STATS.skillLevel(stats.skills.stamina.xp);
        const activity = modeRef.current;
        stats.energy = GAME_STATS.stepEnergy(stats.energy, activity, dt, staminaLevel);
        // walking/running advances the step odometer → stamina xp.
        let heat = p.heat;
        if (activity !== 'rest') {
          const stepsPerSecond = activity === 'run' ? 3.4 : 1.8;
          const gained = stepsPerSecond * dt * 60; // ~steps this frame
          const earned = GAME_STATS.earnStepsXp({ ...stats, steps: stats.steps } as PlayerStats, gained);
          stats.steps = earned.steps;
          stats.skills = { ...stats.skills, stamina: earned.stamina };
        }
        if (evadingRef.current) {
          const stealthLevel = GAME_STATS.skillLevel(stats.skills.stealth.xp);
          heat = GAME_STATS.decayNotoriety(p.heat, dt, stealthLevel);
        }
        return { ...p, heat, stats };
      });
      handle = GAME_LOOP.scheduleFrame(tick);
    };
    handle = GAME_LOOP.scheduleFrame(tick);
    return () => GAME_LOOP.cancelFrame(handle);
  }, []);

  // ── figure: the clothing silhouette reacts to shirt/pants ────────────────────
  const figure = useMemo(() => {
    const rig = buildRigFrame('neutral', 'stand', 0, [], player.stats.outfit.shirt as any, 'plain', [], PANTS_RENDER[player.stats.outfit.pants] as any);
    return rig.clothing.map((inst, i) => ({
      key: `c${i}`,
      geometry: geometryFor(inst.geometry),
      params: inst.params,
      position: inst.position as [number, number, number],
      rotation: (inst.rotation ?? [0, 0, 0]) as [number, number, number],
      scale: inst.scale as any,
      color: inst.color,
      opacity: inst.opacity,
    }));
  }, [player.stats.outfit.shirt, player.stats.outfit.pants]);

  const addAsset = () => {
    const n = player.stats.wallet.assets.length + 1;
    const asset: AssetRef = { id: `asset${n}`, label: `asset ${n}`, value: 2500 * n };
    patchStats((s) => { s.wallet.assets = [...s.wallet.assets, asset]; });
  };
  const damage = (amount: number) => patchPlayer((p) => {
    // armor soaks first, then health.
    const soak = Math.min(p.stats.armor, amount);
    p.stats.armor -= soak;
    p.health = clamp(p.health - (amount - soak), 0, GAME_STATS.healthMax);
  });
  const heal = () => patchPlayer((p) => { p.health = GAME_STATS.healthMax; p.stats.armor = GAME_STATS.tuning.armor.max; });
  const jump = () => patchStats((s) => {
    const cost = GAME_STATS.jumpEnergyCost(GAME_STATS.skillLevel(s.skills.stamina.xp));
    s.energy = clamp(s.energy - cost, 0, GAME_STATS.energyMax);
  });
  const commitCrime = () => patchPlayer((p) => { p.heat = clamp(p.heat + 20, 0, 100); });
  const earnXp = (id: SkillId, amount: number) => patchStats((s) => { s.skills = { ...s.skills, [id]: { xp: s.skills[id].xp + amount } }; });

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the stat bench ──────────────────────────────────────────────── */}
      <Col style={{ width: 300, height: '100%', backgroundColor: '#0a0712', padding: 12, overflow: 'scroll' }}>
        <Text style={{ color: INK, fontSize: 15, marginBottom: 2 }}>player stats</Text>
        <Text style={{ color: DIM, fontSize: 10, marginBottom: 8 }}>core + gained · GAME_STATS</Text>

        <Header text="VITALS" />
        <Knob label="health" value={player.health} min={0} max={GAME_STATS.healthMax} step={5} onSet={(v) => patchPlayer((p) => { p.health = v; })} />
        <Knob label="armor" value={player.stats.armor} min={0} max={GAME_STATS.tuning.armor.max} step={5} onSet={(v) => patchStats((s) => { s.armor = v; })} />
        <Knob label="energy" value={player.stats.energy} min={0} max={GAME_STATS.energyMax} step={5} onSet={(v) => patchStats((s) => { s.energy = v; })} />
        <Row style={{ gap: 4, marginTop: 2, marginBottom: 4, flexWrap: 'wrap' }}>
          <Chip label="−25 dmg" onPress={() => damage(25)} />
          <Chip label="heal" onPress={heal} />
          <Chip label="jump" onPress={jump} />
        </Row>
        <Row style={{ gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          {(['rest', 'walk', 'run'] as const).map((m) => (
            <Chip key={m} label={m} active={mode === m} onPress={() => setMode(m)} />
          ))}
        </Row>

        <Header text="MONEY" />
        <Knob label="cash" value={player.stats.wallet.cash} min={0} max={1_000_000} step={500} onSet={(v) => patchStats((s) => { s.wallet.cash = v; })} />
        <Knob label="crypto" value={player.stats.wallet.crypto} min={0} max={1_000_000} step={500} onSet={(v) => patchStats((s) => { s.wallet.crypto = v; })} />
        <Row style={{ gap: 4, marginBottom: 4 }}>
          <Chip label="+ asset" onPress={addAsset} />
          <Chip label="clear assets" onPress={() => patchStats((s) => { s.wallet.assets = []; })} />
        </Row>

        <Header text="WANTED" />
        <Knob label="notoriety" value={player.heat} min={0} max={100} step={2} onSet={(v) => patchPlayer((p) => { p.heat = v; })} />
        <Row style={{ gap: 4, marginBottom: 4 }}>
          <Chip label="commit crime" onPress={commitCrime} />
          <Chip label="evade" active={evading} onPress={() => setEvading((e) => !e)} />
        </Row>

        <Header text="OUTFIT (pants/pack drive carry)" />
        <Picker label="pants" options={PANTS} value={player.stats.outfit.pants} onPick={(v) => patchStats((s) => { s.outfit.pants = v as PantsId; })} />
        <Picker label="pack" options={BACKPACKS} value={player.stats.outfit.backpack} onPick={(v) => patchStats((s) => { s.outfit.backpack = v as BackpackId; })} />
        <Picker label="shirt" options={SHIRTS} value={player.stats.outfit.shirt} onPick={(v) => patchStats((s) => { s.outfit.shirt = v; })} />

        <Header text="GAINED SKILLS (play earns xp)" />
        {GAME_STATS.skillIds.map((id) => (
          <Row key={id} style={{ alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Text style={{ width: 58, color: DIM, fontSize: 11 }}>{id}</Text>
            <Chip label="+xp" onPress={() => earnXp(id, GAME_STATS.xpForLevel(GAME_STATS.skillLevel(player.stats.skills[id].xp) + 1) - player.stats.skills[id].xp + 1)} />
            <Chip label="reset" onPress={() => patchStats((s) => { s.skills = { ...s.skills, [id]: { xp: 0 } }; })} />
            <Text style={{ color: ACCENT, fontSize: 10, fontFamily: 'mono' }}>{`L${GAME_STATS.skillLevel(player.stats.skills[id].xp)}`}</Text>
          </Row>
        ))}
      </Col>

      {/* ── right: figure + the REAL HUD package ───────────────────────────────── */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative' }}>
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={BG} showGrid showAxes={false}>
          <Scene3D.Camera position={[0, 1.4, 3.4]} target={[0, 0.9, 0]} fov={48} />
          <Scene3D.AmbientLight color="#c8b8d6" intensity={0.7} />
          <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.5]} color="#fff1f8" intensity={0.95} />
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material="#160d1f" position={[0, -0.05, 0]} scale={[6, 0.1, 6]} />
          {/* head — a simple sphere; the body is the dressed silhouette */}
          <Scene3D.Mesh geometry={Geometry.Sphere} params={{ radius: 0.5, segments: 18, rings: 12 }} material="#d9a98a" position={[0, 1.62, 0]} scale={0.16} />
          {figure.map((m) => (
            <Scene3D.Mesh key={m.key} geometry={m.geometry} params={m.params} position={m.position} rotation={m.rotation} scale={m.scale} material={m.color} opacity={m.opacity} />
          ))}
        </Scene3D>

        {/* the shipped readout, live */}
        <Box style={{ position: 'absolute', right: 16, top: 16 }}>
          <StatsHud player={player as any} />
        </Box>

        <Box style={{ position: 'absolute', left: 16, bottom: 16 }}>
          <Text style={{ color: DIM, fontSize: 10 }}>{`mode: ${mode}${evading ? ' · evading' : ''} — energy & xp tick live`}</Text>
        </Box>
      </Box>
    </Row>
  );
}

function Header(props: { text: string }) {
  return <Text style={{ color: '#5e4a5a', fontSize: 9, letterSpacing: 1, marginTop: 10, marginBottom: 4 }}>{props.text}</Text>;
}

function Chip(props: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={props.onPress}>
      <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: props.active ? '#3a1530' : '#1a0f22' }}>
        <Text style={{ color: props.active ? ACCENT : DIM, fontSize: 10 }}>{props.label}</Text>
      </Box>
    </Pressable>
  );
}

function Picker(props: { label: string; options: readonly string[]; value: string; onPick: (v: string) => void }) {
  return (
    <Row style={{ alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
      <Text style={{ width: 44, color: DIM, fontSize: 11 }}>{props.label}</Text>
      {props.options.map((o) => (
        <Pressable key={o} onPress={() => props.onPick(o)}>
          <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, marginRight: 3, marginBottom: 3, borderRadius: 4, backgroundColor: o === props.value ? '#16345a' : '#160d1f' }}>
            <Text style={{ color: o === props.value ? ACCENT : DIM, fontSize: 10 }}>{o}</Text>
          </Box>
        </Pressable>
      ))}
    </Row>
  );
}

function Knob(props: { label: string; value: number; step: number; min: number; max: number; onSet: (v: number) => void }) {
  const set = (delta: number) => props.onSet(clamp(props.value + delta, props.min, props.max));
  const digits = props.step < 1 ? 2 : 0;
  return (
    <Row style={{ alignItems: 'center', marginBottom: 5 }}>
      <Text style={{ color: DIM, fontSize: 11, width: 58 }}>{props.label}</Text>
      <Pressable onPress={() => set(-props.step)}>
        <Box style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: '#1a0f22', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: INK, fontSize: 13 }}>−</Text></Box>
      </Pressable>
      <Box style={{ width: 64, alignItems: 'center' }}><Text style={{ color: INK, fontSize: 11, fontFamily: 'mono' }}>{props.value.toFixed(digits)}</Text></Box>
      <Pressable onPress={() => set(props.step)}>
        <Box style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: '#1a0f22', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: INK, fontSize: 13 }}>+</Text></Box>
      </Pressable>
    </Row>
  );
}
