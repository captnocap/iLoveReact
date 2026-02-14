/**
 * <Video> — bare video surface primitive
 *
 * In web mode:   renders as <video> HTML element
 * In native mode: renders as 'Video' host element for the Love2D painter
 *
 * Follows the same sizing model as <Image> (explicit width/height required).
 * Supports objectFit via style, and playback control via props.
 */

import React from 'react';
import { useRendererMode } from './context';
import { styleToCSS } from './primitives';
import type { VideoProps, Style } from './types';

/** Build a Style from Video shorthand props. style={} overrides. */
function resolveVideoStyle(props: VideoProps): Style | undefined {
  const { w, h, radius, style } = props;

  if (w === undefined && h === undefined && radius === undefined) {
    return style;
  }

  const base: Style = {};
  if (w !== undefined) base.width = w;
  if (h !== undefined) base.height = h;
  if (radius !== undefined) base.borderRadius = radius;

  return style ? { ...base, ...style } : base;
}

export function Video(props: VideoProps) {
  const {
    src,
    paused = false,
    loop = false,
    muted = false,
    volume = 1,
    onClick,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
    onReady,
    onError,
  } = props;
  const resolvedStyle = resolveVideoStyle(props);
  const mode = useRendererMode();

  if (mode === 'web') {
    return (
      <video
        src={src}
        autoPlay={!paused}
        loop={loop}
        muted={muted}
        style={{
          ...styleToCSS(resolvedStyle),
          display: 'block',
          flexDirection: undefined,
          objectFit: resolvedStyle?.objectFit as any,
        }}
        onClick={onClick as any}
        onTimeUpdate={onTimeUpdate ? (e) => {
          const el = e.currentTarget;
          onTimeUpdate({ currentTime: el.currentTime, duration: el.duration });
        } : undefined}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
        onCanPlay={onReady}
        onError={onError ? () => onError({ message: 'Video playback error' }) : undefined}
      />
    );
  }

  return React.createElement('Video', {
    src,
    paused,
    loop,
    muted,
    volume,
    style: resolvedStyle,
    onClick,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
    onReady,
    onError,
  });
}
