import { BLOCK, isBlockLiquid } from '../core/blocks.js';

function isTargetBlock(blockId, includeLiquids) {
  if (blockId == null || blockId === BLOCK.AIR) return false;
  if (!includeLiquids && isBlockLiquid(blockId)) return false;
  return true;
}

/**
 * Exact Amanatides & Woo 3D DDA voxel raycast.
 * Pure JS (zero DOM/Three.js dependencies).
 *
 * @param {{x:number, y:number, z:number}} origin
 * @param {{x:number, y:number, z:number}} direction
 * @param {number} maxDist
 * @param {(wx:number, wy:number, wz:number) => number} getBlockAt
 * @param {{ includeLiquids?: boolean }} [options]
 * @returns {{
 *   hit: true,
 *   wx: number,
 *   wy: number,
 *   wz: number,
 *   blockId: number,
 *   normal: {x:number, y:number, z:number},
 *   placePos: {wx:number, wy:number, wz:number},
 *   distance: number
 * } | null}
 */
export function raycastVoxels(origin, direction, maxDist, getBlockAt, options = {}) {
  if (!origin || !direction || typeof getBlockAt !== 'function' || !(maxDist > 0)) {
    return null;
  }

  let dx = direction.x;
  let dy = direction.y;
  let dz = direction.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return null;
  dx /= len;
  dy /= len;
  dz /= len;

  const includeLiquids = options.includeLiquids === true;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;

  let wx = Math.floor(ox);
  let wy = Math.floor(oy);
  let wz = Math.floor(oz);

  // If ray begins strictly on an exact integer boundary heading negatively,
  // it enters the adjacent lower voxel at t = 0 rather than the voxel at floor(origin).
  const exitingX = dx < 0 && ox === wx;
  const exitingY = dy < 0 && oy === wy;
  const exitingZ = dz < 0 && oz === wz;

  if (!exitingX && !exitingY && !exitingZ) {
    const startId = getBlockAt(wx, wy, wz) ?? BLOCK.AIR;
    if (isTargetBlock(startId, includeLiquids)) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (dx > 0 && ox === wx) nx = -1;
      else if (dy > 0 && oy === wy) ny = -1;
      else if (dz > 0 && oz === wz) nz = -1;
      else {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        const az = Math.abs(dz);
        if (ax >= ay && ax >= az) nx = dx >= 0 ? -1 : 1;
        else if (ay >= az) ny = dy >= 0 ? -1 : 1;
        else nz = dz >= 0 ? -1 : 1;
      }
      return {
        hit: true,
        wx,
        wy,
        wz,
        blockId: startId,
        normal: { x: nx, y: ny, z: nz },
        placePos: { wx: wx + nx, wy: wy + ny, wz: wz + nz },
        distance: 0,
      };
    }
  }

  const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
  const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
  const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx > 0 ? (wx + 1 - ox) * tDeltaX : (dx < 0 ? (ox - wx) * tDeltaX : Infinity);
  let tMaxY = dy > 0 ? (wy + 1 - oy) * tDeltaY : (dy < 0 ? (oy - wy) * tDeltaY : Infinity);
  let tMaxZ = dz > 0 ? (wz + 1 - oz) * tDeltaZ : (dz < 0 ? (oz - wz) * tDeltaZ : Infinity);

  const maxSteps = Number.isFinite(maxDist) ? Math.ceil(maxDist * 3) + 16 : 4096;

  for (let i = 0; i < maxSteps; i++) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let distance;

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      if (tMaxX > maxDist) return null;
      distance = tMaxX;
      wx += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
    } else if (tMaxY <= tMaxZ) {
      if (tMaxY > maxDist) return null;
      distance = tMaxY;
      wy += stepY;
      tMaxY += tDeltaY;
      ny = -stepY;
    } else {
      if (tMaxZ > maxDist) return null;
      distance = tMaxZ;
      wz += stepZ;
      tMaxZ += tDeltaZ;
      nz = -stepZ;
    }

    const blockId = getBlockAt(wx, wy, wz) ?? BLOCK.AIR;
    if (isTargetBlock(blockId, includeLiquids)) {
      return {
        hit: true,
        wx,
        wy,
        wz,
        blockId,
        normal: { x: nx, y: ny, z: nz },
        placePos: { wx: wx + nx, wy: wy + ny, wz: wz + nz },
        distance,
      };
    }
  }

  return null;
}
