import * as THREE from 'three';
import { CHUNK_HEIGHT, DIFFICULTIES } from '../core/constants.js';
import { BLOCK, isBlockSolid } from '../core/blocks.js';
import { ITEM } from '../core/items.js';

export const MOB_TYPE = Object.freeze({
  SHEEP: 'sheep',
  COW: 'cow',
  PIG: 'pig',
  ZOMBIE: 'zombie',
  CREEPER: 'creeper',
});

const PASSIVE_CAP = 14;
const HOSTILE_CAP = 8;
const SPAWN_MIN_DIST = 14;
const SPAWN_MAX_DIST = 38;
const DESPAWN_DIST = 56;
const MOB_GRAVITY = 25.0;

const MOB_SPECS = Object.freeze({
  [MOB_TYPE.SHEEP]: { hostile: false, hp: 8, halfWidth: 0.42, height: 1.25, speed: 1.7 },
  [MOB_TYPE.COW]: { hostile: false, hp: 10, halfWidth: 0.45, height: 1.4, speed: 1.6 },
  [MOB_TYPE.PIG]: { hostile: false, hp: 8, halfWidth: 0.42, height: 0.95, speed: 1.8 },
  [MOB_TYPE.ZOMBIE]: { hostile: true, hp: 20, halfWidth: 0.34, height: 1.85, speed: 2.55 },
  [MOB_TYPE.CREEPER]: { hostile: true, hp: 20, halfWidth: 0.34, height: 1.7, speed: 2.35 },
});

const PASSIVE_TYPES = [MOB_TYPE.SHEEP, MOB_TYPE.COW, MOB_TYPE.PIG];
const HOSTILE_TYPES = [MOB_TYPE.ZOMBIE, MOB_TYPE.CREEPER];

function createPartMesh(geo, material, x, y, z) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  return mesh;
}

export class MobManager {
  constructor(scene, worldAccessor) {
    this.scene = scene ?? null;
    this.worldAccessor = worldAccessor ?? { getBlockAt: () => BLOCK.AIR };
    this.mobs = [];
    this._nextId = 1;
    this._spawnTimer = 0.8;
    this._geometries = [];
  }

  _trackGeo(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    this._geometries.push(geo);
    return geo;
  }

  _ensureSharedGeometries() {
    if (this._sharedGeos) return this._sharedGeos;
    this._sharedGeos = {
      quadBody: this._trackGeo(0.68, 0.56, 1.05),
      quadHead: this._trackGeo(0.46, 0.44, 0.48),
      quadLeg: this._trackGeo(0.2, 0.46, 0.2),
      snout: this._trackGeo(0.26, 0.16, 0.12),
      horn: this._trackGeo(0.08, 0.14, 0.08),
      patch: this._trackGeo(0.7, 0.28, 0.42),
      eye: this._trackGeo(0.07, 0.07, 0.04),
      zombieBody: this._trackGeo(0.5, 0.72, 0.28),
      zombieHead: this._trackGeo(0.46, 0.46, 0.46),
      zombieLimb: this._trackGeo(0.22, 0.7, 0.22),
      creeperBody: this._trackGeo(0.44, 0.76, 0.28),
      creeperHead: this._trackGeo(0.46, 0.46, 0.46),
      creeperLeg: this._trackGeo(0.2, 0.42, 0.22),
      creeperMouth: this._trackGeo(0.18, 0.14, 0.04),
    };
    return this._sharedGeos;
  }

  _getBlock(wx, wy, wz) {
    return this.worldAccessor?.getBlockAt?.(wx, wy, wz) ?? BLOCK.AIR;
  }

