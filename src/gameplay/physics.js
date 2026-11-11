import { PLAYER_CONSTANTS } from '../core/constants.js';
import { BLOCK, getBlockDef, isBlockSolid } from '../core/blocks.js';

const AABB_EPS = 1e-6;
const STEP_INTERVAL = 1.7;
const FALL_DAMAGE_THRESHOLD = 3.5;

/**
 * Create a mutable player physics state object.
 */
export function createPlayerState(spawnPos = { x: 0.5, y: 50, z: 0.5 }) {
  return {
    position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    inWater: false,
    headInWater: false,
    sprinting: false,
    sneaking: false,
    flying: false,
    fallStartY: spawnPos.y,
    walkDistance: 0,
    stepAccum: 0,
  };
}

/**
 * Check whether a player AABB at `pos` overlaps any solid voxel.
 */
export function overlapsSolidBlock(
  pos,
  getBlockAt,
  halfWidth = PLAYER_CONSTANTS.HALF_WIDTH,
  height = PLAYER_CONSTANTS.HEIGHT,
) {
  const minX = Math.floor(pos.x - halfWidth + AABB_EPS);
  const maxX = Math.floor(pos.x + halfWidth - AABB_EPS);
  const minY = Math.floor(pos.y + AABB_EPS);
  const maxY = Math.floor(pos.y + height - AABB_EPS);
  const minZ = Math.floor(pos.z - halfWidth + AABB_EPS);
  const maxZ = Math.floor(pos.z + halfWidth - AABB_EPS);

  if (maxX < minX || maxY < minY || maxZ < minZ) return false;

  for (let wy = minY; wy <= maxY; wy++) {
    for (let wz = minZ; wz <= maxZ; wz++) {
      for (let wx = minX; wx <= maxX; wx++) {
        if (isBlockSolid(getBlockAt(wx, wy, wz))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check whether placing a block at `blockPos` ([wx..wx+1, wy..wy+1, wz..wz+1])
 * would intersect the player's AABB.
 */
export function wouldPlaceOverlapPlayer(
  blockPos,
  playerPos,
  halfWidth = PLAYER_CONSTANTS.HALF_WIDTH,
  height = PLAYER_CONSTANTS.HEIGHT,
) {
  const wx = blockPos.wx ?? blockPos.x;
  const wy = blockPos.wy ?? blockPos.y;
  const wz = blockPos.wz ?? blockPos.z;

  return (
    playerPos.x + halfWidth > wx + AABB_EPS &&
    playerPos.x - halfWidth < wx + 1 - AABB_EPS &&
    playerPos.y + height > wy + AABB_EPS &&
    playerPos.y < wy + 1 - AABB_EPS &&
    playerPos.z + halfWidth > wz + AABB_EPS &&
    playerPos.z - halfWidth < wz + 1 - AABB_EPS
  );
}

function collectOverlappingSolidBounds(pos, getBlockAt, halfWidth, height) {
  const minX = Math.floor(pos.x - halfWidth + AABB_EPS);
  const maxX = Math.floor(pos.x + halfWidth - AABB_EPS);
  const minY = Math.floor(pos.y + AABB_EPS);
  const maxY = Math.floor(pos.y + height - AABB_EPS);
  const minZ = Math.floor(pos.z - halfWidth + AABB_EPS);
  const maxZ = Math.floor(pos.z + halfWidth - AABB_EPS);

  let found = false;
  let solidMinX = Infinity;
  let solidMaxX = -Infinity;
  let solidMinY = Infinity;
  let solidMaxY = -Infinity;
  let solidMinZ = Infinity;
  let solidMaxZ = -Infinity;

  for (let wy = minY; wy <= maxY; wy++) {
    for (let wz = minZ; wz <= maxZ; wz++) {
      for (let wx = minX; wx <= maxX; wx++) {
        if (isBlockSolid(getBlockAt(wx, wy, wz))) {
          found = true;
          if (wx < solidMinX) solidMinX = wx;
          if (wx > solidMaxX) solidMaxX = wx;
          if (wy < solidMinY) solidMinY = wy;
          if (wy > solidMaxY) solidMaxY = wy;
          if (wz < solidMinZ) solidMinZ = wz;
          if (wz > solidMaxZ) solidMaxZ = wz;
        }
      }
    }
  }

  return found
    ? { minX: solidMinX, maxX: solidMaxX, minY: solidMinY, maxY: solidMaxY, minZ: solidMinZ, maxZ: solidMaxZ }
    : null;
}

function hasGroundSupport(x, y, z, getBlockAt, halfWidth) {
  const wy = Math.floor(y - 0.05);
  const minX = Math.floor(x - halfWidth + AABB_EPS);
  const maxX = Math.floor(x + halfWidth - AABB_EPS);
  const minZ = Math.floor(z - halfWidth + AABB_EPS);
  const maxZ = Math.floor(z + halfWidth - AABB_EPS);

  for (let wz = minZ; wz <= maxZ; wz++) {
    for (let wx = minX; wx <= maxX; wx++) {
      if (isBlockSolid(getBlockAt(wx, wy, wz))) {
        return true;
      }
    }
  }
  return false;
}

function getStandingSoundGroup(pos, getBlockAt, halfWidth) {
  const wy = Math.floor(pos.y - 0.1);
  const cx = Math.floor(pos.x);
  const cz = Math.floor(pos.z);
  const centerId = getBlockAt(cx, wy, cz);
  if (isBlockSolid(centerId)) {
    return getBlockDef(centerId).soundGroup;
  }

  const minX = Math.floor(pos.x - halfWidth + AABB_EPS);
  const maxX = Math.floor(pos.x + halfWidth - AABB_EPS);
  const minZ = Math.floor(pos.z - halfWidth + AABB_EPS);
  const maxZ = Math.floor(pos.z + halfWidth - AABB_EPS);

  for (let wz = minZ; wz <= maxZ; wz++) {
    for (let wx = minX; wx <= maxX; wx++) {
      const id = getBlockAt(wx, wy, wz);
      if (isBlockSolid(id)) {
        return getBlockDef(id).soundGroup;
      }
    }
  }
  return 'stone';
}

function updateWaterFlags(player, getBlockAt, halfWidth, height) {
  const pos = player.position;
  const minX = Math.floor(pos.x - halfWidth + AABB_EPS);
  const maxX = Math.floor(pos.x + halfWidth - AABB_EPS);
  const minY = Math.floor(pos.y + 0.1);
  const maxY = Math.floor(pos.y + height - 0.1);
  const minZ = Math.floor(pos.z - halfWidth + AABB_EPS);
  const maxZ = Math.floor(pos.z + halfWidth - AABB_EPS);

  let inWater = false;
  for (let wy = minY; wy <= maxY && !inWater; wy++) {
    for (let wz = minZ; wz <= maxZ && !inWater; wz++) {
      for (let wx = minX; wx <= maxX; wx++) {
        if (getBlockAt(wx, wy, wz) === BLOCK.WATER) {
          inWater = true;
          break;
        }
      }
    }
  }

  const eyeHeight = player.sneaking ? PLAYER_CONSTANTS.SNEAK_EYE_HEIGHT : PLAYER_CONSTANTS.EYE_HEIGHT;
  const eyeBlock = getBlockAt(
    Math.floor(pos.x),
    Math.floor(pos.y + eyeHeight),
    Math.floor(pos.z),
  );

  player.inWater = inWater;
  player.headInWater = eyeBlock === BLOCK.WATER;
}

function clampSneakDisplacement(pos, axis, delta, getBlockAt, halfWidth) {
  const test = axis === 'x'
    ? hasGroundSupport(pos.x + delta, pos.y, pos.z, getBlockAt, halfWidth)
    : hasGroundSupport(pos.x, pos.y, pos.z + delta, getBlockAt, halfWidth);

  if (test) return delta;

  // Binary search the maximum safe fraction up to the block edge so player stops flush with ledge.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) * 0.5;
    const ok = axis === 'x'
      ? hasGroundSupport(pos.x + delta * mid, pos.y, pos.z, getBlockAt, halfWidth)
      : hasGroundSupport(pos.x, pos.y, pos.z + delta * mid, getBlockAt, halfWidth);
    if (ok) lo = mid;
    else hi = mid;
  }
  return delta * lo;
}

/**
 * Step player physics for one frame using sub-stepped swept axis separation.
 *
 * @param {ReturnType<createPlayerState>} player
 * @param {{ forward?:boolean, backward?:boolean, left?:boolean, right?:boolean, jump?:boolean, sprint?:boolean, sneak?:boolean }} input
 * @param {number} dt
 * @param {(wx:number, wy:number, wz:number) => number} getBlockAt
 * @param {{ onFallDamage?: (damage:number) => void, onStep?: (soundGroup:string) => void }} [callbacks]
 */
export function stepPlayerPhysics(player, input, dt, getBlockAt, callbacks = {}) {
  const clampedDt = Math.min(Math.max(dt || 0, 0), 0.05);
  const halfWidth = PLAYER_CONSTANTS.HALF_WIDTH;
  const height = PLAYER_CONSTANTS.HEIGHT;
  const pos = player.position;
  const vel = player.velocity;

  const moveForward = (input?.forward ? 1 : 0) - (input?.backward ? 1 : 0);
  const moveRight = (input?.right ? 1 : 0) - (input?.left ? 1 : 0);
  const jump = Boolean(input?.jump);
  const sneak = Boolean(input?.sneak);
  const sprint = Boolean(input?.sprint);

  player.sneaking = !player.flying && sneak;
  player.sprinting = sprint && !player.sneaking && (moveForward > 0 || (player.flying && (moveForward !== 0 || moveRight !== 0)));

  updateWaterFlags(player, getBlockAt, halfWidth, height);

  if (clampedDt === 0) {
    return;
  }

  // Camera/yaw basis in Three.js (-Z forward at yaw = 0, +X right at yaw = 0)
  const sinYaw = Math.sin(player.yaw || 0);
  const cosYaw = Math.cos(player.yaw || 0);
  const forwardX = -sinYaw;
  const forwardZ = -cosYaw;
  const rightX = cosYaw;
  const rightZ = -sinYaw;

  let wishX = forwardX * moveForward + rightX * moveRight;
  let wishZ = forwardZ * moveForward + rightZ * moveRight;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-6) {
    wishX /= wishLen;
    wishZ /= wishLen;
  } else {
    wishX = 0;
    wishZ = 0;
  }

  let speed;
  if (player.flying) {
    speed = player.sprinting ? PLAYER_CONSTANTS.FLY_SPRINT_SPEED : PLAYER_CONSTANTS.FLY_SPEED;
  } else if (player.inWater) {
    speed = PLAYER_CONSTANTS.SWIM_SPEED;
  } else if (player.sneaking) {
    speed = PLAYER_CONSTANTS.SNEAK_SPEED;
  } else if (player.sprinting) {
    speed = PLAYER_CONSTANTS.SPRINT_SPEED;
  } else {
    speed = PLAYER_CONSTANTS.WALK_SPEED;
  }

  const targetVx = wishX * speed;
  const targetVz = wishZ * speed;
  const accelRate = player.flying ? 16 : (player.onGround ? 28 : (player.inWater ? 12 : 10));
  const blend = 1 - Math.exp(-accelRate * clampedDt);
  vel.x += (targetVx - vel.x) * blend;
  vel.z += (targetVz - vel.z) * blend;
  if (wishLen === 0 && Math.abs(vel.x) < 1e-4) vel.x = 0;
  if (wishLen === 0 && Math.abs(vel.z) < 1e-4) vel.z = 0;

  const wasOnGround = player.onGround;

  if (player.flying) {
    const flyY = (jump ? 1 : 0) - (sneak ? 1 : 0);
    const flyVertSpeed = player.sprinting ? PLAYER_CONSTANTS.FLY_SPRINT_SPEED * 0.75 : PLAYER_CONSTANTS.FLY_SPEED * 0.75;
    const targetVy = flyY * flyVertSpeed;
    vel.y += (targetVy - vel.y) * (1 - Math.exp(-16 * clampedDt));
    if (flyY === 0 && Math.abs(vel.y) < 1e-4) vel.y = 0;
    player.fallStartY = pos.y;
  } else if (player.inWater) {
    const waterVertTarget = jump ? 4.4 : (sneak ? -4.2 : -1.4);
    const vertBlend = 1 - Math.exp(-6.5 * clampedDt);
    vel.y += (waterVertTarget - vel.y) * vertBlend;
    player.fallStartY = pos.y;
  } else {
    if (player.onGround && jump) {
      vel.y = PLAYER_CONSTANTS.JUMP_VELOCITY;
      player.onGround = false;
      player.fallStartY = pos.y;
    }
    vel.y = Math.max(
      -PLAYER_CONSTANTS.TERMINAL_VELOCITY,
      vel.y - PLAYER_CONSTANTS.GRAVITY * clampedDt,
    );
  }

  const prevX = pos.x;
  const prevZ = pos.z;

  // Sub-step so per-step motion stays <= 0.2 blocks, preventing corner snagging and floor tunneling.
  const maxStepDelta = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * clampedDt;
  const subSteps = Math.max(1, Math.ceil(maxStepDelta / 0.2));
  const subDt = clampedDt / subSteps;

  const edgeGuardActive = !player.flying && player.onGround && sneak && hasGroundSupport(pos.x, pos.y, pos.z, getBlockAt, halfWidth);
  let landedThisStep = false;

  for (let s = 0; s < subSteps; s++) {
    // 1. X axis
    let dx = vel.x * subDt;
    if (edgeGuardActive && dx !== 0) {
      const clampedDx = clampSneakDisplacement(pos, 'x', dx, getBlockAt, halfWidth);
      if (Math.abs(clampedDx) < Math.abs(dx) * 0.999) {
        vel.x = 0;
      }
      dx = clampedDx;
    }
    if (dx !== 0) {
      pos.x += dx;
      const overlap = collectOverlappingSolidBounds(pos, getBlockAt, halfWidth, height);
      if (overlap) {
        if (dx > 0) pos.x = overlap.minX - halfWidth;
        else pos.x = overlap.maxX + 1 + halfWidth;
        vel.x = 0;
      }
    }

    // 2. Z axis
    let dz = vel.z * subDt;
    if (edgeGuardActive && dz !== 0) {
      const clampedDz = clampSneakDisplacement(pos, 'z', dz, getBlockAt, halfWidth);
      if (Math.abs(clampedDz) < Math.abs(dz) * 0.999) {
        vel.z = 0;
      }
      dz = clampedDz;
    }
    if (dz !== 0) {
      pos.z += dz;
      const overlap = collectOverlappingSolidBounds(pos, getBlockAt, halfWidth, height);
      if (overlap) {
        if (dz > 0) pos.z = overlap.minZ - halfWidth;
        else pos.z = overlap.maxZ + 1 + halfWidth;
        vel.z = 0;
      }
    }

    // 3. Y axis
    const dy = vel.y * subDt;
    if (dy !== 0) {
      pos.y += dy;
      const overlap = collectOverlappingSolidBounds(pos, getBlockAt, halfWidth, height);
      if (overlap) {
        if (dy < 0) {
          pos.y = overlap.maxY + 1;
          vel.y = 0;
          landedThisStep = true;
        } else {
          pos.y = overlap.minY - height;
          vel.y = 0;
        }
      }
    }
  }

  // Determine grounded state cleanly (handles zero-velocity flying/idle cases too).
  if (landedThisStep) {
    player.onGround = true;
  } else if (vel.y <= 0 && overlapsSolidBlock({ x: pos.x, y: pos.y - 0.002, z: pos.z }, getBlockAt, halfWidth, height)) {
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // Refresh water flags after displacement so landing in water prevents fall damage.
  updateWaterFlags(player, getBlockAt, halfWidth, height);

  if (player.flying || player.inWater) {
    player.fallStartY = pos.y;
  } else if (player.onGround) {
    if (!wasOnGround) {
      const fallDistance = player.fallStartY - pos.y;
      if (fallDistance > FALL_DAMAGE_THRESHOLD) {
        const damage = Math.max(1, Math.floor(fallDistance - 3));
        callbacks.onFallDamage?.(damage);
      }
    }
    player.fallStartY = pos.y;
  } else if (pos.y > player.fallStartY) {
    player.fallStartY = pos.y;
  }

  // Footstep distance tracking on dry ground
  const horizMoved = Math.hypot(pos.x - prevX, pos.z - prevZ);
  if (player.onGround && !player.inWater && !player.flying && horizMoved > 0) {
    player.walkDistance += horizMoved;
    player.stepAccum += horizMoved;
    if (player.stepAccum >= STEP_INTERVAL) {
      player.stepAccum %= STEP_INTERVAL;
      const soundGroup = getStandingSoundGroup(pos, getBlockAt, halfWidth);
      if (soundGroup && soundGroup !== 'none') {
        callbacks.onStep?.(soundGroup);
      }
    }
  }
}
