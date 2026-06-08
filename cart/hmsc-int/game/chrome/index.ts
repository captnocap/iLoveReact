// game/chrome/ — GAME_CHROME: the lab chrome kit + lab environment every lab
// gets for free (V14/V17). The old carts are behavior references only.

import { createElement, Fragment } from 'react';
import { Box, Col, Pressable, Row, Scene3D, Text } from '../../../../runtime/primitives';
import * as Geometry from '../../../../runtime/geometries';

export type Vec3 = [number, number, number];
export type LabChromeTone = 'accent' | 'cyan' | 'good' | 'warn' | 'bad' | 'ink' | 'dim';
export type LabEnvironmentPresetName = 'studio' | 'arena' | 'day-cycle' | 'hmsc-clear' | 'hmsc-hazy' | 'hmsc-cloudy' | 'hmsc-storm' | 'night';
export type LabSkyWeatherPresetName = 'clear' | 'hazy' | 'cloudy' | 'storm';
export type LabSkyNamedHour = 'midnight' | 'dawn' | 'noon' | 'dusk';

export type KnobSpec = {
  min: number;
  max: number;
  step: number;
  precision: number;
};

export type MeterSpec = {
  min: number;
  max: number;
  warnAt?: number;
  badAt?: number;
  invert?: boolean;
};

export type LabSky = {
  zenith: string;
  horizon: string;
  ground: string;
  sunDir: Vec3;
  sunColor: string;
  sunSize: number;
  sunGlow: number;
  haze: number;
  cloud: number;
  night: number;
  ambient: number;
  lightColor: string;
  lightIntensity: number;
};

export type ResolvedLabEnvironment = {
  preset: LabEnvironmentPresetName;
  sky: LabSky;
  ambient: { color: string; intensity: number };
  directional: { direction: Vec3; color: string; intensity: number };
  pointLights: Array<{ position: Vec3; color: string; intensity: number }>;
  fog: { enabled: boolean };
  ground: { width: number; height: number; depth: number; material: string; position: Vec3 };
};

type RGB = [number, number, number];

const e = createElement;

export const CHROME_TOKENS = {
  color: {
    page: '#070a10',
    panel: '#08111fee',
    panelSolid: '#0b1018',
    bar: '#111724',
    control: '#101a2a',
    controlAlt: '#151d2b',
    frame: '#22324a',
    frameWarm: '#263245',
    ink: '#e8eef8',
    dim: '#7f93b1',
    accent: '#3da9ff',
    cyan: '#5ad7e8',
    good: '#34d399',
    warn: '#f59e0b',
    bad: '#ef4444',
    gold: '#ffbe55',
  },
  tone: {
    accent: '#3da9ff',
    cyan: '#5ad7e8',
    good: '#34d399',
    warn: '#f59e0b',
    bad: '#ef4444',
    ink: '#e8eef8',
    dim: '#7f93b1',
  } satisfies Record<LabChromeTone, string>,
} as const;

export const CHROME_LAYOUT = {
  panel: { width: 320, padding: 12, gap: 10, radius: 8, borderWidth: 1 },
  topPanel: { padding: 12, gap: 12, meterMinWidth: 82, minHeight: 74 },
  chip: { paddingX: 10, paddingY: 5, radius: 5, borderWidth: 1, fontSize: 12 },
  knob: { labelWidth: 78, valueWidth: 52, buttonSize: 26, gap: 8, radius: 5, fontSize: 12 },
  meter: { minWidth: 82, labelFontSize: 10, valueFontSize: 13, barHeight: 7, barRadius: 3 },
  hudPill: { paddingX: 12, paddingY: 7, radius: 8, borderWidth: 1 },
} as const;

export const CHROME_KNOB_PRESETS: Record<string, KnobSpec> = {
  'carve.depth': { min: 0.05, max: 2, step: 0.05, precision: 2 },
  'carve.inflate': { min: 0, max: 1, step: 0.1, precision: 1 },
  'carve.zoom': { min: 1.2, max: 12, step: 0.4, precision: 1 },
  'orbit.zoom': { min: 4, max: 14, step: 0.5, precision: 1 },
  'gas.z': { min: -2, max: 2, step: 0.16, precision: 2 },
} as const;

