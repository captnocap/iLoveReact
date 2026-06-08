// EmbodiedHud.tsx — the Fortnite-verbatim game HUD for embodied routes
// (HUD-0605). USER VERDICT: "just make a normal game hud … literally just
// take the same idea as fortnite. verbatim". The layout is the reference
// screenshot's, minus the two explicit exclusions (stamina, material counts):
//
//   TOP-CENTER     compass strip — headings + degree ticks, objective/target
//                  markers ride it (bearing-relative).
//   TOP-RIGHT      minimap (north-up, player-centered, real world door data)
//                  + the key info block under it.
//   LEFT-MIDDLE    game status updates feed (session/world events).
//   BOTTOM-LEFT    health bar + shields. NO stamina (excluded by the user).
//   BOTTOM-RIGHT   equipment hotbar; the building blueprint selection sits
//                  ABOVE it (the ruled 1/2/3/4 categories — keys and HUD
//                  agree). NO material amounts (excluded by the user).
//
// Composable beside the substrate: any embodied route mounts <EmbodiedHud>
// and feeds it route truth. /build is the proving surface. Every datum
// arrives through a door (player state, world grid, kind colors, session
// commits, GAME_LOOP clocks); whatever lacks a door renders a HAND-OFF row
// (HudHandoff), never a fake number — shields is one today.
//
// Chrome is studio.cls tokens only (the Hud* class family); the only numbers
// here are the P2 HUD_TUNING table below.

import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { GAME_KINDS } from '@game';
import type { WorldGridState } from '@game';
import type { Embodied } from './Embodied';
import { C, accentFor } from './studio.cls';

const DEG = Math.PI / 180;

// ── P2: every HUD feel number, named ────────────────────────────────────────
export const HUD_TUNING = {
  edgePadPixels: 14,
  compass: {
    widthPixels: 420,
    heightPixels: 34,
    windowDegrees: 120,
    tickEveryDegrees: 10,
    labelEveryDegrees: 30,
    /** look shadow → HUD state sample cadence (the camera is host-driven; the
     *  HUD only needs a readable heading, not frame-rate truth) */
    sampleMs: 90,
  },
  minimap: {
    sizePixels: 150,
    radiusMeters: 48,
    playerDotPixels: 7,
    facingDotPixels: 4,
    facingOffsetPixels: 7,
    blipPixels: 4,
    /** regions/pieces drawn, nearest-first past this are dropped (HUD legibility cap) */
    maxBlips: 140,
  },
  feed: { maxLines: 5, widthPixels: 300 },
  vitals: { barWidthPixels: 230, healthMax: 100 },
  equipment: { slotCount: 5 },
} as const;

const COMPASS_LABELS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
};

