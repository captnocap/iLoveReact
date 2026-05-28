type Rgb = [number, number, number];

export type HmscSkyWeatherPresetName = 'clear' | 'hazy' | 'cloudy' | 'storm';
export type HmscSkyNamedHour = 'midnight' | 'dawn' | 'noon' | 'dusk';

export type HmscSky = {
  zenith: string;
  horizon: string;
  ground: string;
  sunDir: Rgb;
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

const MIN_COLOR_CHANNEL = 0;
const MAX_COLOR_CHANNEL = 255;
const MIN_SKY_INFLUENCE = 0;
const MAX_SKY_INFLUENCE = 1;
const SKY_HOURS_PER_DAY = 24;
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 18;
const HALF_DAY_HOURS = 12;
const SUN_Z_FORWARD = 0.22;
const SKY_COLOR_EPSILON = 0.0001;

const DAY_KEYS: { h: number; zenith: string; horizon: string; sun: string }[] = [
  { h: 0, zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },
  { h: 5, zenith: '#172a55', horizon: '#7a5a6e', sun: '#ff9a5a' },
  { h: 7, zenith: '#2a5aa8', horizon: '#c9b27e', sun: '#ffd28a' },
  { h: 12, zenith: '#1f6fd6', horizon: '#bcd6f0', sun: '#fff4d6' },
  { h: 17, zenith: '#2a5fb0', horizon: '#e0b285', sun: '#ffcf86' },
  { h: 19, zenith: '#1d2f63', horizon: '#c4615a', sun: '#ff7a44' },
  { h: 21, zenith: '#0a1330', horizon: '#2a2350', sun: '#3a4a72' },
  { h: 24, zenith: '#05060f', horizon: '#0a1226', sun: '#20304f' },
];

export const HMSC_SKY_NAMED_HOURS: Record<HmscSkyNamedHour, number> = {
  midnight: 0,
  dawn: SUNRISE_HOUR,
  noon: HALF_DAY_HOURS,
  dusk: SUNSET_HOUR,
};

export const HMSC_SKY_WEATHER_PRESETS: Record<HmscSkyWeatherPresetName, { weather: number; gloom: number }> = {
  clear: { weather: 0, gloom: 0 },
  hazy: { weather: 0.25, gloom: 0 },
  cloudy: { weather: 0.65, gloom: 0.1 },
  storm: { weather: 1, gloom: 0.45 },
};

function clamp01(value: number): number {
  return Math.max(MIN_SKY_INFLUENCE, Math.min(MAX_SKY_INFLUENCE, value));
}

function clampColorChannel(value: number): number {
  return Math.max(MIN_COLOR_CHANNEL, Math.min(MAX_COLOR_CHANNEL, Math.round(value)));
}

function hexToRgb(hex: string): Rgb {
  const normalizedHex = hex.replace('#', '');
  const expandedHex = normalizedHex.length === 3
    ? normalizedHex.split('').map((channel) => channel + channel).join('')
    : normalizedHex;
  const color = parseInt(expandedHex, 16);
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function rgbToHex(rgb: Rgb): string {
  const channelToHex = (value: number) => clampColorChannel(value).toString(16).padStart(2, '0');
  return `#${channelToHex(rgb[0])}${channelToHex(rgb[1])}${channelToHex(rgb[2])}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]);
}

function smooth(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function dayKey(hour: number): { zenith: string; horizon: string; sun: string } {
  const wrappedHour = normalizeSkyHour(hour);
  let index = 0;
  while (index < DAY_KEYS.length - 1 && DAY_KEYS[index + 1].h <= wrappedHour) index += 1;
  const current = DAY_KEYS[index];
  const next = DAY_KEYS[Math.min(index + 1, DAY_KEYS.length - 1)];
  const span = Math.max(SKY_COLOR_EPSILON, next.h - current.h);
  const t = clamp01((wrappedHour - current.h) / span);
  return {
    zenith: mixHex(current.zenith, next.zenith, t),
    horizon: mixHex(current.horizon, next.horizon, t),
    sun: mixHex(current.sun, next.sun, t),
  };
}

function sunDirFor(hour: number): Rgb {
  const angle = ((normalizeSkyHour(hour) - SUNRISE_HOUR) / HALF_DAY_HOURS) * Math.PI;
  return [Math.cos(angle), Math.sin(angle), SUN_Z_FORWARD];
}

export function normalizeSkyHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return ((hour % SKY_HOURS_PER_DAY) + SKY_HOURS_PER_DAY) % SKY_HOURS_PER_DAY;
}

export function clampSkyInfluence(value: number): number {
  if (!Number.isFinite(value)) return MIN_SKY_INFLUENCE;
  return clamp01(value);
}

export function hmscSkyWeatherPresetNamesForConsole(): string {
  return Object.keys(HMSC_SKY_WEATHER_PRESETS).join(', ');
}

export function buildHmscSky(hour: number, weather: number, gloom: number): HmscSky {
  const safeHour = normalizeSkyHour(hour);
  const safeWeather = clampSkyInfluence(weather);
  const safeGloom = clampSkyInfluence(gloom);
  const key = dayKey(safeHour);
  const sunDir = sunDirFor(safeHour);
  const elevation = sunDir[1];
  const night = smooth(0.04, -0.18, elevation);
  const day = clamp01(elevation * 1.4);

  let sky: HmscSky = {
    zenith: key.zenith,
    horizon: key.horizon,
    ground: '#0c0d10',
    sunDir,
    sunColor: key.sun,
    sunSize: 0.018,
    sunGlow: lerp(0.18, 0.42, day),
    haze: lerp(0.22, 0.42, day),
    cloud: 0.14,
    night,
    ambient: lerp(0.34, 0.48, day),
    lightColor: key.sun,
    lightIntensity: lerp(0.18, 0.95, day),
  };

  if (safeWeather > SKY_COLOR_EPSILON) {
    const greySky = '#5a626e';
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, mixHex(greySky, '#23262c', 0.4), safeWeather),
      horizon: mixHex(sky.horizon, greySky, safeWeather * 0.85),
      cloud: lerp(sky.cloud, 0.9, safeWeather),
      haze: lerp(sky.haze, 0.72, safeWeather),
      sunGlow: lerp(sky.sunGlow, 0.85, safeWeather),
      lightIntensity: sky.lightIntensity * lerp(1, 0.45, safeWeather),
      ambient: sky.ambient * lerp(1, 0.8, safeWeather),
    };
  }

  if (safeGloom > SKY_COLOR_EPSILON) {
    const pall = '#3b4a3f';
    sky = {
      ...sky,
      zenith: mixHex(sky.zenith, '#1a221c', safeGloom),
      horizon: mixHex(sky.horizon, pall, safeGloom),
      ground: mixHex(sky.ground, '#10130f', safeGloom),
      cloud: lerp(sky.cloud, 0.8, safeGloom),
      haze: lerp(sky.haze, 0.6, safeGloom),
      lightIntensity: sky.lightIntensity * lerp(1, 0.5, safeGloom),
      lightColor: mixHex(sky.lightColor, '#9fb29a', safeGloom),
      ambient: lerp(sky.ambient, 0.22, safeGloom),
    };
  }

  return {
    ...sky,
    // Keep contrast modest; the current host sky pass shows hard splits with extreme ramps.
    zenith: mixHex(sky.zenith, sky.horizon, 0.18),
    ground: mixHex(sky.ground, '#07111f', 0.4),
  };
}