  _buildMobRig(type) {
    const geos = this._ensureSharedGeometries();
    const group = new THREE.Group();
    const materials = [];
    const makeMat = (hex) => {
      const m = new THREE.MeshLambertMaterial({ color: hex });
      materials.push(m);
      return m;
    };

    const legs = [];
    const arms = [];
    let headGroup = null;

    if (type === MOB_TYPE.SHEEP || type === MOB_TYPE.COW || type === MOB_TYPE.PIG) {
      const palette = type === MOB_TYPE.SHEEP
        ? { body: 0xf2efe8, head: 0xdcc2a8, leg: 0xd0b498, accent: 0xf7f5f0, eye: 0x1b1e23 }
        : type === MOB_TYPE.COW
          ? { body: 0x5c3c24, head: 0x4f331f, leg: 0x452b19, accent: 0xe6e0d4, eye: 0x1a1a1a }
          : { body: 0xf09da6, head: 0xf2a8b0, leg: 0xe28c96, accent: 0xde7884, eye: 0x201d21 };

      const bodyMat = makeMat(palette.body);
      const headMat = makeMat(palette.head);
      const legMat = makeMat(palette.leg);
      const accentMat = makeMat(palette.accent);
      const eyeMat = makeMat(palette.eye);

      const legH = type === MOB_TYPE.PIG ? 0.34 : 0.46;
      const bodyY = legH + 0.26;
      const body = createPartMesh(geos.quadBody, bodyMat, 0, bodyY, 0);
      if (type === MOB_TYPE.PIG) body.scale.set(0.95, 0.85, 0.88);
      group.add(body);

      if (type === MOB_TYPE.COW) {
        const patch = createPartMesh(geos.patch, accentMat, 0, bodyY + 0.08, -0.1);
        group.add(patch);
      } else if (type === MOB_TYPE.SHEEP) {
        const wool = createPartMesh(geos.patch, accentMat, 0, bodyY + 0.16, 0);
        wool.scale.set(1.02, 0.85, 2.2);
        group.add(wool);
      }

      headGroup = new THREE.Group();
      headGroup.position.set(0, bodyY + 0.18, 0.56);
      const headMesh = createPartMesh(geos.quadHead, headMat, 0, 0, 0.12);
      headGroup.add(headMesh);
      headGroup.add(createPartMesh(geos.eye, eyeMat, -0.12, 0.06, 0.36));
      headGroup.add(createPartMesh(geos.eye, eyeMat, 0.12, 0.06, 0.36));

      if (type === MOB_TYPE.PIG) {
        headGroup.add(createPartMesh(geos.snout, accentMat, 0, -0.06, 0.38));
      } else if (type === MOB_TYPE.COW) {
        headGroup.add(createPartMesh(geos.horn, accentMat, -0.2, 0.26, 0.06));
        headGroup.add(createPartMesh(geos.horn, accentMat, 0.2, 0.26, 0.06));
      }
      group.add(headGroup);

      const legOffsets = [
        [-0.2, legH, 0.34],
        [0.2, legH, 0.34],
        [-0.2, legH, -0.34],
        [0.2, legH, -0.34],
      ];
      for (const [lx, ly, lz] of legOffsets) {
        const pivot = new THREE.Group();
        pivot.position.set(lx, ly, lz);
        const legMesh = createPartMesh(geos.quadLeg, legMat, 0, -0.23, 0);
        if (type === MOB_TYPE.PIG) legMesh.scale.y = 0.74;
        pivot.add(legMesh);
        group.add(pivot);
        legs.push(pivot);
      }
    } else if (type === MOB_TYPE.ZOMBIE) {
      const skinMat = makeMat(0x5b8f49);
      const shirtMat = makeMat(0x2d7f85);
      const pantsMat = makeMat(0x364178);
      const eyeMat = makeMat(0x182414);

      const torso = createPartMesh(geos.zombieBody, shirtMat, 0, 1.06, 0);
      group.add(torso);

      headGroup = new THREE.Group();
      headGroup.position.set(0, 1.42, 0);
      headGroup.add(createPartMesh(geos.zombieHead, skinMat, 0, 0.23, 0));
      headGroup.add(createPartMesh(geos.eye, eyeMat, -0.1, 0.26, 0.23));
      headGroup.add(createPartMesh(geos.eye, eyeMat, 0.1, 0.26, 0.23));
      group.add(headGroup);

      for (const side of [-1, 1]) {
        const armPivot = new THREE.Group();
        armPivot.position.set(side * 0.36, 1.35, 0);
        armPivot.rotation.x = -Math.PI * 0.45;
        armPivot.add(createPartMesh(geos.zombieLimb, skinMat, 0, -0.3, 0));
        group.add(armPivot);
        arms.push(armPivot);

        const legPivot = new THREE.Group();
        legPivot.position.set(side * 0.14, 0.7, 0);
        legPivot.add(createPartMesh(geos.zombieLimb, pantsMat, 0, -0.35, 0));
        group.add(legPivot);
        legs.push(legPivot);
      }
    } else {
      // Creeper
      const skinMat = makeMat(0x4ca63e);
      const spotMat = makeMat(0x39852e);
      const faceMat = makeMat(0x161c14);

      group.add(createPartMesh(geos.creeperBody, skinMat, 0, 0.8, 0));
      group.add(createPartMesh(geos.patch, spotMat, 0, 0.82, 0));

      headGroup = new THREE.Group();
      headGroup.position.set(0, 1.18, 0);
      headGroup.add(createPartMesh(geos.creeperHead, skinMat, 0, 0.23, 0));
      headGroup.add(createPartMesh(geos.eye, faceMat, -0.1, 0.28, 0.23));
      headGroup.add(createPartMesh(geos.eye, faceMat, 0.1, 0.28, 0.23));
      headGroup.add(createPartMesh(geos.creeperMouth, faceMat, 0, 0.12, 0.23));
      group.add(headGroup);

      const legOffsets = [
        [-0.14, 0.42, 0.14],
        [0.14, 0.42, 0.14],
        [-0.14, 0.42, -0.14],
        [0.14, 0.42, -0.14],
      ];
      for (const [lx, ly, lz] of legOffsets) {
        const pivot = new THREE.Group();
        pivot.position.set(lx, ly, lz);
        pivot.add(createPartMesh(geos.creeperLeg, skinMat, 0, -0.21, 0));
        group.add(pivot);
        legs.push(pivot);
      }
    }

    return { group, headGroup, legs, arms, materials };
  }

