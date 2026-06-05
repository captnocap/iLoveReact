import {
  CHROME_KNOB_PRESETS,
  GAME_CHROME,
  LAB_ENVIRONMENT_PRESETS,
  LAB_SKY_TUNING,
  buildLabSky,
  formatKnobValue,
  resolveKnobValue,
  resolveLabEnvironment,
  resolveMeter,
  resolvePanelLayout,
} from './index';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

test('knob ranges clamp at the reference bounds', () => {
  const depth = CHROME_KNOB_PRESETS['carve.depth'];
  assertEqual(resolveKnobValue(0.05, -1, depth), 0.05, 'depth lower clamp');
  assertEqual(resolveKnobValue(1.95, 1, depth), 2, 'depth upper clamp');
  assertEqual(resolveKnobValue(0.55, 1, depth), 0.6, 'depth step');
  assertEqual(formatKnobValue(0.6, depth), '0.60', 'depth precision');

  const inflate = CHROME_KNOB_PRESETS['carve.inflate'];
  assertEqual(resolveKnobValue(0, -1, inflate), 0, 'inflate lower clamp');
  assertEqual(resolveKnobValue(0.95, 1, inflate), 1, 'inflate upper clamp');

  const zoom = CHROME_KNOB_PRESETS['carve.zoom'];
  assertEqual(resolveKnobValue(1.2, -1, zoom), 1.2, 'zoom lower clamp');
  assertEqual(resolveKnobValue(11.9, 1, zoom), 12, 'zoom upper clamp');
});

test('meter maps values into clamped fills and threshold colors', () => {
  const normal = resolveMeter(75, { min: 0, max: 100, warnAt: 0.6, badAt: 0.9 });
  assertClose(normal.fraction, 0.75, 1e-12, 'fraction from range');
  assertEqual(normal.percent, 75, 'rounded percent');
  assertEqual(normal.width, '75%', 'width string');
  assertEqual(normal.tone, 'warn', 'warn threshold');

  const over = resolveMeter(130, { min: 0, max: 100, warnAt: 0.6, badAt: 0.9 });
  assertEqual(over.percent, 100, 'upper clamp');
  assertEqual(over.tone, 'bad', 'bad threshold');

  const inverted = resolveMeter(25, { min: 0, max: 100, invert: true });
  assertEqual(inverted.percent, 75, 'inverted meter maps remaining capacity');
});

test('panel layout math resolves stable content and column widths', () => {
  const panel = resolvePanelLayout();
  assertEqual(panel.width, 320, 'carve-style panel width');
  assertEqual(panel.padding, 12, 'panel padding');
  assertEqual(panel.contentWidth, 296, 'content width removes both paddings');
  assertEqual(panel.cellWidth, 296, 'one-column cell width');

  const row = resolvePanelLayout({ width: 620, padding: 14, gap: 12, columns: 4 });
  assertEqual(row.contentWidth, 592, 'custom content width');
  assertEqual(row.cellWidth, 139, 'wrapped meter/chip row cell width');
});

test('environment presets resolve sky, lights, fog, and ground consistently', () => {
  assert(LAB_ENVIRONMENT_PRESETS.arena.pointLights.length === 2, 'arena carries the physics_lab two-point rig');
  const arena = resolveLabEnvironment({ preset: 'arena' });
  assertEqual(arena.sky.zenith, '#172a4c', 'arena sky zenith from physics_lab');
  assertEqual(arena.ambient.color, '#74839b', 'arena ambient color');
  assertEqual(arena.ground.height, 0.16, 'arena thin-box ground height');

  const night = resolveLabEnvironment({ preset: 'night' });
  assertEqual(night.fog.enabled, false, 'night preset disables fog like planet_run');
  assertEqual(night.sky.night, 1, 'night sky is fully night');
  assertEqual(night.pointLights.length, 1, 'night carries the planet_run point light');

  const storm = resolveLabEnvironment({ preset: 'day-cycle', hour: 'noon', weather: 'storm' });
  assert(storm.sky.cloud > 0.8, 'storm preset raises cloud cover');
  assert(storm.directional.direction === storm.sky.sunDir, 'directional light uses the sky sun direction');
  assert(storm.directional.color === storm.sky.lightColor, 'directional light uses the sky light color');
});

test('sky inputs normalize and clamp through the tuning table', () => {
  const dawn = buildLabSky(LAB_SKY_TUNING.namedHours.dawn, 'clear');
  assert(dawn.sunDir[1] <= 0.001, 'dawn starts on the horizon');

  const wrapped = buildLabSky(36, 0, 0);
  const noon = buildLabSky(12, 0, 0);
  assertEqual(wrapped.zenith, noon.zenith, 'hours wrap on the 24h day');

  const overcast = buildLabSky(12, 99, -4);
  assert(overcast.cloud <= 0.9, 'weather clamps to preset maximum cloud');
  assert(overcast.night >= 0 && overcast.night <= 1, 'night influence stays normalized');
});

test('GAME_CHROME is sealed and exposes the kit surface', () => {
  assert(Object.isFrozen(GAME_CHROME), 'door is frozen');
  assert(!('status' in GAME_CHROME), 'door is live, not capture-pending');
  assertEqual(typeof GAME_CHROME.Chip, 'function', 'Chip component');
  assertEqual(typeof GAME_CHROME.Knob, 'function', 'Knob component');
  assertEqual(typeof GAME_CHROME.Meter, 'function', 'Meter component');
  assertEqual(typeof GAME_CHROME.MeterRow, 'function', 'MeterRow component');
  assertEqual(typeof GAME_CHROME.Panel, 'function', 'Panel component');
  assertEqual(typeof GAME_CHROME.LabEnvironment, 'function', 'LabEnvironment component');
  assertEqual(typeof GAME_CHROME.resolveLabEnvironment, 'function', 'environment resolver');
});

finish('game/chrome');
