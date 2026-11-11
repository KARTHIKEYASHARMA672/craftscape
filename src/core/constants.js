/**
 * Shared engine and gameplay constants for CraftScape.
 * Immutable contract consumed across worldgen, meshing, physics, and UI modules.
 */

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE;

export const SEA_LEVEL = 42;
export const MAX_LIGHT = 15;

export const DEFAULT_RENDER_DISTANCE = 5;
export const MIN_RENDER_DISTANCE = 3;
export const MAX_RENDER_DISTANCE = 9;

export const ATLAS_COLS = 16;
export const ATLAS_ROWS = 16;
export const TILE_PX = 16;
export const ATLAS_PX = ATLAS_COLS * TILE_PX; // 256x256 crisp nearest-neighbor atlas
export const UV_INSET = 0.0012; // prevents mip/sub-texel tile edge bleeding

export const DAY_CYCLE_SECONDS = 480; // 8-minute real-time day/night cycle

export const PLAYER_CONSTANTS = Object.freeze({
  WIDTH: 0.6,
  HALF_WIDTH: 0.3,
  HEIGHT: 1.8,
  EYE_HEIGHT: 1.62,
  SNEAK_EYE_HEIGHT: 1.32,
  WALK_SPEED: 4.5,
  SPRINT_SPEED: 6.6,
  SNEAK_SPEED: 1.9,
  FLY_SPEED: 11.0,
  FLY_SPRINT_SPEED: 18.0,
  SWIM_SPEED: 2.9,
  GRAVITY: 25.0,
  JUMP_VELOCITY: 8.6,
  TERMINAL_VELOCITY: 42.0,
  REACH_DISTANCE: 5.5,
  MAX_HEALTH: 20,
  MAX_HUNGER: 20,
  MAX_OXYGEN: 20,
});

export const GAME_MODES = Object.freeze({
  SURVIVAL: 'survival',
  CREATIVE: 'creative',
});

export const DIFFICULTIES = Object.freeze({
  PEACEFUL: 'peaceful',
  NORMAL: 'normal',
});