export const LAB_SKY_TUNING = {
  hoursPerDay: 24,
  sunriseHour: 6,
  sunsetHour: 18,
  halfDayHours: 12,
  sunZForward: 0.22,
  epsilon: 0.0001,
  namedHours: {
    midnight: 0,
    dawn: 6,
    noon: 12,
    dusk: 18,
  } satisfies Record<LabSkyNamedHour, number>,
  weatherPresets: {
    clear: { weather: 0, gloom: 0 },
    hazy: { weather: 0.25, gloom: 0 },
    cloudy: { weather: 0.65, gloom: 0.1 },
    storm: { weather: 1, gloom: 0.45 },
  } satisfies Record<LabSkyWeatherPresetName, { weather: number; gloom: number }>,
  dayKeys: [
    { h: 0, zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },
    { h: 5, zenith: '#172a55', horizon: '#7a5a6e', sun: '#ff9a5a' },
    { h: 7, zenith: '#2a5aa8', horizon: '#c9b27e', sun: '#ffd28a' },
    { h: 12, zenith: '#1f6fd6', horizon: '#bcd6f0', sun: '#fff4d6' },
    { h: 17, zenith: '#2a5fb0', horizon: '#e0b285', sun: '#ffcf86' },
    { h: 19, zenith: '#1d2f63', horizon: '#c4615a', sun: '#ff7a44' },
    { h: 21, zenith: '#0a1330', horizon: '#2a2350', sun: '#3a4a72' },
    { h: 24, zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },
  ],
  base: {
    ground: '#0c0d10',
    sunSize: 0.018,
    cloud: 0.14,
    sunGlow: { night: 0.18, day: 0.42 },
    haze: { night: 0.22, day: 0.42 },
    ambient: { night: 0.34, day: 0.48 },
    lightIntensity: { night: 0.18, day: 0.95 },
  },
  weather: {
    grey: '#5a626e',
    stormDark: '#23262c',
    horizonGreyWeight: 0.85,
    maxCloud: 0.9,
    maxHaze: 0.72,
    maxSunGlow: 0.85,
    lightDim: 0.45,
    ambientDim: 0.8,
  },
  gloom: {
    zenith: '#1a221c',
    horizon: '#3b4a3f',
    ground: '#10130f',
    maxCloud: 0.8,
    maxHaze: 0.6,
    lightDim: 0.5,
    lightColor: '#9fb29a',
    ambient: 0.22,
  },
  hostContrast: {
    zenithToHorizon: 0.18,
    groundToBlue: 0.4,
    groundBlue: '#07111f',
  },
} as const;

const BASE_STUDIO_SKY: LabSky = {
  zenith: '#172a4c',
  horizon: '#5a7895',
  ground: '#0c1118',
  sunDir: [0.35, 0.75, 0.25],
  sunColor: '#ffe5ad',
  sunSize: 0.018,
  sunGlow: 0.32,
  haze: 0.2,
  cloud: 0.16,
  night: 0,
  ambient: 0.68,
  lightColor: '#ffe0ac',
  lightIntensity: 0.95,
};

