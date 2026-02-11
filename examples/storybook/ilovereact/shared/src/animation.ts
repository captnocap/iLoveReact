/**
 * Animation system for react-love.
 *
 * Provides AnimatedValue (mutable value container), timing/spring animations,
 * composite animations (parallel, sequence, stagger, loop), convenience hooks
 * (useAnimation, useSpring, useTransition), easing functions, and interpolation.
 *
 * Works in both web mode (requestAnimationFrame) and native mode (fallback to
 * setTimeout at ~60fps if requestAnimationFrame is unavailable).
 */

import { useState, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────

export type EasingFunction = (t: number) => number;

export interface Animation {
  start(callback?: (result: { finished: boolean }) => void): void;
  stop(): void;
}

export interface TimingConfig {
  toValue: number;
  duration?: number;
  easing?: EasingFunction;
  delay?: number;
}

export interface SpringConfig {
  toValue: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
  restThreshold?: number;
}

export interface InterpolationConfig {
  inputRange: number[];
  outputRange: number[] | string[];
  extrapolate?: 'clamp' | 'extend';
}

// ── Shared animation frame loop ──────────────────────────

type FrameCallback = (timestamp: number) => void;

const activeCallbacks = new Set<FrameCallback>();
let loopRunning = false;

function requestFrame(cb: (timestamp: number) => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(() => cb(Date.now()), 1000 / 60);
  }
}

function tick(timestamp: number): void {
  // Snapshot the callbacks so removals during iteration are safe
  const snapshot = Array.from(activeCallbacks);
  for (const cb of snapshot) {
    cb(timestamp);
  }
  if (activeCallbacks.size > 0) {
    requestFrame(tick);
  } else {
    loopRunning = false;
  }
}

function registerFrameCallback(cb: FrameCallback): void {
  activeCallbacks.add(cb);
  if (!loopRunning) {
    loopRunning = true;
    requestFrame(tick);
  }
}

function unregisterFrameCallback(cb: FrameCallback): void {
  activeCallbacks.delete(cb);
}

// ── Easing ───────────────────────────────────────────────

export const Easing = {
  linear: (t: number): number => t,

  easeIn: (t: number): number => t * t,

  easeOut: (t: number): number => t * (2 - t),

  easeInOut: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  bezier(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): EasingFunction {
    // Newton-Raphson iteration to solve cubic bezier for t given x
    return (t: number): number => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;

      // Solve for the parameter u where bezierX(u) = t
      let u = t;
      for (let i = 0; i < 8; i++) {
        const xEst = cubicBezier(u, x1, x2) - t;
        if (Math.abs(xEst) < 1e-6) break;
        const dx = cubicBezierDerivative(u, x1, x2);
        if (Math.abs(dx) < 1e-6) break;
        u -= xEst / dx;
      }
      u = Math.max(0, Math.min(1, u));
      return cubicBezier(u, y1, y2);
    };
  },

  bounce: (t: number): number => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      const t2 = t - 1.5 / 2.75;
      return 7.5625 * t2 * t2 + 0.75;
    } else if (t < 2.5 / 2.75) {
      const t2 = t - 2.25 / 2.75;
      return 7.5625 * t2 * t2 + 0.9375;
    } else {
      const t2 = t - 2.625 / 2.75;
      return 7.5625 * t2 * t2 + 0.984375;
    }
  },

  elastic(bounciness: number = 1): EasingFunction {
    const p = 0.3 / Math.max(bounciness, 0.001);
    return (t: number): number => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return (
        Math.pow(2, -10 * t) *
          Math.sin(((t - p / 4) * (2 * Math.PI)) / p) +
        1
      );
    };
  },
} as const;