function wrap180(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function normalize360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Bearing from `from` to `to` in the game's compass-yaw convention (yaw 0
 *  faces −Z — the same frame the player's facing yaw uses). */
function bearingDegrees(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return normalize360(Math.atan2(-(to.x - from.x), -(to.z - from.z)) / DEG);
}

export type HudCompassMarker = { x: number; z: number; label?: string };
export type HudFeedEntry = { id: string | number; text: string; hot?: boolean };
export type HudKeyInfoRow = { label: string; value: string };
export type HudSlotDef = {
  id: string;
  /** short slot label (≤ ~6 chars reads best at slot size) */
  label: string;
  /** the key that selects it — shown in the corner so keys and HUD agree */
  keyTag?: string;
  active?: boolean;
  onPress?: () => void;
};
export type HudVitals = {
  /** through the player door (state.player.health) */
  health: number;
  /** shields have NO system yet — when this stays undefined the bar renders
   *  as a hand-off row, never a fake number */
  shield?: number;
};

// ── compass (top-center) ─────────────────────────────────────────────────────

function CompassStrip(props: { embodied: Embodied; markers: HudCompassMarker[] }) {
  const T = HUD_TUNING.compass;
  // The look shadow is a ref (a camera drag is zero render work — V23); the
  // compass samples it on a coarse clock and re-renders only on whole-degree
  // changes.
  const [yaw, setYaw] = useState(() => Math.round(normalize360(props.embodied.lookRef.current.yaw)));
  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.round(normalize360(props.embodied.lookRef.current.yaw));
      setYaw((prev) => (prev === next ? prev : next));
    }, T.sampleMs);
    return () => clearInterval(id);
  }, []);

  const half = T.windowDegrees / 2;
  const pxPerDegree = T.widthPixels / T.windowDegrees;
  const center = T.widthPixels / 2;
  const marks: ReactNode[] = [];
  // ticks + labels across the visible window
  for (let t = 0; t < 360; t += T.tickEveryDegrees) {
    const offset = wrap180(t - yaw);
    if (Math.abs(offset) > half) continue;
    const x = center + offset * pxPerDegree;
    const label = COMPASS_LABELS[t];
    const isLabeled = label !== undefined || t % T.labelEveryDegrees === 0;
    marks.push(
      <Box key={`t${t}`} style={{ position: 'absolute', left: Math.round(x), top: label !== undefined ? 18 : 21 }}>
        {label !== undefined ? <C.HudTickMajor /> : <C.HudTick />}
      </Box>,
    );
    if (isLabeled) {
      marks.push(
        <Box key={`l${t}`} style={{ position: 'absolute', left: Math.round(x) - 12, top: 3, width: 26, alignItems: 'center' }}>
          {label !== undefined
            ? <C.HudHeading>{label}</C.HudHeading>
            : <C.HudDegrees>{String(t)}</C.HudDegrees>}
        </Box>,
      );
    }
  }
  // objective/target markers, bearing-relative (the player is the origin)
  const p = props.embodied.playerRef.current;
  for (const [index, marker] of props.markers.entries()) {
    const offset = wrap180(bearingDegrees(p, marker) - yaw);
    if (Math.abs(offset) > half) continue;
    marks.push(
      <Box key={`m${index}`} style={{ position: 'absolute', left: Math.round(center + offset * pxPerDegree) - 3, top: 26 }}>
        <C.HudMarker />
      </Box>,
    );
  }
  return (
    <C.HudPanel style={{ width: T.widthPixels, height: T.heightPixels }}>
      {marks}
      {/* current heading, boxed center (the reference's "273") */}
      <Box style={{ position: 'absolute', left: center - 17, top: -9, width: 34, alignItems: 'center' }}>
        <C.HudPanel style={{ paddingLeft: 5, paddingRight: 5, paddingTop: 1, paddingBottom: 1 }}>
          <C.HudText>{String(yaw)}</C.HudText>
        </C.HudPanel>
      </Box>
    </C.HudPanel>
  );
}

// ── minimap + key info (top-right) ───────────────────────────────────────────

type MapRect = { key: string; x: number; z: number; w: number; d: number; color: string };

/** World rectangles worth blipping — regions colored by their KIND table
 *  entry (the door's render color). Computed once per world; the per-frame work
 *  is translation only. */
function worldMapRects(world: WorldGridState): MapRect[] {
  const rects: MapRect[] = [];
  const c = world.cellSizeMeters;
  for (const r of world.surfaceRegions) {
    rects.push({
      key: `r:${r.id}`,
      x: r.x * c, z: r.z * c, w: r.width * c, d: r.depth * c,
      color: GAME_KINDS.tiles.get(r.kind).render.color,
    });
  }
  return rects;
}

