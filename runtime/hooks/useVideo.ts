/**
 * useVideo — playback control for `<Video src=…>` (framework/videos.zig).
 *
 * Pair with the existing `<Video>` primitive: the primitive paints the
 * frames; this hook drives play/pause, seek, volume, loop, and exposes
 * the reactive playback clock + duration + load status.
 *
 *   const v = useVideo('/path/to/clip.mp4');
 *   v.status           // 'loading' | 'ready' | 'error' | 'none'
 *   v.paused           // boolean
 *   v.currentTime      // seconds (NaN until ready)
 *   v.duration         // seconds (NaN until ready)
 *   v.width / v.height // pixels (0 until ready)
 *   v.play() / v.pause() / v.toggle()
 *   v.seek(seconds)
 *   v.setVolume(0..1.5)
 *   v.setMuted(bool) / v.setLoop(bool)
 *
 * For one-shot imperative use without React state, call `videoControl(src)`
 * — same control surface, no polling, no re-renders.
 *
 * Note: a video only exists in the engine's playback table once a `<Video>`
 * (or `videoSrc`-bearing primitive) with that `src` has rendered at least
 * once. Calling `useVideo('foo.mp4')` without ever mounting `<Video src="foo.mp4">`
 * will report status='none' forever — the hook controls existing playback,
 * it does not create it.
 */

import { useEffect, useState } from 'react';
import { callHost, callHostJson } from '../ffi';

export type VideoStatus = 'loading' | 'ready' | 'error' | 'none';

export interface VideoControl {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setLoop: (loop: boolean) => void;
  getStatus: () => VideoStatus;
  getDimensions: () => { w: number; h: number } | null;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPaused: () => boolean;
}

export interface UseVideoResult extends VideoControl {
  status: VideoStatus;
  paused: boolean;
  currentTime: number;
  duration: number;
  width: number;
  height: number;
}

export function videoControl(src: string): VideoControl {
  return {
    play: () => callHost('__video_set_paused', undefined, src, 0),
    pause: () => callHost('__video_set_paused', undefined, src, 1),
    toggle: () => callHost('__video_set_paused', undefined, src, callHost<boolean>('__video_get_paused', true, src) ? 0 : 1),
    seek: (s) => callHost('__video_seek', undefined, src, s),
    // Volume crosses the bridge as ×100 int (callHost prefers ints/strings).
    setVolume: (v) => callHost('__video_set_volume', undefined, src, Math.round(v * 100)),
    setMuted: (m) => callHost('__video_set_muted', undefined, src, m ? 1 : 0),
    setLoop: (l) => callHost('__video_set_loop', undefined, src, l ? 1 : 0),
    getStatus: () => callHost<VideoStatus>('__video_get_status', 'none', src),
    getDimensions: () => callHostJson<{ w: number; h: number } | null>('__video_get_dimensions', null, src),
    getCurrentTime: () => callHost<number>('__video_get_time', -1, src),
    getDuration: () => callHost<number>('__video_get_duration', -1, src),
    getPaused: () => callHost<boolean>('__video_get_paused', true, src),
  };
}

const POLL_MS = 250;

export function useVideo(src: string, opts: { pollMs?: number } = {}): UseVideoResult {
  const ctl = videoControl(src);
  const [status, setStatus] = useState<VideoStatus>('none');
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(NaN);
  const [duration, setDuration] = useState(NaN);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (!src) return;
    const tick = () => {
      const st = ctl.getStatus();
      setStatus(st);
      if (st === 'ready') {
        setPaused(ctl.getPaused());
        const t = ctl.getCurrentTime();
        if (t >= 0) setCurrentTime(t);
        const d = ctl.getDuration();
        if (d >= 0) setDuration(d);
        if (dims.w === 0 || dims.h === 0) {
          const r = ctl.getDimensions();
          if (r) setDims(r);
        }
      }
    };
    tick();
    const id = setInterval(tick, opts.pollMs ?? POLL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, opts.pollMs]);

  return {
    ...ctl,
    status,
    paused,
    currentTime,
    duration,
    width: dims.w,
    height: dims.h,
  };
}
