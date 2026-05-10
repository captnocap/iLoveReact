import React from 'react';
import { Box, Pressable, Text, Video } from '../../../runtime/primitives';
import { useVideo } from '../../../runtime/hooks/useVideo';
import { TimeSlider } from './TimeSlider';

function formatVideoTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoPlayer({
  src,
  duration: initialDuration,
}: {
  src: string;
  duration?: number;
}) {
  const v = useVideo(src, { pollMs: 250 });
  const [showOverlay, setShowOverlay] = React.useState(true);
  const [wasPlaying, setWasPlaying] = React.useState(false);
  const hideTimeoutRef = React.useRef<any>(null);
  const overlayRef = React.useRef(showOverlay);
  overlayRef.current = showOverlay;

  const playing = !v.paused;
  const currentTime = Number.isFinite(v.currentTime) ? v.currentTime : 0;
  const duration =
    Number.isFinite(v.duration) && v.duration > 0
      ? v.duration
      : initialDuration ?? 0;
  const ended = duration > 0 && currentTime >= duration - 0.2;

  // Track play-state transitions so we can detect end-of-playback
  React.useEffect(() => {
    if (playing && !wasPlaying) setWasPlaying(true);
    if (!playing && wasPlaying) {
      setShowOverlay(true);
      setWasPlaying(false);
    }
  }, [playing, wasPlaying]);

  // Auto-hide overlay while actively playing (not ended)
  React.useEffect(() => {
    if (!playing || ended) {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      setShowOverlay(true);
      return;
    }
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      if (overlayRef.current) setShowOverlay(false);
    }, 2500);
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [playing, ended, currentTime]);

  const togglePlay = () => {
    if (ended) {
      v.seek(0);
      v.play();
    } else if (playing) {
      v.pause();
    } else {
      v.play();
    }
  };

  const seek = (delta: number) => {
    const next = Math.max(0, Math.min(duration || Infinity, currentTime + delta));
    v.seek(next);
  };

  const seekTo = (ratio: number) => {
    const next = Math.max(0, Math.min(duration || Infinity, duration * ratio));
    v.seek(next);
  };

  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Video src={src} style={{ width: '100%', height: '100%' }} loop={false} volume={1} />

      {/* Invisible hit area to bring back hidden controls */}
      {!showOverlay && (
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => setShowOverlay(true)}
        />
      )}

      {showOverlay && (
        <Box
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'space-between',
          }}
        >
          {/* Tap center to toggle play or hide overlay */}
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 56 }}
            onPress={() => {
              if (playing && !ended) setShowOverlay(false);
              else togglePlay();
            }}
          />

          {/* Big play button when paused or ended */}
          {(!playing || ended) && (
            <Box
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pressable onPress={togglePlay}>
                <Text style={{ fontSize: 56, color: '#ffffff' }}>
                  {ended ? '↻' : '▶'}
                </Text>
              </Pressable>
            </Box>
          )}

          {/* Bottom control bar */}
          <Box
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              paddingLeft: 14,
              paddingRight: 14,
              paddingTop: 10,
              paddingBottom: 10,
              backgroundColor: 'rgba(0,0,0,0.7)',
            }}
          >
            <Box
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <Pressable onPress={() => seek(-10)}>
                <Text style={{ fontSize: 12, color: '#ffffff' }}>⟲ 10s</Text>
              </Pressable>
              <Pressable onPress={togglePlay}>
                <Text style={{ fontSize: 18, color: '#ffffff' }}>
                  {playing && !ended ? '⏸' : '▶'}
                </Text>
              </Pressable>
              <Pressable onPress={() => seek(10)}>
                <Text style={{ fontSize: 12, color: '#ffffff' }}>10s ⟳</Text>
              </Pressable>
              <Box style={{ flexGrow: 1 }} />
              <Text style={{ fontSize: 12, color: '#ffffff' }}>
                {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
              </Text>
            </Box>

            {/* Draggable progress bar */}
            <TimeSlider
              value={currentTime}
              min={0}
              max={duration || 1}
              onChange={(next) => v.seek(next)}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}


