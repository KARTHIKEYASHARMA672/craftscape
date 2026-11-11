import * as THREE from 'three';
import { CHUNK_HEIGHT, CHUNK_SIZE, DEFAULT_RENDER_DISTANCE, MAX_LIGHT } from '../core/constants.js';
import { chunkKey, isValidY, voxelIndex, worldToChunk, worldToLocal } from '../core/coords.js';
import { BLOCK, getBlockDef, isBlockSolid } from '../core/blocks.js';
import { WorldGenerator } from '../world/terrain.js';
import { computeChunkLighting } from '../world/lighting.js';
import { buildChunkMeshData, buildThreeGeometry } from '../render/mesher.js';

const CARDINAL_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export class WorldEngine {
  /**
   * Coordinates deterministic chunk streaming, sparse delta overrides,
   * voxel lighting updates, and Three.js chunk mesh lifecycle.
   * Passing scene=null enables pure headless execution in Node/Vitest.
   */
  constructor({
    scene = null,
    seed = 'craftscape-2026',
    materials = null,
    renderDistance = DEFAULT_RENDER_DISTANCE,
    initialDeltas = null,
  } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.renderDistance = renderDistance;
    this.generator = new WorldGenerator(seed);
    this.seed = this.generator.seed;
    this.seedInt = this.generator.seedInt;

    this.chunks = new Map(); // chunkKey -> chunk
    this.chunkMeshes = new Map(); // chunkKey -> { group, opaqueMesh, cutoutMesh, waterMesh }
    this.modifiedBlocks = new Map(); // "wx,wy,wz" -> blockId
    this.deltasByChunk = new Map(); // chunkKey -> Map<voxelIdx, blockId>

    this._pendingMeshRebuild = new Set();
    this._pendingLightRebuild = new Set();

    if (initialDeltas) {
      this.loadModifiedBlocks(initialDeltas);
    }
  }

  loadModifiedBlocks(entries) {
    this.modifiedBlocks.clear();
    this.deltasByChunk.clear();
    if (!entries) return;

    const iter = entries instanceof Map ? entries.entries() : Object.entries(entries);
    for (const [key, blockId] of iter) {
      const parts = String(key).split(',').map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) continue;
      const [wx, wy, wz] = parts;
      if (!isValidY(wy)) continue;
      this._recordDelta(wx, wy, wz, blockId & 0xff);
    }
  }

  _recordDelta(wx, wy, wz, blockId) {
    const bKey = `${wx},${wy},${wz}`;
    this.modifiedBlocks.set(bKey, blockId);
    const { cx, cz } = worldToChunk(wx, wz);
    const cKey = chunkKey(cx, cz);
    let chunkMap = this.deltasByChunk.get(cKey);
    if (!chunkMap) {
      chunkMap = new Map();
      this.deltasByChunk.set(cKey, chunkMap);
    }
    const { lx, ly, lz } = worldToLocal(wx, wy, wz);
    chunkMap.set(voxelIndex(lx, ly, lz), blockId);
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz)) ?? null;
  }

  getBlockAt(wx, wy, wz) {
    if (wy < 0) return BLOCK.BEDROCK;
    if (wy >= CHUNK_HEIGHT) return BLOCK.AIR;
    const { cx, cz } = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return BLOCK.AIR;
    const { lx, ly, lz } = worldToLocal(wx, wy, wz);
    return chunk.blocks[voxelIndex(lx, ly, lz)];
  }

  getLightAt(wx, wy, wz) {
    if (wy >= CHUNK_HEIGHT) return { sky: MAX_LIGHT, block: 0 };
    if (wy < 0) return { sky: 0, block: 0 };
    const { cx, cz } = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return { sky: MAX_LIGHT, block: 0 };
    const { lx, ly, lz } = worldToLocal(wx, wy, wz);
    const raw = chunk.light[voxelIndex(lx, ly, lz)];
    return {
      sky: (raw >> 4) & 0x0f,
      block: raw & 0x0f,
    };
  }

  getBiomeAt(wx, wz) {
    const { cx, cz } = worldToChunk(wx, wz);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk) {
      const { lx, lz } = worldToLocal(wx, 0, wz);
      return chunk.biomeMap[lz * CHUNK_SIZE + lx] ?? 'plains';
    }
    return this.generator.getTerrainInfo(wx, wz).biome;
  }

  isWalkableSurface(wx, wy, wz) {
    const id = this.getBlockAt(wx, wy, wz);
    if (!isBlockSolid(id) || id === BLOCK.CACTUS) return false;
    const above = this.getBlockAt(wx, wy + 1, wz);
    return !isBlockSolid(above) && above !== BLOCK.WATER && above !== BLOCK.LAVA;
  }

  findSafeSpawn(startX = 0, startZ = 0) {
    return this.generator.findSafeSpawn(startX, startZ);
  }

  ensureChunk(cx, cz, { relight = true, buildMesh = false } = {}) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;

    chunk = this.generator.generateChunk(cx, cz);
    const deltaMap = this.deltasByChunk.get(key);
    if (deltaMap) {
      for (const [idx, blockId] of deltaMap.entries()) {
        chunk.blocks[idx] = blockId;
      }
    }
    this.chunks.set(key, chunk);

    if (relight) {
      computeChunkLighting(chunk, (nx, nz) => this.getChunk(nx, nz));
      // Mark loaded neighbors dirty so border faces cull and light bridges cleanly
      for (const [ox, oz] of CARDINAL_OFFSETS) {
        const nKey = chunkKey(cx + ox, cz + oz);
        const neighbor = this.chunks.get(nKey);
        if (neighbor) {
          this._pendingLightRebuild.add(nKey);
          this._pendingMeshRebuild.add(nKey);
        }
      }
    }

    this._pendingMeshRebuild.add(key);
    if (buildMesh) {
      this.rebuildChunkMesh(cx, cz);
    }
    return chunk;
  }

  setBlockAt(wx, wy, wz, blockId, { immediateRebuild = true } = {}) {
    if (!isValidY(wy)) return false;
    const safeId = blockId & 0xff;
    const { cx, cz } = worldToChunk(wx, wz);
    const key = chunkKey(cx, cz);
    const chunk = this.ensureChunk(cx, cz, { relight: true, buildMesh: false });
    const { lx, ly, lz } = worldToLocal(wx, wy, wz);
    const idx = voxelIndex(lx, ly, lz);
    const prevId = chunk.blocks[idx];

    if (prevId === safeId) return false;

    chunk.blocks[idx] = safeId;
    this._recordDelta(wx, wy, wz, safeId);

    // Update heightMap column if needed
    const colIdx = lz * CHUNK_SIZE + lx;
    if (safeId !== BLOCK.AIR && wy > chunk.heightMap[colIdx]) {
      chunk.heightMap[colIdx] = wy;
    } else if (safeId === BLOCK.AIR && wy >= chunk.heightMap[colIdx]) {
      let topY = 0;
      for (let y = wy; y >= 0; y -= 1) {
        if (chunk.blocks[voxelIndex(lx, y, lz)] !== BLOCK.AIR) {
          topY = y;
          break;
        }
      }
      chunk.heightMap[colIdx] = topY;
    }

    const touchedChunks = new Set([key]);
    if (lx === 0) touchedChunks.add(chunkKey(cx - 1, cz));
    if (lx === CHUNK_SIZE - 1) touchedChunks.add(chunkKey(cx + 1, cz));
    if (lz === 0) touchedChunks.add(chunkKey(cx, cz - 1));
    if (lz === CHUNK_SIZE - 1) touchedChunks.add(chunkKey(cx, cz + 1));

    // Recompute light on any loaded chunk near an emissive block or edit
    const prevEmit = getBlockDef(prevId).lightLevel > 0;
    const nextEmit = getBlockDef(safeId).lightLevel > 0;
    if (prevEmit || nextEmit) {
      for (const [ox, oz] of CARDINAL_OFFSETS) {
        touchedChunks.add(chunkKey(cx + ox, cz + oz));
      }
    }

    if (immediateRebuild) {
      for (const tKey of touchedChunks) {
        const tc = this.chunks.get(tKey);
        if (!tc) continue;
        computeChunkLighting(tc, (nx, nz) => this.getChunk(nx, nz));
        this._pendingLightRebuild.delete(tKey);
      }
      for (const tKey of touchedChunks) {
        const tc = this.chunks.get(tKey);
        if (!tc) continue;
        this.rebuildChunkMesh(tc.cx, tc.cz);
      }
    } else {
      for (const tKey of touchedChunks) {
        if (this.chunks.has(tKey)) {
          this._pendingLightRebuild.add(tKey);
          this._pendingMeshRebuild.add(tKey);
        }
      }
    }

    return true;
  }

  _disposeChunkMeshes(key) {
    const entry = this.chunkMeshes.get(key);
    if (!entry) return;
    this.scene?.remove?.(entry.group);
    entry.opaqueMesh?.geometry?.dispose?.();
    entry.cutoutMesh?.geometry?.dispose?.();
    entry.waterMesh?.geometry?.dispose?.();
    this.chunkMeshes.delete(key);
  }

  rebuildChunkMesh(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    this._pendingMeshRebuild.delete(key);

    if (chunk.dirtyLight || this._pendingLightRebuild.has(key)) {
      computeChunkLighting(chunk, (nx, nz) => this.getChunk(nx, nz));
      this._pendingLightRebuild.delete(key);
    }

    const meshData = buildChunkMeshData(
      chunk,
      (wx, wy, wz) => this.getBlockAt(wx, wy, wz),
      (wx, wy, wz) => this.getLightAt(wx, wy, wz),
    );
    chunk.dirtyMesh = false;

    if (!this.scene || !this.materials) {
      return meshData;
    }

    this._disposeChunkMeshes(key);

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const opaqueGeo = buildThreeGeometry(meshData.opaque);
    const cutoutGeo = buildThreeGeometry(meshData.cutout);
    const waterGeo = buildThreeGeometry(meshData.water);

    let opaqueMesh = null;
    let cutoutMesh = null;
    let waterMesh = null;

    if (opaqueGeo) {
      opaqueMesh = new THREE.Mesh(opaqueGeo, this.materials.opaqueMaterial);
      group.add(opaqueMesh);
    }
    if (cutoutGeo) {
      cutoutMesh = new THREE.Mesh(cutoutGeo, this.materials.cutoutMaterial);
      group.add(cutoutMesh);
    }
    if (waterGeo) {
      waterMesh = new THREE.Mesh(waterGeo, this.materials.waterMaterial);
      waterMesh.renderOrder = 2;
      group.add(waterMesh);
    }

    this.scene.add(group);
    this.chunkMeshes.set(key, { group, opaqueMesh, cutoutMesh, waterMesh });
    return meshData;
  }

  /**
   * Synchronous bootstrap for immediate spawn ring so title screen and initial spawn
   * show rich landscape on frame 1 without waiting for staggered ticks.
   */
  preloadRadius(centerWx, centerWz, radius = 3) {
    const { cx: ccx, cz: ccz } = worldToChunk(centerWx, centerWz);
    const coords = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dz * dz <= radius * radius + 1) {
          coords.push({ cx: ccx + dx, cz: ccz + dz, dist2: dx * dx + dz * dz });
        }
      }
    }
    coords.sort((a, b) => a.dist2 - b.dist2);

    for (const c of coords) {
      this.ensureChunk(c.cx, c.cz, { relight: false, buildMesh: false });
    }
    for (const c of coords) {
      const chunk = this.getChunk(c.cx, c.cz);
      if (chunk) {
        computeChunkLighting(chunk, (nx, nz) => this.getChunk(nx, nz));
        this._pendingLightRebuild.delete(chunkKey(c.cx, c.cz));
      }
    }
    for (const c of coords) {
      this.rebuildChunkMesh(c.cx, c.cz);
    }
  }

  /**
   * Frame-budgeted chunk streaming and dirty mesh rebuilding around the player.
   */
  updateAroundPlayer(wx, wz, { maxNewChunks = 3, maxMeshRebuilds = 4 } = {}) {
    const { cx: ccx, cz: ccz } = worldToChunk(wx, wz);
    const r = this.renderDistance;
    const needed = [];

    for (let dz = -r; dz <= r; dz += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const dist2 = dx * dx + dz * dz;
        if (dist2 > r * r + 1) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = chunkKey(cx, cz);
        if (!this.chunks.has(key)) {
          needed.push({ cx, cz, dist2 });
        }
      }
    }

    needed.sort((a, b) => a.dist2 - b.dist2);
    const newCount = Math.min(maxNewChunks, needed.length);
    for (let i = 0; i < newCount; i += 1) {
      this.ensureChunk(needed[i].cx, needed[i].cz, { relight: true, buildMesh: false });
    }

    // Relight pending chunks first (prioritizing closest to player)
    if (this._pendingLightRebuild.size > 0) {
      const lightList = [];
      for (const key of this._pendingLightRebuild) {
        const ch = this.chunks.get(key);
        if (!ch) continue;
        const dx = ch.cx - ccx;
        const dz = ch.cz - ccz;
        lightList.push({ ch, key, dist2: dx * dx + dz * dz });
      }
      lightList.sort((a, b) => a.dist2 - b.dist2);
      const maxLights = Math.min(maxMeshRebuilds + 2, lightList.length);
      for (let i = 0; i < maxLights; i += 1) {
        computeChunkLighting(lightList[i].ch, (nx, nz) => this.getChunk(nx, nz));
        this._pendingLightRebuild.delete(lightList[i].key);
      }
    }

    // Rebuild closest dirty meshes within per-frame budget
    if (this._pendingMeshRebuild.size > 0) {
      const meshList = [];
      for (const key of this._pendingMeshRebuild) {
        const ch = this.chunks.get(key);
        if (!ch) continue;
        const dx = ch.cx - ccx;
        const dz = ch.cz - ccz;
        meshList.push({ ch, key, dist2: dx * dx + dz * dz });
      }
      meshList.sort((a, b) => a.dist2 - b.dist2);
      const count = Math.min(maxMeshRebuilds, meshList.length);
      for (let i = 0; i < count; i += 1) {
        this.rebuildChunkMesh(meshList[i].ch.cx, meshList[i].ch.cz);
      }
    }

    // Unload distant chunks beyond renderDistance + 2
    const unloadR2 = (r + 2) * (r + 2) + 2;
    for (const [key, ch] of this.chunks.entries()) {
      const dx = ch.cx - ccx;
      const dz = ch.cz - ccz;
      if (dx * dx + dz * dz > unloadR2) {
        this._disposeChunkMeshes(key);
        this.chunks.delete(key);
        this._pendingMeshRebuild.delete(key);
        this._pendingLightRebuild.delete(key);
      }
    }
  }

  flushRebuilds() {
    if (this._pendingLightRebuild.size > 0) {
      for (const key of Array.from(this._pendingLightRebuild)) {
        const ch = this.chunks.get(key);
        if (ch) {
          computeChunkLighting(ch, (nx, nz) => this.getChunk(nx, nz));
        }
        this._pendingLightRebuild.delete(key);
      }
    }
    if (this._pendingMeshRebuild.size > 0) {
      for (const key of Array.from(this._pendingMeshRebuild)) {
        const ch = this.chunks.get(key);
        if (ch) {
          this.rebuildChunkMesh(ch.cx, ch.cz);
        } else {
          this._pendingMeshRebuild.delete(key);
        }
      }
    }
  }

  getLoadedChunkCount() {
    return this.chunks.size;
  }

  exportModifiedBlocks() {
    return new Map(this.modifiedBlocks);
  }

  dispose() {
    for (const key of Array.from(this.chunkMeshes.keys())) {
      this._disposeChunkMeshes(key);
    }
    this.chunks.clear();
    this._pendingMeshRebuild.clear();
    this._pendingLightRebuild.clear();
  }
}
