import * as THREE from 'three';
import { BLOCK, getBlockDef, isBlockSolid } from '../core/blocks.js';
import { getItemDef } from '../core/items.js';

const DROP_GRAVITY = 20.0;
const DROP_MAGNET_RANGE = 2.3;
const DROP_PICKUP_RANGE = 0.85;
const DROP_MAX_AGE = 300;
const TNT_DEFAULT_FUSE = 3.0;
const TNT_DEFAULT_RADIUS = 3.2;

/**
 * Collect destructible blocks within a blast sphere, preserving Bedrock and Obsidian.
 */
export function collectExplosionBlocks(cx, cy, cz, radius, getBlockAt) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.floor(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.floor(cy + radius);
  const minZ = Math.floor(cz - radius);
  const maxZ = Math.floor(cz + radius);
  const r2 = radius * radius;
  const affected = [];

  for (let wy = minY; wy <= maxY; wy++) {
    for (let wz = minZ; wz <= maxZ; wz++) {
      for (let wx = minX; wx <= maxX; wx++) {
        const dx = wx + 0.5 - cx;
        const dy = wy + 0.5 - cy;
        const dz = wz + 0.5 - cz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;

        const blockId = getBlockAt(wx, wy, wz) ?? BLOCK.AIR;
        if (blockId === BLOCK.AIR || blockId === BLOCK.BEDROCK || blockId === BLOCK.OBSIDIAN) {
          continue;
        }
        affected.push({ wx, wy, wz, blockId });
      }
    }
  }

  return affected;
}

export class EntityManager {
  constructor(scene, worldAccessor) {
    this.scene = scene ?? null;
    this.worldAccessor = worldAccessor ?? { getBlockAt: () => BLOCK.AIR };
    this.drops = [];
    this.tnts = [];
    this._nextId = 1;
    this._dropGeo = null;
    this._tntGeo = null;
    this._tntBandGeo = null;
  }

  _getBlock(wx, wy, wz) {
    return this.worldAccessor?.getBlockAt?.(wx, wy, wz) ?? BLOCK.AIR;
  }

  _ensureGeometries() {
    if (!this._dropGeo) this._dropGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    if (!this._tntGeo) this._tntGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    if (!this._tntBandGeo) this._tntBandGeo = new THREE.BoxGeometry(1.0, 0.3, 1.0);
  }

  spawnDrop(itemId, count, pos, velocity = null) {
    if (!itemId || !(count > 0)) return null;
    this._ensureGeometries();

    const itemDef = getItemDef(itemId);
    const colorHex = itemDef?.mapColor ?? itemDef?.iconColor ?? '#d9c594';
    const material = new THREE.MeshLambertMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(this._dropGeo, material);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene?.add?.(mesh);

    const vx = velocity?.x ?? (Math.random() - 0.5) * 1.8;
    const vy = velocity?.y ?? 2.6;
    const vz = velocity?.z ?? (Math.random() - 0.5) * 1.8;

    const drop = {
      id: this._nextId++,
      itemId,
      count,
      position: { x: pos.x, y: pos.y, z: pos.z },
      velocity: { x: vx, y: vy, z: vz },
      age: 0,
      pickupDelay: 0.1,
      bobPhase: Math.random() * Math.PI * 2,
      onGround: false,
      mesh,
      material,
    };

    this.drops.push(drop);
    return drop;
  }