  spawnMob(type, x, y, z) {
    const spec = MOB_SPECS[type];
    if (!spec) {
      throw new Error(`Unknown mob type: ${type}`);
    }

    const rig = this._buildMobRig(type);
    rig.group.position.set(x, y, z);
    this.scene?.add?.(rig.group);

    const mob = {
      id: this._nextId++,
      type,
      hostile: spec.hostile,
      position: { x, y, z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2,
      hp: spec.hp,
      maxHp: spec.hp,
      halfWidth: spec.halfWidth,
      height: spec.height,
      speed: spec.speed,
      onGround: false,
      hitFlashTimer: 0,
      attackCooldown: 0,
      burnTimer: 0,
      fuseTimer: 0,
      fusing: false,
      wanderTimer: 1.0 + Math.random() * 2.5,
      wanderDirX: 0,
      wanderDirZ: 0,
      walkPhase: 0,
      group: rig.group,
      headGroup: rig.headGroup,
      legs: rig.legs,
      arms: rig.arms,
      materials: rig.materials,
    };

    this.mobs.push(mob);
    return mob;
  }

  _removeMobAt(index) {
    const mob = this.mobs[index];
    if (!mob) return;
    this.scene?.remove?.(mob.group);
    for (const mat of mob.materials) {
      mat.dispose();
    }
    this.mobs.splice(index, 1);
  }

  _overlapsSolid(x, y, z, hw, h) {
    const eps = 1e-4;
    const minX = Math.floor(x - hw + eps);
    const maxX = Math.floor(x + hw - eps);
    const minY = Math.floor(y + eps);
    const maxY = Math.floor(y + h - eps);
    const minZ = Math.floor(z - hw + eps);
    const maxZ = Math.floor(z + hw - eps);

    for (let wy = minY; wy <= maxY; wy++) {
      for (let wz = minZ; wz <= maxZ; wz++) {
        for (let wx = minX; wx <= maxX; wx++) {
          if (isBlockSolid(this._getBlock(wx, wy, wz))) {
            return true;
          }
        }
      }
    }
    return false;
  }

  _isExposedToSky(mob) {
    const wx = Math.floor(mob.position.x);
    const wz = Math.floor(mob.position.z);
    const startY = Math.floor(mob.position.y + mob.height) + 1;
    const maxCheck = Math.min(CHUNK_HEIGHT - 1, startY + 32);
    for (let wy = startY; wy <= maxCheck; wy++) {
      if (isBlockSolid(this._getBlock(wx, wy, wz))) {
        return false;
      }
    }
    return true;
  }

  _trySpawnAroundPlayer(playerPos, isDaytime, difficulty) {
    if (!playerPos) return;

    let passiveCount = 0;
    let hostileCount = 0;
    for (const m of this.mobs) {
      if (m.hostile) hostileCount++;
      else passiveCount++;
    }

    const wantHostile = difficulty !== DIFFICULTIES.PEACEFUL && !isDaytime && hostileCount < HOSTILE_CAP;
    const wantPassive = passiveCount < PASSIVE_CAP;
    if (!wantHostile && !wantPassive) return;

    const spawnHostile = wantHostile && (!wantPassive || Math.random() < 0.45);
    const pool = spawnHostile ? HOSTILE_TYPES : PASSIVE_TYPES;
    const type = pool[Math.floor(Math.random() * pool.length)];

    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);

    const basePy = Math.floor(playerPos.y);
    const scanTop = Math.min(CHUNK_HEIGHT - 3, basePy + 18);
    const scanBot = Math.max(1, basePy - 18);

    for (let wy = scanTop; wy >= scanBot; wy--) {
      const ground = this._getBlock(wx, wy, wz);
      if (!isBlockSolid(ground)) continue;
      const above1 = this._getBlock(wx, wy + 1, wz);
      const above2 = this._getBlock(wx, wy + 2, wz);
      if (
        !isBlockSolid(above1) &&
        above1 !== BLOCK.WATER &&
        above1 !== BLOCK.LAVA &&
        !isBlockSolid(above2) &&
        above2 !== BLOCK.WATER
      ) {
        if (typeof this.worldAccessor?.isWalkableSurface === 'function') {
          if (!this.worldAccessor.isWalkableSurface(wx, wy, wz)) continue;
        }
        this.spawnMob(type, wx + 0.5, wy + 1, wz + 0.5);
        return;
      }
    }
  }