export const LAB_ENVIRONMENT_PRESETS: Record<LabEnvironmentPresetName, Omit<ResolvedLabEnvironment, 'preset'>> = {
  studio: {
    sky: { ...BASE_STUDIO_SKY, zenith: '#0b1018', horizon: '#0b1018', cloud: 0, haze: 0.05, ambient: 0.6, lightIntensity: 0.85 },
    ambient: { color: '#aab8d6', intensity: 0.6 },
    directional: { direction: [0.4, 0.9, 0.35], color: '#fff0d6', intensity: 0.85 },
    pointLights: [],
    fog: { enabled: true },
    ground: { width: 7, height: 0.03, depth: 7, material: '#0e1726', position: [0, -0.015, 0] },
  },
  arena: {
    sky: BASE_STUDIO_SKY,
    ambient: { color: '#74839b', intensity: 0.68 },
    directional: { direction: [0.35, 0.85, 0.4], color: '#ffe0ac', intensity: 0.95 },
    pointLights: [
      { position: [-4.6, 4.8, -3.4], color: '#54d7ff', intensity: 0.45 },
      { position: [4.8, 3.9, 3.6], color: '#ff6e9c', intensity: 0.35 },
    ],
    fog: { enabled: true },
    ground: { width: 12.8, height: 0.16, depth: 12.8, material: '#1d2737', position: [0, -0.08, 0] },
  },
  'day-cycle': {
    sky: buildLabSky(12, 0, 0),
    ambient: { color: '#bcd6f0', intensity: 0.48 },
    directional: { direction: [0, 1, 0.22], color: '#fff4d6', intensity: 0.95 },
    pointLights: [],
    fog: { enabled: true },
    ground: { width: 60, height: 0.2, depth: 60, material: '#2b3326', position: [0, -0.1, -4] },
  },
  'hmsc-clear': hmscEnvironmentPreset('clear'),
  'hmsc-hazy': hmscEnvironmentPreset('hazy'),
  'hmsc-cloudy': hmscEnvironmentPreset('cloudy'),
  'hmsc-storm': hmscEnvironmentPreset('storm'),
  night: {
    sky: {
      zenith: '#03040a',
      horizon: '#0d1830',
      ground: '#03040a',
      sunDir: [0.5, 0.25, 0.4],
      sunColor: '#cfe2ff',
      sunSize: 0.004,
      sunGlow: 0.1,
      haze: 0.05,
      cloud: 0,
      night: 1,
      ambient: 0.55,
      lightColor: '#fff2d8',
      lightIntensity: 0.95,
    },
    ambient: { color: '#5e6f93', intensity: 0.55 },
    directional: { direction: [0.45, 0.85, 0.3], color: '#fff2d8', intensity: 0.95 },
    pointLights: [{ position: [0, 2.2, 0], color: '#ffd9a0', intensity: 0.5 }],
    fog: { enabled: false },
    ground: { width: 0, height: 0, depth: 0, material: '#03040a', position: [0, 0, 0] },
  },
} as const;

