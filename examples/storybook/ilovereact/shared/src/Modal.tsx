/**
 * Modal component for react-love
 *
 * Displays content in a full-screen overlay with backdrop. Works in both web mode
 * and native mode via the Portal system.
 *
 * Features:
 * - Backdrop with customizable color and transparency
 * - Centered content with flexbox
 * - Dismissal via backdrop press or Escape key
 * - Simple animations (none, fade, slide)
 * - Lifecycle callbacks (onShow, onRequestClose)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Portal } from './Portal';
import { Box } from './primitives';
import { Pressable } from './Pressable';
import { useRendererMode } from './context';
import type { Style, Color, LoveEvent } from './types';

export interface ModalProps {
  visible: boolean;
  onRequestClose?: () => void;
  onShow?: () => void;
  animationType?: 'none' | 'fade' | 'slide';
  transparent?: boolean;
  backdropColor?: Color;
  backdropDismiss?: boolean;
  children: React.ReactNode;
  style?: Style;
}

export function Modal({
  visible,
  onRequestClose,
  onShow,
  animationType = 'none',
  transparent = false,
  backdropColor = [0, 0, 0, 0.5],
  backdropDismiss = true,
  children,
  style,
}: ModalProps) {
  const mode = useRendererMode();
  const [animationState, setAnimationState] = useState<'entering' | 'entered' | 'exiting' | 'exited'>(
    visible ? 'entered' : 'exited'
  );
  const previousVisibleRef = useRef(visible);
  const onShowCalledRef = useRef(false);

  // Handle visibility changes
  useEffect(() => {
    if (visible === previousVisibleRef.current) return;
    previousVisibleRef.current = visible;

    if (visible) {
      onShowCalledRef.current = false;
      if (animationType === 'none') {
        setAnimationState('entered');
      } else {
        setAnimationState('entering');
        // Trigger animation
        const steps = 4;
        const duration = 200;
        const stepDuration = duration / steps;
        let currentStep = 0;

        const interval = setInterval(() => {
          currentStep++;
          if (currentStep >= steps) {
            clearInterval(interval);
            setAnimationState('entered');
          }
        }, stepDuration);
      }
    } else {
      if (animationType === 'none') {
        setAnimationState('exited');
      } else {
        setAnimationState('exiting');
        // Trigger exit animation
        const steps = 4;
        const duration = 200;
        const stepDuration = duration / steps;
        let currentStep = 0;

        const interval = setInterval(() => {
          currentStep++;
          if (currentStep >= steps) {
            clearInterval(interval);
            setAnimationState('exited');
          }
        }, stepDuration);
      }
    }
  }, [visible, animationType]);

  // Call onShow when animation completes
  useEffect(() => {
    if (animationState === 'entered' && !onShowCalledRef.current && onShow) {
      onShowCalledRef.current = true;
      onShow();
    }
  }, [animationState, onShow]);

  // Escape key handler
  useEffect(() => {
    if (!visible || !onRequestClose) return;

    const handleKeyDown = (event: KeyboardEvent | LoveEvent) => {
      const key = (event as any).key;
      if (key === 'Escape') {
        onRequestClose();
      }
    };

    if (mode === 'web') {
      document.addEventListener('keydown', handleKeyDown as any);
      return () => {
        document.removeEventListener('keydown', handleKeyDown as any);
      };
    }
    // Native mode: key handler is attached to the Box component
  }, [visible, onRequestClose, mode]);

  // Prevent body scroll in web mode
  useEffect(() => {
    if (mode === 'web' && visible) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [mode, visible]);

  // Backdrop press handler
  const handleBackdropPress = useCallback(() => {
    if (backdropDismiss && onRequestClose) {
      onRequestClose();
    }
  }, [backdropDismiss, onRequestClose]);

  // Native mode key handler
  const handleKeyDown = useCallback((event: LoveEvent) => {
    if (event.key === 'Escape' && onRequestClose) {
      onRequestClose();
    }
  }, [onRequestClose]);

  // Don't render if not visible and animation is complete
  if (!visible && animationState === 'exited') {
    return null;
  }

  // Calculate animation styles
  let contentOpacity = 1;
  let contentTranslateY = 0;
  let backdropOpacity = 1;

  if (animationType === 'fade') {
    if (animationState === 'entering') {
      contentOpacity = 0.25;
      backdropOpacity = 0.25;
    } else if (animationState === 'exiting') {
      contentOpacity = 0.25;
      backdropOpacity = 0.25;
    }
  } else if (animationType === 'slide') {
    if (animationState === 'entering') {
      contentTranslateY = 100;
    } else if (animationState === 'exiting') {
      contentTranslateY = 100;
    }
  }

  // Compute backdrop color
  const finalBackdropColor = transparent ? [0, 0, 0, 0] as Color : backdropColor;

  // Web mode: use CSS transitions
  const webTransition = animationType !== 'none' ? 'all 0.2s ease-out' : undefined;

  const contentStyle: Style = {
    ...style,
    opacity: contentOpacity,
    transform: contentTranslateY !== 0 ? { translateY: contentTranslateY } : undefined,
  };

  const content = (
    <Box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onKeyDown={mode === 'native' ? handleKeyDown : undefined}
    >
      {/* Backdrop */}
      <Pressable
        onPress={handleBackdropPress}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: finalBackdropColor,
          opacity: backdropOpacity,
        }}
      >
        <Box style={{ width: '100%', height: '100%' }} />
      </Pressable>

      {/* Content */}
      {mode === 'web' ? (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            ...contentStyle,
            transition: webTransition,
            opacity: contentStyle.opacity,
            transform: contentStyle.transform
              ? `translateY(${contentStyle.transform.translateY}px)`
              : undefined,
          } as React.CSSProperties}
        >
          {children}
        </div>
      ) : (
        <Box
          style={{
            position: 'relative',
            zIndex: 1,
            ...contentStyle,
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );

  return <Portal>{content}</Portal>;
}