  _stepMobPhysics(mob, wishX, wishZ, dt) {
    const hw = mob.halfWidth;
    const h = mob.height;
    const pos = mob.position;
    const vel = mob.velocity;

    const inWater = this._getBlock(Math.floor(pos.x), Math.floor(pos.y + 0.3), Math.floor(pos.z)) === BLOCK.WATER;
    const moveSpeed = inWater ? mob.speed * 0.55 : mob.speed;

    vel.x += (wishX * moveSpeed - vel.x) * (1 - Math.exp(-12 * dt));
    vel.z += (wishZ * moveSpeed - vel.z) * (1 - Math.exp(-12 * dt));

    if (inWater) {
      vel.y += (2.0 - vel.y) * (1 - Math.exp(-6 * dt));
    } else {
      vel.y = Math.max(-36, vel.y - MOB_GRAVITY * dt);
    }

    // Attempt X with 1-block step-up
    const dx = vel.x * dt;
    if (dx !== 0) {
      pos.x += dx;
      if (this._overlapsSolid(pos.x, pos.y, pos.z, hw, h)) {
        if (mob.onGround && !this._overlapsSolid(pos.x, pos.y + 1.05, pos.z, hw, h)) {
          pos.y += 1.01;
          vel.y = Math.max(vel.y, 1.8);
        } else {
          pos.x -= dx;
          vel.x = 0;
        }
      }
    }

    // Attempt Z with 1-block step-up
    const dz = vel.z * dt;
    if (dz !== 0) {
      pos.z += dz;
      if (this._overlapsSolid(pos.x, pos.y, pos.z, hw, h)) {
        if (mob.onGround && !this._overlapsSolid(pos.x, pos.y + 1.05, pos.z, hw, h)) {
          pos.y += 1.01;
          vel.y = Math.max(vel.y, 1.8);
        } else {
          pos.z -= dz;
          vel.z = 0;
        }
      }
    }

    // Attempt Y in <= 0.25 block increments to prevent floor tunneling
    const dyTotal = vel.y * dt;
    mob.onGround = false;
    if (dyTotal !== 0) {
      const ySteps = Math.max(1, Math.ceil(Math.abs(dyTotal) / 0.25));
      const dyStep = dyTotal / ySteps;
      for (let s = 0; s < ySteps; s++) {
        pos.y += dyStep;
        if (this._overlapsSolid(pos.x, pos.y, pos.z, hw, h)) {
          if (dyStep < 0) {
            pos.y = Math.floor(pos.y + 1e-4) + 1;
            vel.y = 0;
            mob.onGround = true;
          } else {
            pos.y -= dyStep;
            vel.y = 0;
          }
          break;
        }
      }
    } else if (this._overlapsSolid(pos.x, pos.y - 0.02, pos.z, hw, h)) {
      mob.onGround = true;
    }
  }