  spawnPrimedTnt(wx, wy, wz, fuseSeconds = TNT_DEFAULT_FUSE) {
    this._ensureGeometries();

    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd93f32 });
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xf4efe6 });
    const bodyMesh = new THREE.Mesh(this._tntGeo, bodyMat);
    bodyMesh.position.y = 0.49;
    const bandMesh = new THREE.Mesh(this._tntBandGeo, bandMat);
    bandMesh.position.y = 0.49;

    group.add(bodyMesh);
    group.add(bandMesh);
    group.position.set(wx + 0.5, wy, wz + 0.5);
    this.scene?.add?.(group);

    const tnt = {
      id: this._nextId++,
      position: { x: wx + 0.5, y: wy, z: wz + 0.5 },
      velocity: { x: (Math.random() - 0.5) * 0.8, y: 3.6, z: (Math.random() - 0.5) * 0.8 },
      fuseRemaining: fuseSeconds,
      radius: TNT_DEFAULT_RADIUS,
      onGround: false,
      group,
      materials: [bodyMat, bandMat],
    };

    this.tnts.push(tnt);
    return tnt;
  }

  _removeDropAt(index) {
    const drop = this.drops[index];
    if (!drop) return;
    this.scene?.remove?.(drop.mesh);
    drop.material.dispose();
    this.drops.splice(index, 1);
  }

  _removeTntAt(index) {
    const tnt = this.tnts[index];
    if (!tnt) return;
    this.scene?.remove?.(tnt.group);
    for (const mat of tnt.materials) mat.dispose();
    this.tnts.splice(index, 1);
  }

  _detonateTnt(tnt, playerPos, callbacks) {
    const cx = tnt.position.x;
    const cy = tnt.position.y + 0.5;
    const cz = tnt.position.z;
    const radius = tnt.radius;

    const affected = collectExplosionBlocks(cx, cy, cz, radius, (wx, wy, wz) => this._getBlock(wx, wy, wz));

    if (typeof this.worldAccessor?.setBlockAt === 'function') {
      for (const cell of affected) {
        if (cell.blockId === BLOCK.TNT) {
          this.worldAccessor.setBlockAt(cell.wx, cell.wy, cell.wz, BLOCK.AIR);
          this.spawnPrimedTnt(cell.wx, cell.wy, cell.wz, 0.45);
          continue;
        }
        this.worldAccessor.setBlockAt(cell.wx, cell.wy, cell.wz, BLOCK.AIR);
        const def = getBlockDef(cell.blockId);
        if (def.dropId != null && Math.random() < 0.35) {
          this.spawnDrop(def.dropId, def.dropCount, {
            x: cell.wx + 0.5,
            y: cell.wy + 0.5,
            z: cell.wz + 0.5,
          });
        }
      }
    }

    // Damage nearby player if within blast sphere
    if (playerPos) {
      const dist = Math.hypot(playerPos.x - cx, playerPos.y + 0.9 - cy, playerPos.z - cz);
      if (dist <= radius * 1.6) {
        const dmg = Math.max(1, Math.round((1 - dist / (radius * 1.6)) * 12));
        callbacks.onPlayerDamage?.(dmg);
      }
    }

    callbacks.onExplode?.(cx, cy, cz, radius, affected);
  }

  update(dt, playerPos, callbacks = {}) {
    const rawDt = Math.max(dt || 0, 0);
    if (rawDt <= 0) return;
    const simDt = Math.min(rawDt, 0.05);

    // 1. Update Primed TNT
    for (let i = this.tnts.length - 1; i >= 0; i--) {
      const tnt = this.tnts[i];
      tnt.fuseRemaining -= rawDt;

      if (tnt.fuseRemaining <= 0) {
        this._removeTntAt(i);
        this._detonateTnt(tnt, playerPos, callbacks);
        continue;
      }

      // Physics for falling TNT
      tnt.velocity.y = Math.max(-36, tnt.velocity.y - DROP_GRAVITY * simDt);
      tnt.position.x += tnt.velocity.x * simDt;
      if (isBlockSolid(this._getBlock(Math.floor(tnt.position.x), Math.floor(tnt.position.y + 0.2), Math.floor(tnt.position.z)))) {
        tnt.position.x -= tnt.velocity.x * simDt;
        tnt.velocity.x = 0;
      }
      tnt.position.z += tnt.velocity.z * simDt;
      if (isBlockSolid(this._getBlock(Math.floor(tnt.position.x), Math.floor(tnt.position.y + 0.2), Math.floor(tnt.position.z)))) {
        tnt.position.z -= tnt.velocity.z * simDt;
        tnt.velocity.z = 0;
      }
      const dyTotal = tnt.velocity.y * simDt;
      const ySteps = Math.max(1, Math.ceil(Math.abs(dyTotal) / 0.25));
      const dyStep = dyTotal / ySteps;
      for (let s = 0; s < ySteps; s++) {
        tnt.position.y += dyStep;
        const footWy = Math.floor(tnt.position.y);
        if (dyStep < 0 && isBlockSolid(this._getBlock(Math.floor(tnt.position.x), footWy, Math.floor(tnt.position.z)))) {
          tnt.position.y = footWy + 1;
          tnt.velocity.y = 0;
          tnt.velocity.x *= 0.6;
          tnt.velocity.z *= 0.6;
          tnt.onGround = true;
          break;
        }
      }

      // Blink increasingly rapidly as fuse nears 0
      const blinkFreq = 8 + (TNT_DEFAULT_FUSE - Math.min(TNT_DEFAULT_FUSE, tnt.fuseRemaining)) * 10;
      const flashWhite = Math.sin(tnt.fuseRemaining * blinkFreq) > 0;
      for (const mat of tnt.materials) {
        mat.emissive.setHex(flashWhite ? 0xffffff : 0x000000);
      }
      const swell = 1 + Math.max(0, 1 - tnt.fuseRemaining / 0.35) * 0.12;
      tnt.group.scale.setScalar(swell);
      tnt.group.position.set(tnt.position.x, tnt.position.y, tnt.position.z);
    }

    // 2. Update Dropped Items
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += rawDt;
      drop.bobPhase += rawDt * 2.8;

      if (drop.age >= DROP_MAX_AGE) {
        this._removeDropAt(i);
        continue;
      }

      let magnetized = false;
      if (playerPos && drop.age >= drop.pickupDelay) {
        const px = playerPos.x;
        const py = playerPos.y + 0.75;
        const pz = playerPos.z;
        const dx = px - drop.position.x;
        const dy = py - drop.position.y;
        const dz = pz - drop.position.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist <= DROP_PICKUP_RANGE) {
          const accepted = callbacks.onPickup?.(drop.itemId, drop.count);
          if (accepted !== false) {
            this._removeDropAt(i);
            continue;
          }
        } else if (dist <= DROP_MAGNET_RANGE) {
          magnetized = true;
          const pullSpeed = 9.0;
          const stepDist = Math.min(dist, pullSpeed * simDt);
          drop.position.x += (dx / dist) * stepDist;
          drop.position.y += (dy / dist) * stepDist;
          drop.position.z += (dz / dist) * stepDist;

          const postDist = Math.hypot(px - drop.position.x, py - drop.position.y, pz - drop.position.z);
          if (postDist <= DROP_PICKUP_RANGE) {
            const accepted = callbacks.onPickup?.(drop.itemId, drop.count);
            if (accepted !== false) {
              this._removeDropAt(i);
              continue;
            }
          }
        }
      }

      if (!magnetized) {
        drop.velocity.y = Math.max(-28, drop.velocity.y - DROP_GRAVITY * simDt);
        drop.position.x += drop.velocity.x * simDt;
        drop.position.z += drop.velocity.z * simDt;
        drop.position.y += drop.velocity.y * simDt;

        const wx = Math.floor(drop.position.x);
        const wz = Math.floor(drop.position.z);
        const footWy = Math.floor(drop.position.y - 0.14);
        if (drop.velocity.y <= 0 && isBlockSolid(this._getBlock(wx, footWy, wz))) {
          drop.position.y = footWy + 1 + 0.14;
          drop.velocity.y = 0;
          drop.velocity.x *= 0.82;
          drop.velocity.z *= 0.82;
          drop.onGround = true;
        } else {
          drop.onGround = false;
        }
      }

      const hoverOffset = drop.onGround ? Math.sin(drop.bobPhase) * 0.08 + 0.08 : 0;
      drop.mesh.position.set(drop.position.x, drop.position.y + hoverOffset, drop.position.z);
      drop.mesh.rotation.y += simDt * 2.2;
    }
  }

  disposeAll() {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      this._removeDropAt(i);
    }
    for (let i = this.tnts.length - 1; i >= 0; i--) {
      this._removeTntAt(i);
    }
    this._dropGeo?.dispose();
    this._tntGeo?.dispose();
    this._tntBandGeo?.dispose();
    this._dropGeo = null;
    this._tntGeo = null;
    this._tntBandGeo = null;
  }
}