function cubicBezier(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function cubicBezierDerivative(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

// ── Color interpolation helpers ──────────────────────────

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(str: string): RGBA | null {
  const rgbaMatch = str.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?))?\s*\)/,
  );
  if (rgbaMatch) {
    return {
      r: parseFloat(rgbaMatch[1]),
      g: parseFloat(rgbaMatch[2]),
      b: parseFloat(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }
  return null;
}

function lerpColor(from: RGBA, to: RGBA, t: number): string {
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  const a = from.a + (to.a - from.a) * t;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ── Interpolation helper ─────────────────────────────────

function interpolateValue(
  value: number,
  config: InterpolationConfig,
): number | string {
  const { inputRange, outputRange, extrapolate = 'extend' } = config;

  if (inputRange.length < 2 || outputRange.length < 2) {
    throw new Error('inputRange and outputRange must have at least 2 elements');
  }
  if (inputRange.length !== outputRange.length) {
    throw new Error('inputRange and outputRange must have the same length');
  }

  // Find the segment
  let segIndex = 0;
  for (let i = 1; i < inputRange.length; i++) {
    if (value <= inputRange[i]) {
      segIndex = i - 1;
      break;
    }
    segIndex = i - 1;
  }

  // Handle extrapolation
  if (value <= inputRange[0]) {
    segIndex = 0;
    if (extrapolate === 'clamp') {
      return outputRange[0];
    }
  }
  if (value >= inputRange[inputRange.length - 1]) {
    segIndex = inputRange.length - 2;
    if (extrapolate === 'clamp') {
      return outputRange[outputRange.length - 1];
    }
  }

  const inStart = inputRange[segIndex];
  const inEnd = inputRange[segIndex + 1];
  const outStart = outputRange[segIndex];
  const outEnd = outputRange[segIndex + 1];

  const t = inEnd === inStart ? 0 : (value - inStart) / (inEnd - inStart);

  // String output: attempt color interpolation
  if (typeof outStart === 'string' && typeof outEnd === 'string') {
    const fromColor = parseColor(outStart);
    const toColor = parseColor(outEnd);
    if (fromColor && toColor) {
      return lerpColor(fromColor, toColor, t);
    }
    // Fallback: return nearest string
    return t < 0.5 ? outStart : outEnd;
  }

  // Numeric interpolation
  const numStart = outStart as number;
  const numEnd = outEnd as number;
  return numStart + (numEnd - numStart) * t;
}

// ── AnimatedValue ────────────────────────────────────────

export class AnimatedValue {
  private _value: number;
  private _listeners: Set<(value: number) => void>;
  private _activeAnimation: { stop: () => void } | null;

  constructor(initialValue: number) {
    this._value = initialValue;
    this._listeners = new Set();
    this._activeAnimation = null;
  }

  getValue(): number {
    return this._value;
  }

  setValue(value: number): void {
    if (this._activeAnimation) {
      this._activeAnimation.stop();
      this._activeAnimation = null;
    }
    this._updateValue(value);
  }

  addListener(callback: (value: number) => void): () => void {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  timing(config: TimingConfig): Animation {
    return createTimingAnimation(this, config);
  }

  spring(config: SpringConfig): Animation {
    return createSpringAnimation(this, config);
  }

  interpolate(config: InterpolationConfig): number | string {
    return interpolateValue(this._value, config);
  }

  /** @internal */
  _updateValue(value: number): void {
    this._value = value;
    for (const listener of this._listeners) {
      listener(value);
    }
  }

  /** @internal */
  _setActiveAnimation(animation: { stop: () => void } | null): void {
    this._activeAnimation = animation;
  }

  /** @internal */
  _stopActiveAnimation(): void {
    if (this._activeAnimation) {
      this._activeAnimation.stop();
      this._activeAnimation = null;
    }
  }
}

// ── Timing animation ─────────────────────────────────────

function createTimingAnimation(
  animatedValue: AnimatedValue,
  config: TimingConfig,
): Animation {
  const {
    toValue,
    duration = 300,
    easing = Easing.easeInOut,
    delay = 0,
  } = config;

  let stopped = false;
  let startTime: number | null = null;
  let startValue: number;
  let delayTimeout: ReturnType<typeof setTimeout> | null = null;
  let onDone: ((result: { finished: boolean }) => void) | undefined;

  const frameCb = (timestamp: number): void => {
    if (stopped) return;

    if (startTime === null) {
      startTime = timestamp;
      startValue = animatedValue.getValue();
    }

    const elapsed = timestamp - startTime;

    if (elapsed >= duration) {
      animatedValue._updateValue(toValue);
      cleanup();
      if (onDone) onDone({ finished: true });
      return;
    }

    const progress = easing(elapsed / duration);
    const newValue = startValue + (toValue - startValue) * progress;
    animatedValue._updateValue(newValue);
  };

  function cleanup(): void {
    stopped = true;
    unregisterFrameCallback(frameCb);
    animatedValue._setActiveAnimation(null);
    if (delayTimeout !== null) {
      clearTimeout(delayTimeout);
      delayTimeout = null;
    }
  }

  const animation: Animation = {
    start(callback?: (result: { finished: boolean }) => void): void {
      stopped = false;
      startTime = null;
      onDone = callback;

      // Stop any currently running animation on this value
      animatedValue._stopActiveAnimation();
      animatedValue._setActiveAnimation({ stop: animation.stop });

      startValue = animatedValue.getValue();

      if (delay > 0) {
        delayTimeout = setTimeout(() => {
          delayTimeout = null;
          if (!stopped) {
            registerFrameCallback(frameCb);
          }
        }, delay);
      } else {
        registerFrameCallback(frameCb);
      }
    },

    stop(): void {
      if (!stopped) {
        cleanup();
        if (onDone) onDone({ finished: false });
      }
    },
  };

  return animation;
}

// ── Spring animation ─────────────────────────────────────

function createSpringAnimation(
  animatedValue: AnimatedValue,
  config: SpringConfig,
): Animation {
  const {
    toValue,
    stiffness = 100,
    damping = 10,
    mass = 1,
    velocity: initialVelocity = 0,
    restThreshold = 0.001,
  } = config;

  let stopped = false;
  let position: number;
  let velocity: number;
  let lastTimestamp: number | null = null;
  let onDone: ((result: { finished: boolean }) => void) | undefined;

  const frameCb = (timestamp: number): void => {
    if (stopped) return;

    if (lastTimestamp === null) {
      lastTimestamp = timestamp;
      position = animatedValue.getValue();
      velocity = initialVelocity;
    }

    // dt in seconds, clamped to avoid spiral of death
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.064);
    lastTimestamp = timestamp;

    // Verlet integration
    const displacement = position - toValue;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;

    velocity += acceleration * dt;
    position += velocity * dt;

    animatedValue._updateValue(position);

    // Check rest condition
    if (
      Math.abs(velocity) < restThreshold &&
      Math.abs(position - toValue) < restThreshold
    ) {
      animatedValue._updateValue(toValue);
      cleanup();
      if (onDone) onDone({ finished: true });
      return;
    }
  };

  function cleanup(): void {
    stopped = true;
    unregisterFrameCallback(frameCb);
    animatedValue._setActiveAnimation(null);
  }

  const animation: Animation = {
    start(callback?: (result: { finished: boolean }) => void): void {
      stopped = false;
      lastTimestamp = null;
      onDone = callback;

      animatedValue._stopActiveAnimation();
      animatedValue._setActiveAnimation({ stop: animation.stop });

      position = animatedValue.getValue();
      velocity = initialVelocity;

      registerFrameCallback(frameCb);
    },

    stop(): void {
      if (!stopped) {
        cleanup();
        if (onDone) onDone({ finished: false });
      }
    },
  };

  return animation;
}

// ── Composite animations ─────────────────────────────────

export function parallel(animations: Animation[]): Animation {
  let stoppedAll = false;

  return {
    start(callback?: (result: { finished: boolean }) => void): void {
      stoppedAll = false;

      if (animations.length === 0) {
        if (callback) callback({ finished: true });
        return;
      }

      let completedCount = 0;
      let allFinished = true;

      for (const anim of animations) {
        anim.start((result) => {
          if (stoppedAll) return;
          if (!result.finished) allFinished = false;
          completedCount++;
          if (completedCount === animations.length) {
            if (callback) callback({ finished: allFinished });
          }
        });
      }
    },

    stop(): void {
      stoppedAll = true;
      for (const anim of animations) {
        anim.stop();
      }
    },
  };
}

export function sequence(animations: Animation[]): Animation {
  let currentIndex = 0;
  let stopped = false;

  function runNext(callback?: (result: { finished: boolean }) => void): void {
    if (stopped || currentIndex >= animations.length) {
      if (callback) callback({ finished: !stopped });
      return;
    }

    animations[currentIndex].start((result) => {
      if (stopped) return;
      if (!result.finished) {
        if (callback) callback({ finished: false });
        return;
      }
      currentIndex++;
      runNext(callback);
    });
  }

  return {
    start(callback?: (result: { finished: boolean }) => void): void {
      currentIndex = 0;
      stopped = false;
      runNext(callback);
    },

    stop(): void {
      stopped = true;
      if (currentIndex < animations.length) {
        animations[currentIndex].stop();
      }
    },
  };
}

export function stagger(delay: number, animations: Animation[]): Animation {
  let stopped = false;
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  return {
    start(callback?: (result: { finished: boolean }) => void): void {
      stopped = false;

      if (animations.length === 0) {
        if (callback) callback({ finished: true });
        return;
      }

      let completedCount = 0;
      let allFinished = true;

      for (let i = 0; i < animations.length; i++) {
        const timeout = setTimeout(() => {
          if (stopped) return;
          animations[i].start((result) => {
            if (stopped) return;
            if (!result.finished) allFinished = false;
            completedCount++;
            if (completedCount === animations.length) {
              if (callback) callback({ finished: allFinished });
            }
          });
        }, delay * i);
        timeouts.push(timeout);
      }
    },

    stop(): void {
      stopped = true;
      for (const t of timeouts) {
        clearTimeout(t);
      }
      timeouts.length = 0;
      for (const anim of animations) {
        anim.stop();
      }
    },
  };
}

export function loop(
  animation: Animation,
  config?: { iterations?: number },
): Animation {
  const iterations = config?.iterations ?? -1; // -1 means infinite
  let currentIteration = 0;
  let stopped = false;

  function runIteration(
    callback?: (result: { finished: boolean }) => void,
  ): void {
    if (stopped) return;

    animation.start((result) => {
      if (stopped) return;
      if (!result.finished) {
        if (callback) callback({ finished: false });
        return;
      }

      currentIteration++;

      if (iterations > 0 && currentIteration >= iterations) {
        if (callback) callback({ finished: true });
        return;
      }

      runIteration(callback);
    });
  }

  return {
    start(callback?: (result: { finished: boolean }) => void): void {
      currentIteration = 0;
      stopped = false;
      runIteration(callback);
    },

    stop(): void {
      stopped = true;
      animation.stop();
    },
  };
}

// ── Hooks ────────────────────────────────────────────────

/**
 * Primary hook for consuming animated values.
 * Returns [AnimatedValue, currentNumericValue].
 * The component re-renders when the value changes (batched to animation frames).
 */
export function useAnimation(
  initialValue: number,
): [AnimatedValue, number] {
  const animRef = useRef<AnimatedValue | null>(null);
  if (animRef.current === null) {
    animRef.current = new AnimatedValue(initialValue);
  }

  const [currentValue, setCurrentValue] = useState(initialValue);

  useEffect(() => {
    const animatedValue = animRef.current!;

    // Batch updates: only schedule a state update once per frame
    let pendingValue: number | null = null;
    let frameScheduled = false;

    const scheduleUpdate = (): void => {
      if (frameScheduled) return;
      frameScheduled = true;
      requestFrame(() => {
        frameScheduled = false;
        if (pendingValue !== null) {
          const val = pendingValue;
          pendingValue = null;
          setCurrentValue(val);
        }
      });
    };

    const unsubscribe = animatedValue.addListener((value) => {
      pendingValue = value;
      scheduleUpdate();
    });

    return () => {
      unsubscribe();
      animatedValue._stopActiveAnimation();
    };
  }, []);

  return [animRef.current, currentValue];
}

/**
 * Convenience hook: automatically springs to `targetValue` whenever it changes.
 * Returns the current interpolated value (triggers re-render).
 */
export function useSpring(
  targetValue: number,
  config?: {
    stiffness?: number;
    damping?: number;
    mass?: number;
  },
): number {
  const [animatedValue, currentValue] = useAnimation(targetValue);
  const isFirstRender = useRef(true);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    // Skip animation on the very first render; value is already at target
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const anim = animatedValue.spring({
      toValue: targetValue,
      stiffness: configRef.current?.stiffness,
      damping: configRef.current?.damping,
      mass: configRef.current?.mass,
    });
    anim.start();

    return () => {
      anim.stop();
    };
  }, [targetValue, animatedValue]);

  return currentValue;
}

/**
 * Convenience hook: automatically transitions to `value` with timing-based easing.
 * Returns the current interpolated value (triggers re-render).
 */
export function useTransition(
  value: number,
  config?: {
    duration?: number;
    easing?: EasingFunction;
  },
): number {
  const [animatedValue, currentValue] = useAnimation(value);
  const isFirstRender = useRef(true);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const anim = animatedValue.timing({
      toValue: value,
      duration: configRef.current?.duration,
      easing: configRef.current?.easing,
    });
    anim.start();

    return () => {
      anim.stop();
    };
  }, [value, animatedValue]);

  return currentValue;
}