  _updateVisuals(mob, wishX, wishZ, dt) {
    mob.group.position.set(mob.position.x, mob.position.y, mob.position.z);
    mob.group.rotation.y = mob.yaw;

    const moving = Math.hypot(wishX, wishZ) > 0.05;
    if (moving) {
      mob.walkPhase += dt * 9.0;
    } else {
      mob.walkPhase = 0;
    }

    const swing = moving ? Math.sin(mob.walkPhase) * 0.55 : 0;
    for (let i = 0; i < mob.legs.length; i++) {
      const sign = i % 2 === 0 ? 1 : -1;
      const pairSign = i >= 2 ? -1 : 1;
      mob.legs[i].rotation.x = swing * sign * pairSign;
    }

    if (mob.arms.length === 2) {
      mob.arms[0].rotation.x = -Math.PI * 0.45 + swing * 0.2;
      mob.arms[1].rotation.x = -Math.PI * 0.45 - swing * 0.2;
    }

    // Hit flash or Creeper fuse pulse
    if (mob.hitFlashTimer > 0) {
      for (const mat of mob.materials) mat.emissive.setHex(0x881818);
    } else if (mob.fusing) {
      const flash = Math.sin(mob.fuseTimer * 24) > 0;
      const scale = 1 + (mob.fuseTimer / 1.5) * 0.14;
      mob.group.scale.set(scale, 1 + (mob.fuseTimer / 1.5) * 0.06, scale);
      for (const mat of mob.materials) mat.emissive.setHex(flash ? 0xffffff : 0x224411);
    } else {
      mob.group.scale.set(1, 1, 1);
      for (const mat of mob.materials) mat.emissive.setHex(0x000000);
    }
  }

  update(dt, playerPos, isDaytime = true, difficulty = DIFFICULTIES.NORMAL, callbacks = {}) {
    // 1. Immediately clear hostiles when peaceful
    if (difficulty === DIFFICULTIES.PEACEFUL) {
      for (let i = this.mobs.length - 1; i >= 0; i--) {
        if (this.mobs[i].hostile) {
          this._removeMobAt(i);
        }
      }
    }

    const rawDt = Math.max(dt || 0, 0);
    if (rawDt <= 0) return;

    // 2. Periodic mob spawning around player
    this._spawnTimer -= rawDt;
    if (this._spawnTimer <= 0) {
      this._spawnTimer = 1.6;
      this._trySpawnAroundPlayer(playerPos, isDaytime, difficulty);
    }

    const simDt = Math.min(rawDt, 0.05);

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];