function hmscEnvironmentPreset(name: LabSkyWeatherPresetName): Omit<ResolvedLabEnvironment, 'preset'> {
  const sky = buildLabSky(12, LAB_SKY_TUNING.weatherPresets[name].weather, LAB_SKY_TUNING.weatherPresets[name].gloom);
  return {
    sky,
    ambient: { color: sky.horizon, intensity: sky.ambient },
    directional: { direction: sky.sunDir, color: sky.lightColor, intensity: sky.lightIntensity },
    pointLights: [],
    fog: { enabled: true },
    ground: { width: 60, height: 0.2, depth: 60, material: '#2b3326', position: [0, -0.1, -4] },
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

export function resolveKnobValue(value: number, direction: -1 | 1, spec: KnobSpec): number {
  return roundTo(clampNumber(value + spec.step * direction, spec.min, spec.max), spec.precision);
}

export function formatKnobValue(value: number, spec: KnobSpec): string {
  return clampNumber(value, spec.min, spec.max).toFixed(spec.precision);
}

export function resolveMeter(value: number, spec: MeterSpec = { min: 0, max: 1 }): { fraction: number; percent: number; width: string; tone: LabChromeTone; color: string } {
  const span = spec.max - spec.min;
  const raw = span === 0 ? 0 : (value - spec.min) / span;
  const fraction = clampNumber(spec.invert ? 1 - raw : raw, 0, 1);
  const percent = Math.round(fraction * 100);
  let tone: LabChromeTone = 'good';
  if (spec.badAt != null && fraction >= spec.badAt) tone = 'bad';
  else if (spec.warnAt != null && fraction >= spec.warnAt) tone = 'warn';
  return { fraction, percent, width: `${percent}%`, tone, color: CHROME_TOKENS.tone[tone] };
}

export function resolvePanelLayout(options: { width?: number; padding?: number; columns?: number; gap?: number } = {}): {
  width: number;
  padding: number;
  gap: number;
  contentWidth: number;
  columns: number;
  cellWidth: number;
} {
  const width = Math.max(0, options.width ?? CHROME_LAYOUT.panel.width);
  const padding = Math.max(0, options.padding ?? CHROME_LAYOUT.panel.padding);
  const gap = Math.max(0, options.gap ?? CHROME_LAYOUT.panel.gap);
  const columns = Math.max(1, Math.floor(options.columns ?? 1));
  const contentWidth = Math.max(0, width - padding * 2);
  const cellWidth = columns === 1 ? contentWidth : Math.max(0, (contentWidth - gap * (columns - 1)) / columns);
  return { width, padding, gap, contentWidth, columns, cellWidth };
}

function hexToRgb(hex: string): RGB {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => clampNumber(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const f = clampNumber(t, 0, 1);
  return rgbToHex([lerp(x[0], y[0], f), lerp(x[1], y[1], f), lerp(x[2], y[2], f)]);
}

function smooth(a: number, b: number, x: number): number {
  const t = clampNumber((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function normalizeSkyHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const day = LAB_SKY_TUNING.hoursPerDay;
  return ((hour % day) + day) % day;
}

export function clampSkyInfluence(value: number): number {
  return clampNumber(value, 0, 1);
}

function dayKey(hour: number): { zenith: string; horizon: string; sun: string } {
  const safeHour = normalizeSkyHour(hour);
  const keys = LAB_SKY_TUNING.dayKeys;
  let index = 0;
  while (index < keys.length - 1 && keys[index + 1].h <= safeHour) index += 1;
  const current = keys[index];
  const next = keys[Math.min(index + 1, keys.length - 1)];
  const span = Math.max(LAB_SKY_TUNING.epsilon, next.h - current.h);
  const t = clampSkyInfluence((safeHour - current.h) / span);
  return {
    zenith: mixHex(current.zenith, next.zenith, t),
    horizon: mixHex(current.horizon, next.horizon, t),
    sun: mixHex(current.sun, next.sun, t),
  };
}

function sunDirFor(hour: number): Vec3 {
  const angle = ((normalizeSkyHour(hour) - LAB_SKY_TUNING.sunriseHour) / LAB_SKY_TUNING.halfDayHours) * Math.PI;
  return [Math.cos(angle), Math.sin(angle), LAB_SKY_TUNING.sunZForward];
}

export function buildLabSky(hour: number, weather: number | LabSkyWeatherPresetName = 0, gloom = 0): LabSky {
  const weatherValue = typeof weather === 'string' ? LAB_SKY_TUNING.weatherPresets[weather].weather : weather;
  const gloomValue = typeof weather === 'string' ? Math.max(gloom, LAB_SKY_TUNING.weatherPresets[weather].gloom) : gloom;
  const safeHour = normalizeSkyHour(hour);
  const safeWeather = clampSkyInfluence(weatherValue);
  const safeGloom = clampSkyInfluence(gloomValue);
  const key = dayKey(safeHour);
  const sunDir = sunDirFor(safeHour);
  const elevation = sunDir[1];
  const night = smooth(0.04, -0.18, elevation);
  const day = clampSkyInfluence(elevation * 1.4);
  const base = LAB_SKY_TUNING.base;

  let sky: LabSky = {
    zenith: key.zenith,
    horizon: key.horizon,
    ground: base.ground,
    sunDir,
    sunColor: key.sun,
    sunSize: base.sunSize,
    sunGlow: lerp(base.sunGlow.night, base.sunGlow.day, day),
    haze: lerp(base.haze.night, base.haze.day, day),
    cloud: base.cloud,
    night,
    ambient: lerp(base.ambient.night, base.ambient.day, day),
    lightColor: key.sun,
    lightIntensity: lerp(base.lightIntensity.night, base.lightIntensity.day, day),
  };

  if (safeWeather > LAB_SKY_TUNING.epsilon) {
    const W = LAB_SKY_TUNING.weather;
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, mixHex(W.grey, W.stormDark, 0.4), safeWeather),
      horizon: mixHex(sky.horizon, W.grey, safeWeather * W.horizonGreyWeight),
      cloud: lerp(sky.cloud, W.maxCloud, safeWeather),
      haze: lerp(sky.haze, W.maxHaze, safeWeather),
      sunGlow: lerp(sky.sunGlow, W.maxSunGlow, safeWeather),
      lightIntensity: sky.lightIntensity * lerp(1, W.lightDim, safeWeather),
      ambient: sky.ambient * lerp(1, W.ambientDim, safeWeather),
    };
  }

  if (safeGloom > LAB_SKY_TUNING.epsilon) {
    const G = LAB_SKY_TUNING.gloom;
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, G.zenith, safeGloom),
      horizon: mixHex(sky.horizon, G.horizon, safeGloom),
      ground: mixHex(sky.ground, G.ground, safeGloom),
      cloud: lerp(sky.cloud, G.maxCloud, safeGloom),
      haze: lerp(sky.haze, G.maxHaze, safeGloom),
      lightIntensity: sky.lightIntensity * lerp(1, G.lightDim, safeGloom),
      lightColor: mixHex(sky.lightColor, G.lightColor, safeGloom),
      ambient: lerp(sky.ambient, G.ambient, safeGloom),
    };
  }

  return {
    ...sky,
    zenith: mixHex(sky.zenith, sky.horizon, LAB_SKY_TUNING.hostContrast.zenithToHorizon),
    ground: mixHex(sky.ground, LAB_SKY_TUNING.hostContrast.groundBlue, LAB_SKY_TUNING.hostContrast.groundToBlue),
  };
}

export function resolveLabEnvironment(options: {
  preset?: LabEnvironmentPresetName;
  hour?: number | LabSkyNamedHour;
  weather?: number | LabSkyWeatherPresetName;
  gloom?: number;
} = {}): ResolvedLabEnvironment {
  const preset = options.preset ?? 'day-cycle';
  const base = LAB_ENVIRONMENT_PRESETS[preset] ?? LAB_ENVIRONMENT_PRESETS['day-cycle'];
  const namedHour = typeof options.hour === 'string' ? LAB_SKY_TUNING.namedHours[options.hour] : options.hour;
  const dynamic = preset === 'day-cycle' || preset.startsWith('hmsc-') || options.hour != null || options.weather != null || options.gloom != null;
  const sky = dynamic ? buildLabSky(namedHour ?? 12, options.weather ?? 0, options.gloom ?? 0) : base.sky;
  return {
    preset,
    sky,
    ambient: dynamic ? { color: sky.horizon, intensity: sky.ambient } : base.ambient,
    directional: dynamic ? { direction: sky.sunDir, color: sky.lightColor, intensity: sky.lightIntensity } : base.directional,
    pointLights: base.pointLights.map((light) => ({ ...light })),
    fog: { ...base.fog },
    ground: { ...base.ground },
  };
}

function colorFor(tone?: LabChromeTone | string): string {
  if (!tone) return CHROME_TOKENS.tone.accent;
  return tone in CHROME_TOKENS.tone ? CHROME_TOKENS.tone[tone as LabChromeTone] : tone;
}

export function Chip(props: { label: string; active?: boolean; color?: LabChromeTone | string; tooltip?: string; onPress: () => void }) {
  const color = colorFor(props.color);
  return e(Pressable, {
    onPress: props.onPress,
    tooltip: props.tooltip,
    style: {
      paddingLeft: CHROME_LAYOUT.chip.paddingX,
      paddingRight: CHROME_LAYOUT.chip.paddingX,
      paddingTop: CHROME_LAYOUT.chip.paddingY,
      paddingBottom: CHROME_LAYOUT.chip.paddingY,
      borderRadius: CHROME_LAYOUT.chip.radius,
      borderWidth: CHROME_LAYOUT.chip.borderWidth,
      borderColor: props.active ? color : CHROME_TOKENS.color.frame,
      backgroundColor: props.active ? '#11263d' : CHROME_TOKENS.color.control,
    },
  }, e(Text, { fontSize: CHROME_LAYOUT.chip.fontSize, color: props.active ? color : CHROME_TOKENS.color.dim }, props.label));
}

export function Knob(props: { label: string; value: number; spec: KnobSpec; onChange: (value: number) => void }) {
  const buttonStyle = {
    width: CHROME_LAYOUT.knob.buttonSize,
    height: CHROME_LAYOUT.knob.buttonSize,
    borderRadius: CHROME_LAYOUT.knob.radius,
    borderWidth: 1,
    borderColor: CHROME_TOKENS.color.frame,
    backgroundColor: CHROME_TOKENS.color.control,
    alignItems: 'center',
    justifyContent: 'center',
  };
  return e(Row, { style: { alignItems: 'center', gap: CHROME_LAYOUT.knob.gap } },
    e(Text, { fontSize: CHROME_LAYOUT.knob.fontSize, color: CHROME_TOKENS.color.dim, style: { width: CHROME_LAYOUT.knob.labelWidth } }, props.label),
    e(Pressable, { onPress: () => props.onChange(resolveKnobValue(props.value, -1, props.spec)), style: buttonStyle },
      e(Text, { fontSize: 14, color: CHROME_TOKENS.color.ink }, '-')),
    e(Text, { fontSize: CHROME_LAYOUT.knob.fontSize + 1, color: CHROME_TOKENS.color.ink, style: { width: CHROME_LAYOUT.knob.valueWidth, textAlign: 'center' } }, formatKnobValue(props.value, props.spec)),
    e(Pressable, { onPress: () => props.onChange(resolveKnobValue(props.value, 1, props.spec)), style: buttonStyle },
      e(Text, { fontSize: 14, color: CHROME_TOKENS.color.ink }, '+')),
  );
}

export function Meter(props: { label: string; value: string }) {
  return e(Col, { style: { gap: 2, minWidth: CHROME_LAYOUT.meter.minWidth } },
    e(Text, { style: { color: CHROME_TOKENS.color.dim, fontSize: CHROME_LAYOUT.meter.labelFontSize } }, props.label),
    e(Text, { style: { color: CHROME_TOKENS.color.ink, fontSize: CHROME_LAYOUT.meter.valueFontSize, fontWeight: 'bold' } }, props.value),
  );
}

export function MeterRow(props: { label: string; value: number; spec?: MeterSpec; right?: string; color?: string }) {
  const meter = resolveMeter(props.value, props.spec);
  const color = props.color ?? meter.color;
  return e(Col, { style: { gap: 2 } },
    e(Row, { style: { justifyContent: 'space-between' } },
      e(Text, { fontSize: 10, color: CHROME_TOKENS.color.dim }, props.label || ' '),
      props.right ? e(Text, { fontSize: 10, color }, props.right) : null),
    e(Box, { style: { width: '100%', height: CHROME_LAYOUT.meter.barHeight, borderRadius: CHROME_LAYOUT.meter.barRadius, backgroundColor: '#0c1220' } },
      e(Box, { style: { width: meter.width, height: '100%', borderRadius: CHROME_LAYOUT.meter.barRadius, backgroundColor: color } })),
  );
}

export function Panel(props: { title?: string; subtitle?: string; width?: number; children?: any }) {
  const layout = resolvePanelLayout({ width: props.width });
  return e(Box, {
    style: {
      width: layout.width,
      padding: layout.padding,
      borderRadius: CHROME_LAYOUT.panel.radius,
      borderWidth: CHROME_LAYOUT.panel.borderWidth,
      borderColor: '#1c2a40',
      backgroundColor: CHROME_TOKENS.color.panel,
    },
  }, e(Col, { style: { gap: CHROME_LAYOUT.panel.gap } },
    props.title ? e(Text, { fontSize: 15, color: CHROME_TOKENS.color.ink, style: { fontWeight: 900 } }, props.title) : null,
    props.subtitle ? e(Text, { fontSize: 11, color: CHROME_TOKENS.color.dim }, props.subtitle) : null,
    props.children));
}

export function LabEnvironment(props: {
  preset?: LabEnvironmentPresetName;
  hour?: number | LabSkyNamedHour;
  weather?: number | LabSkyWeatherPresetName;
  gloom?: number;
  ground?: boolean;
}) {
  const env = resolveLabEnvironment(props);
  const children: any[] = [
    e(Scene3D.Fog, { key: 'fog', enabled: env.fog.enabled }),
    e(Scene3D.Skybox, { key: 'sky', ...env.sky }),
    e(Scene3D.AmbientLight, { key: 'ambient', color: env.ambient.color, intensity: env.ambient.intensity }),
    e(Scene3D.DirectionalLight, { key: 'directional', direction: env.directional.direction, color: env.directional.color, intensity: env.directional.intensity }),
    ...env.pointLights.map((light, index) => e(Scene3D.PointLight, { key: `point-${index}`, ...light })),
  ];
  if (props.ground !== false && env.ground.width > 0 && env.ground.depth > 0) {
    children.push(e(Scene3D.Mesh, {
      key: 'ground',
      geometry: Geometry.Box,
      params: { width: env.ground.width, height: env.ground.height, depth: env.ground.depth },
      material: env.ground.material,
      position: env.ground.position,
    }));
  }
  return e(Fragment, null, ...children);
}

export const GAME_CHROME = Object.freeze({
  tokens: CHROME_TOKENS,
  layout: CHROME_LAYOUT,
  knobPresets: CHROME_KNOB_PRESETS,
  skyTuning: LAB_SKY_TUNING,
  environmentPresets: LAB_ENVIRONMENT_PRESETS,
  Chip,
  Knob,
  Meter,
  MeterRow,
  Panel,
  LabEnvironment,
  resolveKnobValue,
  formatKnobValue,
  resolveMeter,
  resolvePanelLayout,
  buildLabSky,
  resolveLabEnvironment,
});
