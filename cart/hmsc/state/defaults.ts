import type { GameConfigState } from '../design';
import { HMSC_SCALE } from '../world/scale';

export const DEFAULT_PLAYER_WALK_SPEED_METERS_PER_SECOND = 2.4;
export const DEFAULT_PLAYER_RUN_SPEED_METERS_PER_SECOND = 5.8;
export const DEFAULT_PLAYER_HEALTH = 100;
export const DEFAULT_PLAYER_HEAT = 0;
export const DEFAULT_PLAYER_MONEY = 0;

export const DEFAULT_GAME_EVENT_LOG_LIMIT = 240;
export const MAX_CONSOLE_EVENT_LINES = 40;

export const SKY_TICK_INTERVAL_MS = 250;
export const SKY_HOURS_PER_DAY = 24;
export const REAL_MILLISECONDS_PER_MINUTE = 60_000;
export const DEFAULT_SKY_HOUR = 17.35;
export const DEFAULT_SKY_WEATHER = 0.12;
export const DEFAULT_SKY_GLOOM = 0;
export const DEFAULT_SKY_DAY_CYCLE_ENABLED = true;
export const DEFAULT_SKY_CYCLE_HOURS_PER_REAL_MINUTE = 1.5;

export const MIN_DRIVE_FRAME_SECONDS = 0.001;
export const MOVEMENT_INTENT_DEADZONE = 0.001;
export const HOST_VELOCITY_DEADZONE_METERS_PER_SECOND = 0.01;
export const NOCLIP_MIN_HEIGHT_METERS = 0;

export const DEFAULT_GAME_CONFIG: GameConfigState = {
  physics: {
    gravityMetersPerSecondSquared: 13.5,
    jumpSpeedMetersPerSecond: 5.65,
    playerCapsuleRadiusMeters: HMSC_SCALE.playerCapsuleRadiusMeters,
    playerCapsuleHeightMeters: HMSC_SCALE.playerCapsuleHeightMeters,
    playerStepHeightMeters: HMSC_SCALE.playerStepHeightMeters,
    wallRestitution: 0.08,
    bodyRestitution: 0.72,
    maxDriveFrameSeconds: 0.05,
  },
  sky: {
    hour: DEFAULT_SKY_HOUR,
    weather: DEFAULT_SKY_WEATHER,
    gloom: DEFAULT_SKY_GLOOM,
    dayCycleEnabled: DEFAULT_SKY_DAY_CYCLE_ENABLED,
    cycleHoursPerRealMinute: DEFAULT_SKY_CYCLE_HOURS_PER_REAL_MINUTE,
  },
};

export const SURFACE_STEP_EPSILON_METERS = 0.03;
export const DEFAULT_ENTITY_RADIUS_METERS = 0.28;
export const CRATE_ENTITY_RADIUS_METERS = 0.42;
export const BARREL_ENTITY_RADIUS_METERS = 0.34;
export const BALL_ENTITY_RADIUS_METERS = 0.3;
export const DEFAULT_ENTITY_RESTITUTION = 0.72;
export const SPAWN_ENTITY_CLEARANCE_METERS = 0.4;

export const DEFAULT_PHYSICS_BURST_COUNT = 18;
export const MAX_PHYSICS_BURST_COUNT = 64;
export const PHYSICS_BURST_KIND_COUNT = 4;
export const PHYSICS_BURST_HEIGHT_LANE_COUNT = 5;
export const PHYSICS_BURST_VERTICAL_SPEED_LANE_COUNT = 3;
export const PHYSICS_BURST_SPAWN_RADIUS_METERS = 0.65;
export const PHYSICS_BURST_BASE_HEIGHT_METERS = 1.8;
export const PHYSICS_BURST_HEIGHT_STEP_METERS = 0.18;
export const PHYSICS_BURST_HORIZONTAL_SPEED_METERS_PER_SECOND = 4.4;
export const PHYSICS_BURST_VERTICAL_SPEED_METERS_PER_SECOND = 2.4;
export const PHYSICS_BURST_VERTICAL_SPEED_STEP_METERS_PER_SECOND = 0.75;
export const PHYSICS_BURST_ANGLE_SERIAL_STEP = 1.918;
export const PHYSICS_BURST_ANGLE_ITEM_STEP = 0.41;