const Minimap = memo(function Minimap(props: {
  rects: MapRect[];
  blips: readonly { x: number; z: number }[];
  player: { x: number; z: number; yaw: number };
  markers: HudCompassMarker[];
}) {
  const T = HUD_TUNING.minimap;
  const size = T.sizePixels;
  const scale = size / 2 / T.radiusMeters;
  const cx = size / 2, cz = size / 2;
  const px = props.player.x, pz = props.player.z;
  const children: ReactNode[] = [];
  let drawn = 0;
  for (const r of props.rects) {
    if (drawn >= T.maxBlips) break;
    const left = cx + (r.x - px) * scale;
    const top = cz + (r.z - pz) * scale;
    const w = r.w * scale, d = r.d * scale;
    if (left + w < 0 || top + d < 0 || left > size || top > size) continue;
    drawn += 1;
    children.push(<Box key={r.key} style={{ position: 'absolute', left: Math.round(left), top: Math.round(top), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(d)), backgroundColor: r.color, opacity: 0.55 }} />);
  }
  for (const [index, blip] of props.blips.entries()) {
    if (drawn >= T.maxBlips) break;
    const left = cx + (blip.x - px) * scale, top = cz + (blip.z - pz) * scale;
    if (left < 0 || top < 0 || left > size || top > size) continue;
    drawn += 1;
    children.push(<Box key={`p${index}`} style={{ position: 'absolute', left: Math.round(left) - T.blipPixels / 2, top: Math.round(top) - T.blipPixels / 2, width: T.blipPixels, height: T.blipPixels, backgroundColor: accentFor('hudText'), opacity: 0.8 }} />);
  }
  for (const [index, m] of props.markers.entries()) {
    const left = Math.min(size - 4, Math.max(0, cx + (m.x - px) * scale));
    const top = Math.min(size - 4, Math.max(0, cz + (m.z - pz) * scale));
    children.push(
      <Box key={`m${index}`} style={{ position: 'absolute', left: Math.round(left) - 3, top: Math.round(top) - 3 }}>
        <C.HudMarker />
      </Box>,
    );
  }
  // the player: center dot + a facing dot (yaw 0 faces −Z = map-up)
  const fx = -Math.sin(props.player.yaw * DEG) * T.facingOffsetPixels;
  const fz = -Math.cos(props.player.yaw * DEG) * T.facingOffsetPixels;
  children.push(
    <Box key="pf" style={{ position: 'absolute', left: cx + fx - T.facingDotPixels / 2, top: cz + fz - T.facingDotPixels / 2, width: T.facingDotPixels, height: T.facingDotPixels, borderRadius: T.facingDotPixels / 2, backgroundColor: accentFor('hudPlayer'), opacity: 0.85 }} />,
    <Box key="pp" style={{ position: 'absolute', left: cx - T.playerDotPixels / 2, top: cz - T.playerDotPixels / 2, width: T.playerDotPixels, height: T.playerDotPixels, borderRadius: T.playerDotPixels / 2, backgroundColor: accentFor('hudPlayer') }} />,
  );
  return <C.HudMapFrame style={{ width: size, height: size }}>{children}</C.HudMapFrame>;
});

// ── building blocks the route composes (blueprint bar, hotbar) ──────────────

export function HudSlots(props: { slots: HudSlotDef[] }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 5 }}>
      {props.slots.map((slot) => {
        const Body = slot.active ? C.HudSlotActive : C.HudSlot;
        const inner = (
          <Body>
            {slot.keyTag !== undefined && (
              <Box style={{ position: 'absolute', left: 3, top: 2 }}>
                <C.HudKeyTag>{slot.keyTag}</C.HudKeyTag>
              </Box>
            )}
            <C.HudSlotText>{slot.label}</C.HudSlotText>
          </Body>
        );
        return slot.onPress
          ? <Pressable key={slot.id} onPress={slot.onPress}>{inner}</Pressable>
          : <Box key={slot.id}>{inner}</Box>;
      })}
    </Box>
  );
}

// ── the HUD ──────────────────────────────────────────────────────────────────