      if (mob.hitFlashTimer > 0) mob.hitFlashTimer = Math.max(0, mob.hitFlashTimer - rawDt);
      if (mob.attackCooldown > 0) mob.attackCooldown = Math.max(0, mob.attackCooldown - rawDt);

      // Despawn out-of-range or fallen-into-void mobs
      if (mob.position.y < -16) {
        this._removeMobAt(i);
        continue;
      }
      if (playerPos) {
        const dxp = playerPos.x - mob.position.x;
        const dzp = playerPos.z - mob.position.z;
        if (dxp * dxp + dzp * dzp > DESPAWN_DIST * DESPAWN_DIST) {
          this._removeMobAt(i);
          continue;
        }
      }

      // Daylight burn for exposed Zombies
      if (mob.type === MOB_TYPE.ZOMBIE && isDaytime && this._isExposedToSky(mob)) {
        mob.burnTimer += rawDt;
        if (mob.burnTimer >= 1.0) {
          mob.burnTimer -= 1.0;
          mob.hp -= 2;
          mob.hitFlashTimer = 0.25;
          if (mob.hp <= 0) {
            this._emitLoot(mob, callbacks.onDrop);
            this._removeMobAt(i);
            continue;
          }
        }
      }

      let wishX = 0;
      let wishZ = 0;

      const distToPlayer = playerPos
        ? Math.hypot(playerPos.x - mob.position.x, playerPos.y - mob.position.y, playerPos.z - mob.position.z)
        : Infinity;

      if (mob.hostile && playerPos && distToPlayer < 18) {
        const dx = playerPos.x - mob.position.x;
        const dz = playerPos.z - mob.position.z;
        const horizDist = Math.hypot(dx, dz) || 1;
        mob.yaw = Math.atan2(dx, dz);

        if (mob.type === MOB_TYPE.CREEPER) {
          if (distToPlayer <= 2.7 || (mob.fusing && distToPlayer <= 4.0)) {
            mob.fusing = true;
            mob.fuseTimer += rawDt;
            if (mob.fuseTimer >= 1.5) {
              const ex = mob.position.x;
              const ey = mob.position.y + 0.6;
              const ez = mob.position.z;
              this._removeMobAt(i);
              callbacks.onExplode?.(ex, ey, ez, 2.8);
              continue;
            }
          } else {
            mob.fusing = false;
            mob.fuseTimer = 0;
            wishX = dx / horizDist;
            wishZ = dz / horizDist;
          }
        } else {
          // Zombie chase & melee
          if (distToPlayer <= 1.75) {
            if (mob.attackCooldown <= 0) {
              mob.attackCooldown = 1.1;
              callbacks.onPlayerDamage?.(3);
            }
          } else {
            wishX = dx / horizDist;
            wishZ = dz / horizDist;
          }
        }
      } else {
        if (mob.fusing) {
          mob.fusing = false;
          mob.fuseTimer = 0;
        }
        mob.wanderTimer -= rawDt;
        if (mob.wanderTimer <= 0) {
          if (Math.random() < 0.65) {
            const angle = Math.random() * Math.PI * 2;
            mob.wanderDirX = Math.sin(angle);
            mob.wanderDirZ = Math.cos(angle);
            mob.yaw = angle;
            mob.wanderTimer = 1.8 + Math.random() * 2.5;
          } else {
            mob.wanderDirX = 0;
            mob.wanderDirZ = 0;
            mob.wanderTimer = 1.2 + Math.random() * 2.0;
          }
        }
        wishX = mob.wanderDirX;
        wishZ = mob.wanderDirZ;
      }

