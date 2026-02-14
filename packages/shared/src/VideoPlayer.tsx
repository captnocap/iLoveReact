/**
 * <VideoPlayer> — compound video component with built-in controls
 *
 * Wraps <Video> with a play/pause button, seek bar, and time display.
 * Controls auto-hide after 3 seconds of no interaction.
 *
 * Usage:
 *   <VideoPlayer src="movie.mp4" w={640} h={360} />
 *   <VideoPlayer src="movie.ogv" controls={false} />  // bare video, no controls
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Text } from './primitives';
import { Video } from './Video';
import type { VideoPlayerProps, VideoTimeEvent, Style } from './types';

function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || isNaN(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function VideoPlayer(props: VideoPlayerProps) {
  const {
    controls = true,
    src,
    paused: pausedProp,
    loop,
    muted,
    volume,
    style,
    w,
    h,
    radius,
    onTimeUpdate: onTimeUpdateProp,
    onEnded: onEndedProp,
    onPlay: onPlayProp,
    onPause: onPauseProp,
    onReady,
    onError,
    onClick,
  } = props;

  const [paused, setPaused] = useState(pausedProp ?? false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync controlled paused prop
  useEffect(() => {
    if (pausedProp !== undefined) {
      setPaused(pausedProp);
    }
  }, [pausedProp]);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!paused) setShowControls(false);
    }, 3000);
  }, [paused]);

  // Show controls when paused
  useEffect(() => {
    if (paused) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      resetHideTimer();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [paused, resetHideTimer]);

  const handleTimeUpdate = useCallback((event: VideoTimeEvent) => {
    setCurrentTime(event.currentTime);
    if (event.duration !== undefined) setDuration(event.duration);
    onTimeUpdateProp?.(event);
  }, [onTimeUpdateProp]);

  const handleEnded = useCallback(() => {
    setPaused(true);
    setShowControls(true);
    onEndedProp?.();
  }, [onEndedProp]);

  const togglePlay = useCallback(() => {
    const next = !paused;
    setPaused(next);
    if (next) {
      onPauseProp?.();
    } else {
      onPlayProp?.();
    }
    resetHideTimer();
  }, [paused, onPlayProp, onPauseProp, resetHideTimer]);

  const handleClick = useCallback((event: any) => {
    if (controls) {
      togglePlay();
    }
    onClick?.(event);
    resetHideTimer();
  }, [controls, togglePlay, onClick, resetHideTimer]);

  const progress = duration && duration > 0 ? (currentTime / duration) * 100 : 0;

  const containerStyle: Style = {
    ...(w !== undefined ? { width: w } : {}),
    ...(h !== undefined ? { height: h } : {}),
    ...(radius !== undefined ? { borderRadius: radius } : {}),
    ...style,
    overflow: 'hidden',
  };

  const videoStyle: Style = {
    width: '100%',
    height: '100%',
    ...(style?.objectFit ? { objectFit: style.objectFit } : {}),
  };

  return (
    <Box style={containerStyle}>
      <Video
        src={src}
        paused={paused}
        loop={loop}
        muted={muted}
        volume={volume}
        style={videoStyle}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPlay={onPlayProp}
        onPause={onPauseProp}
        onReady={onReady}
        onError={onError}
        onClick={handleClick}
      />
      {controls && showControls && (
        <Box
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            padding: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: [0, 0, 0, 0.6],
          }}
        >
          {/* Play/Pause button */}
          <Box
            onClick={togglePlay}
            style={{ padding: 4, paddingLeft: 8, paddingRight: 8 }}
            hoverStyle={{ backgroundColor: [1, 1, 1, 0.15] }}
          >
            <Text style={{ fontSize: 14, color: '#ffffff' }}>
              {paused ? '\u25B6' : '\u23F8'}
            </Text>
          </Box>

          {/* Seek bar */}
          <Box
            style={{
              flexGrow: 1,
              height: 4,
              backgroundColor: [1, 1, 1, 0.3],
              borderRadius: 2,
            }}
          >
            <Box
              style={{
                width: `${progress}%`,
                height: '100%',
                backgroundColor: '#ffffff',
                borderRadius: 2,
              }}
            />
          </Box>

          {/* Time display */}
          <Text style={{ fontSize: 11, color: [1, 1, 1, 0.8] }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
