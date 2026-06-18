// editors/model/frameProbe.ts — host-accurate frame diagnostics for the Studio
// viewport (req_0963). Spinning the camera, the user sees frames "literally just
// skipping" — not the soft GC/JS jank pattern, a hard skip. A JS-side timer
// CAN'T see that: it ticks slower than the host renders, so a single dropped
// host frame falls between two JS ticks and never shows up. So we read the
// HOST'S per-frame ring instead:
//   __tel_history(n) → the last n frame_total_us (microseconds), newest first,
//     host-side ring up to 120 — EVERY host frame lands here, even between JS
//     ticks (at 240fps, 120 frames ≈ half a second of cushion).
//   __tel_frame()    → the current frame record: fps, gc_ns, present_us, gpu_us —
//     lets us ATTRIBUTE a spike (GC stall vs present/vsync stall vs raw GPU).
// A "skip" = a frame whose total time spikes past a multiple of the rolling
// median (a stalled present), which reads very differently from GC jank (which
// shows up as gc_ns). The peaks latch so a skip during one spin is caught even
// though fps (a 1s average) has already recovered by the time you look.
//
// Reuses the same host telemetry surface as state/perfWatch.ts and useTelemetry
// (the repo's one observability door — survey-before-build). Telemetry host fns
// exist in the dev host; a future COMPILED Studio must import useTelemetry to
// gate the __tel_* bindings into its binary.

import { useEffect, useRef, useState } from 'react';
import { callHost } from '@reactjit/runtime/ffi';

export type FrameDiag = {
  /** host fps (1-second average). */
  fps: number;
  /** rolling median frame time, ms — the "calm" baseline. */
  medianMs: number;
  /** worst frame time in the current ring, ms. */
  worstMs: number;
  /** LATCHED worst since the last reset, ms — catches a one-off spin hitch. */
  peakMs: number;
  /** frames in the current ring over the skip threshold (a hard skip). */
  skips: number;
  /** LATCHED total skips since the last reset. */
  peakSkips: number;
  /** worst GC wall-time recently, ms — a spike here is GC, not a present stall. */
  gcMs: number;
  /** GC invocations this frame — 0 here means GC GENUINELY never fired (vs a
   *  broken/dead reading). The honest disambiguation of a flat 0. */
  gcCount: number;
  /** worst present/vsync wait recently, ms — a spike here is a present stall. */
  presentMs: number;
  /** true once the host telemetry ring has answered at least once. */
  live: boolean;
  // ── Camera tick cadence (__game_camera_probe) — the spin-stutter smoking gun.
  // The host solves+smooths the bound camera in the __jsTick loop, NOT the 240fps
  // render loop. If camHz << render fps, the camera pose steps coarsely under a
  // smooth display — the spin "skips" even though frames don't drop.
  /** the bound camera's mean step interval, ms (≈ 1000/camHz). */
  camAvgDtMs: number;
  /** camera steps counted in the last ~1s window (≈ camera Hz). */
  camFrames: number;
  /** the camera's worst per-step solved-position jump (world units) — how far
   *  the SMOOTHED camera lurched in one tick. Big = visible jump. */
  camSolvedStep: number;
  /** input-delta calls the host saw in the window (drag event throughput). */
  camDeltas: number;
  // ── Text resource gauges (req_1279) — the compass-letters-vanish smoking gun.
  // Glyphs silently drop two ways: the PER-FRAME instance buffer fills
  // (glyphCount ≥ glyphCap → trailing text like the compass, drawn last, drops),
  // or the ATLAS fills (atlasCount ≥ atlasCap → a NEW (codepoint,size,font) combo
  // can't rasterize; no eviction, so it's permanent for the session). Surfacing
  // both tells us WHICH is maxed when letters go missing.
  /** glyph instances submitted this frame. */
  glyphCount: number;
  /** per-frame glyph buffer cap (MAX_GLYPHS). */
  glyphCap: number;
  /** distinct glyphs cached in the atlas. */
  atlasCount: number;
  /** atlas cap (MAX_ATLAS_GLYPHS). */
  atlasCap: number;
  /** atlas misses this frame (a glyph had to rasterize fresh). */
  atlasMiss: number;
};