      this._stepMobPhysics(mob, wishX, wishZ, simDt);
      this._updateVisuals(mob, wishX, wishZ, simDt);
    }
  }

  raycastMob(origin, dir, maxDist) {
    if (!origin || !dir || !(maxDist > 0)) return null;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len < 1e-9) return null;
    const dx = dir.x / len;
    const dy = dir.y / len;
    const dz = dir.z / len;

    let closest = null;
    let bestDist = maxDist;

    for (const mob of this.mobs) {
      const minX = mob.position.x - mob.halfWidth;
      const maxX = mob.position.x + mob.halfWidth;
      const minY = mob.position.y;
      const maxY = mob.position.y + mob.height;
      const minZ = mob.position.z - mob.halfWidth;
      const maxZ = mob.position.z + mob.halfWidth;

      let tMin = 0;
      let tMax = bestDist;

      const axes = [
        [origin.x, dx, minX, maxX],
        [origin.y, dy, minY, maxY],
        [origin.z, dz, minZ, maxZ],
      ];

      let hit = true;
      for (const [o, d, bMin, bMax] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (o < bMin || o > bMax) {
            hit = false;
            break;
          }
        } else {
          let t1 = (bMin - o) / d;
          let t2 = (bMax - o) / d;
          if (t1 > t2) {
            const tmp = t1;
            t1 = t2;
            t2 = tmp;
          }
          tMin = Math.max(tMin, t1);
          tMax = Math.min(tMax, t2);
          if (tMin > tMax) {
            hit = false;
            break;
          }
        }
      }

      if (hit && tMin <= bestDist) {
        bestDist = tMin;
        closest = { mob, distance: tMin };
      }
    }

    return closest;
  }

  _emitLoot(mob, onDrop) {
    if (typeof onDrop !== 'function') return;
    const dropPos = {
      x: mob.position.x,
      y: mob.position.y + 0.4,
      z: mob.position.z,
    };

    switch (mob.type) {
      case MOB_TYPE.SHEEP:
        onDrop(BLOCK.WOOL_WHITE, 1, dropPos);
        onDrop(ITEM.RAW_MEAT, 1, dropPos);
        break;
      case MOB_TYPE.COW:
        onDrop(ITEM.RAW_MEAT, 2, dropPos);
        break;
      case MOB_TYPE.PIG:
        onDrop(ITEM.RAW_MEAT, 1, dropPos);
        break;
      case MOB_TYPE.ZOMBIE: {
        const r = Math.random();
        const lootId = r < 0.2 ? ITEM.IRON_INGOT : (r < 0.5 ? ITEM.APPLE : ITEM.COAL);
        onDrop(lootId, 1, dropPos);
        break;
      }
      case MOB_TYPE.CREEPER:
        onDrop(ITEM.GUNPOWDER, 1, dropPos);
        break;
      default:
        break;
    }
  }

  damageMob(mobId, amount, knockbackDir, onDrop) {
    const targetId = typeof mobId === 'object' && mobId !== null ? mobId.id : mobId;
    const index = this.mobs.findIndex((m) => m.id === targetId);
    if (index === -1) return false;

    const mob = this.mobs[index];
    mob.hp -= amount;
    mob.hitFlashTimer = 0.25;

    if (knockbackDir) {
      const kLen = Math.hypot(knockbackDir.x || 0, knockbackDir.z || 0) || 1;
      mob.velocity.x += ((knockbackDir.x || 0) / kLen) * 5.2;
      mob.velocity.z += ((knockbackDir.z || 0) / kLen) * 5.2;
    }
    mob.velocity.y = Math.max(mob.velocity.y, 4.2);

    if (mob.hp <= 0) {
      this._emitLoot(mob, onDrop);
      this._removeMobAt(index);
    }
    return true;
  }

  disposeAll() {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      this._removeMobAt(i);
    }
    for (const geo of this._geometries) {
      geo.dispose();
    }
    this._geometries = [];
    this._sharedGeos = null;
  }
}