export function EmbodiedHud(props: {
  embodied: Embodied;
  /** compass + minimap markers (build: the snap target; missions: objectiveMarker) */
  markers?: HudCompassMarker[];
  /** left-middle status updates (build: the session's labeled commits) */
  feed?: HudFeedEntry[];
  vitals: HudVitals;
  /** rows under the minimap (map · clock · pieces · commits …) */
  keyInfo?: HudKeyInfoRow[];
  /** extra minimap blips (build: placed pieces) */
  mapBlips?: readonly { x: number; z: number }[];
  /** bottom-right equipment hotbar (player.inventory through the items door) */
  equipment?: HudSlotDef[];
  /** the building blueprint selection, rendered ABOVE the hotbar */
  blueprint?: ReactNode;
}) {
  const PAD = HUD_TUNING.edgePadPixels;
  const { embodied } = props;
  const markers = props.markers ?? [];
  const world = embodied.sceneState.world;
  // static world → map rects once per authored world (translation is per-frame)
  const mapRects = useMemo(() => worldMapRects(embodied.worldGrid), [embodied.worldGrid]);
  const vitals = props.vitals;
  const healthFrac = Math.max(0, Math.min(1, vitals.health / HUD_TUNING.vitals.healthMax));
  const equipment = props.equipment ?? [];
  const emptySlots = Math.max(0, HUD_TUNING.equipment.slotCount - equipment.length);

  return (
    <>
      {/* TOP-CENTER: compass (centered by an inert full-width row — absolute
          left/top take no %, the wrapper centers) */}
      <Box style={{ position: 'absolute', left: 0, right: 0, top: PAD, alignItems: 'center' }}>
        <CompassStrip embodied={embodied} markers={markers} />
      </Box>

      {/* TOP-RIGHT: minimap + key info */}
      <Box style={{ position: 'absolute', right: PAD, top: PAD, alignItems: 'flex-end', gap: 5 }}>
        <Minimap
          rects={mapRects}
          blips={props.mapBlips ?? []}
          player={{ x: embodied.player.x, z: embodied.player.z, yaw: embodied.player.yaw }}
          markers={markers}
        />
        {(props.keyInfo ?? []).length > 0 && (
          <C.HudPanel style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, gap: 2, width: HUD_TUNING.minimap.sizePixels }}>
            {(props.keyInfo ?? []).map((row) => (
              <Box key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <C.HudTextDim>{row.label}</C.HudTextDim>
                <C.HudText>{row.value}</C.HudText>
              </Box>
            ))}
          </C.HudPanel>
        )}
      </Box>

      {/* LEFT-MIDDLE: game status updates (a full-height inert column centers
          the block — absolute left/top take no %) */}
      {(props.feed ?? []).length > 0 && (
        <Box style={{ position: 'absolute', left: PAD, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Box style={{ width: HUD_TUNING.feed.widthPixels, gap: 2 }}>
            <C.HudTextDim>game status updates</C.HudTextDim>
            {(props.feed ?? []).slice(-HUD_TUNING.feed.maxLines).map((entry) =>
              entry.hot
                ? <C.HudFeedHot key={entry.id}>{entry.text}</C.HudFeedHot>
                : <C.HudFeedLine key={entry.id}>{entry.text}</C.HudFeedLine>)}
          </Box>
        </Box>
      )}

      {/* BOTTOM-LEFT: shields above health (the reference's stack). NO stamina. */}
      <Box style={{ position: 'absolute', left: PAD, bottom: PAD, gap: 4, width: HUD_TUNING.vitals.barWidthPixels }}>
        {vitals.shield === undefined ? (
          // hand-off, not a fake: no damage/shield system behind a door yet
          <C.HudHandoff>shields — awaiting the damage system (no door)</C.HudHandoff>
        ) : (
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Box style={{ flexGrow: 1 }}>
              <C.HudBarTrack><C.HudBarShield style={{ width: `${Math.round(Math.max(0, Math.min(1, vitals.shield / HUD_TUNING.vitals.healthMax)) * 100)}%` }} /></C.HudBarTrack>
            </Box>
            <C.HudBarNum>{String(Math.round(vitals.shield))}</C.HudBarNum>
          </Box>
        )}
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Box style={{ flexGrow: 1 }}>
            <C.HudBarTrack><C.HudBarHealth style={{ width: `${Math.round(healthFrac * 100)}%` }} /></C.HudBarTrack>
          </Box>
          <C.HudBarNum>{String(Math.round(vitals.health))}</C.HudBarNum>
        </Box>
      </Box>

      {/* BOTTOM-RIGHT: blueprint selection above the equipment hotbar.
          NO material amounts. */}
      <Box style={{ position: 'absolute', right: PAD, bottom: PAD, alignItems: 'flex-end', gap: 6 }}>
        {props.blueprint}
        <Box style={{ flexDirection: 'row', gap: 5, alignItems: 'flex-end' }}>
          <HudSlots
            slots={[
              ...equipment,
              ...Array.from({ length: emptySlots }, (_, i) => ({ id: `empty${i}`, label: '' })),
            ]}
          />
        </Box>
        {equipment.length === 0 && <C.HudHandoff>equipment — authored inventory is empty</C.HudHandoff>}
      </Box>
    </>
  );
}