const EMPTY: FrameDiag = { fps: 0, medianMs: 0, worstMs: 0, peakMs: 0, skips: 0, peakSkips: 0, gcMs: 0, gcCount: 0, presentMs: 0, live: false, camAvgDtMs: 0, camFrames: 0, camSolvedStep: 0, camDeltas: 0, glyphCount: 0, glyphCap: 0, atlasCount: 0, atlasCap: 0, atlasMiss: 0 };

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Poll host frame telemetry; classify hard skips. `resetSeq` bumps clear the
 *  latched peaks (the overlay's "reset" press). */
export function useFrameProbe(opts: { active: boolean; pollMs?: number; resetSeq?: number; logToTerminal?: boolean }): FrameDiag {
  const { active, pollMs = 200, resetSeq = 0, logToTerminal = false } = opts;
  const [diag, setDiag] = useState<FrameDiag>(EMPTY);
  const peak = useRef({ ms: 0, skips: 0 });
  const sinceLogMs = useRef(0);

  // clear latched peaks when the caller bumps resetSeq.
  useEffect(() => { peak.current = { ms: 0, skips: 0 }; setDiag((d) => ({ ...d, peakMs: 0, peakSkips: 0 })); }, [resetSeq]);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = () => {
      if (stop) return;
      const ring = callHost<number[]>('__tel_history', [], 120) || [];
      const frame = callHost<any>('__tel_frame', null);
      const cam = callHost<any>('__game_camera_probe', null);
      if (ring.length) {
        const us = ring.filter((v) => Number.isFinite(v) && v > 0);
        const sorted = us.slice().sort((a, b) => a - b);
        const medUs = median(sorted);
        const worstUs = sorted.length ? sorted[sorted.length - 1] : 0;
        // skip = a frame BOTH ≥2× the calm median AND ≥4 ms slower than it (two
        // gates so we ignore proportional jitter on fast frames and tiny wobble).
        const thresholdUs = Math.max(medUs * 2, medUs + 4000);
        const skips = us.filter((v) => v >= thresholdUs).length;
        const worstMs = worstUs / 1000;
        peak.current.ms = Math.max(peak.current.ms, worstMs);
        peak.current.skips += skips;
        const fps = Number(frame?.fps) || (medUs > 0 ? 1e6 / medUs : 0);
        const gcMs = (Number(frame?.gc_ns) || 0) / 1e6;
        const gcCount = Number(frame?.gc_count) || 0;
        const presentMs = (Number(frame?.present_us) || 0) / 1000;
        const camAvgDtMs = Number(cam?.avg_dt_ms) || 0;
        const camFrames = Number(cam?.frames) || 0;
        const camSolvedStep = Number(cam?.max_solved_step) || 0;
        const camDeltas = Number(cam?.deltas) || 0;
        const glyphCount = Number(frame?.glyph_count) || 0;
        const glyphCap = Number(frame?.glyph_capacity) || 0;
        const atlasCount = Number(frame?.atlas_glyph_count) || 0;
        const atlasCap = Number(frame?.atlas_capacity) || 0;
        const atlasMiss = Number(frame?.atlas_miss_count) || 0;
        setDiag({
          fps,
          medianMs: medUs / 1000,
          worstMs,
          peakMs: peak.current.ms,
          skips,
          peakSkips: peak.current.skips,
          gcMs,
          gcCount,
          presentMs,
          live: true,
          camAvgDtMs,
          camFrames,
          camSolvedStep,
          camDeltas,
          glyphCount,
          glyphCap,
          atlasCount,
          atlasCap,
          atlasMiss,
        });
        // Mirror the host-frame truth to the dev terminal once a second — that's
        // the stream the user pastes; the on-screen box alone isn't enough. The
        // cam line is the spin-stutter probe: camHz = 1000/avgDt; if it's ~60
        // while render fps is 240, the camera steps coarsely under a smooth
        // display. gcN proves gc=0 is "never fired", not a dead reading.
        if (logToTerminal) {
          sinceLogMs.current += pollMs;
          if (sinceLogMs.current >= 1000) {
            sinceLogMs.current = 0;
            const camHz = camAvgDtMs > 0 ? 1000 / camAvgDtMs : 0;
            console.warn(`[studio-frames] fps=${fps.toFixed(0)} med=${(medUs / 1000).toFixed(2)}ms worst=${worstMs.toFixed(2)}ms peak=${peak.current.ms.toFixed(2)}ms skips=${skips}now/${peak.current.skips}tot gc=${gcMs.toFixed(2)}ms(${gcCount}fired) present=${presentMs.toFixed(2)}ms`);
            console.warn(`[studio-cam-host] camHz=${camHz.toFixed(0)} avgDt=${camAvgDtMs.toFixed(2)}ms camSteps/s=${camFrames} solvedStepMax=${camSolvedStep.toFixed(4)} inputDeltas=${camDeltas}`);
          }
        }
      }
    };
    tick();
    const h = setInterval(tick, pollMs);
    return () => { stop = true; clearInterval(h); };
  }, [active, pollMs]);

  return diag;
}
