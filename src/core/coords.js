import { CHUNK_SIZE, CHUNK_HEIGHT } from './constants.js';

/**
 * Positive-modulo helper that maps negative world coordinates cleanly to [0, n-1].
 */
export function mod(value, n) {
  return ((value % n) + n) % n;
}

/**
 * Convert world integer block coordinates to owning chunk coordinates (cx, cz).
 */
export function worldToChunk(wx, wz) {
  return {
    cx: Math.floor(wx / CHUNK_SIZE),
    cz: Math.floor(wz / CHUNK_SIZE),
  };
}

/**
 * Convert world integer coordinates to chunk-local coordinates [0..15, 0..127, 0..15].
 */
export function worldToLocal(wx, wy, wz) {
  return {
    lx: mod(wx, CHUNK_SIZE),
    ly: wy,
    lz: mod(wz, CHUNK_SIZE),
  };
}

/**
 * Canonical flat array index inside a 16x128x16 chunk buffer.
 * Layout: Y-major slices for fast vertical column scans -> idx = (ly * 16 + lz) * 16 + lx.
 */
export function voxelIndex(lx, ly, lz) {
  return (ly * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
}

/**
 * Canonical string key for chunk maps and persistence.
 */
export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

/**
 * Canonical string key for world block coordinates (used by chests, furnaces, chunk deltas).
 */
export function blockKey(wx, wy, wz) {
  return `${wx},${wy},${wz}`;
}

/**
 * Clamp Y coordinate check.
 */
export function isValidY(wy) {
  return wy >= 0 && wy < CHUNK_HEIGHT;
}
